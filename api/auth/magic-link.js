// POST /api/auth/magic-link
// Sends a magic link email for passwordless sign-in
const { sql } = require('../../lib/db');
const { signMagicToken } = require('../../lib/auth');
const { sendEmail, magicLinkEmail } = require('../../lib/email');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const cleanEmail = email.toLowerCase().trim();

  try {
    // Check if user exists in our DB (they must have a subscription)
    const rows = await sql`SELECT id, email, is_pro FROM users WHERE email = ${cleanEmail}`;

    if (!rows || rows.length === 0) {
      // Don't reveal whether email exists — always show success
      // But log it for debugging
      console.log('Magic link requested for unknown email:', cleanEmail);
      return res.status(200).json({ sent: true });
    }

    // Generate magic link token (15-min expiry, signed JWT)
    const token = signMagicToken(cleanEmail);
    const baseUrl = process.env.APP_URL || 'https://recallbetter.com';
    const magicUrl = `${baseUrl}/api/auth/verify?token=${token}`;

    // Send the email
    const result = await sendEmail({
      to: cleanEmail,
      subject: 'Sign in to Recall Better',
      html: magicLinkEmail(magicUrl),
    });

    if (!result.success) {
      console.error('Failed to send magic link to', cleanEmail, result.error);
      // Still return success to not reveal info
    }

    return res.status(200).json({ sent: true });

  } catch (err) {
    console.error('Magic link error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
