const crypto = require('crypto');
const { sql } = require('../../lib/db');
const { checkRateLimit, getIp } = require('../../lib/rate-limit');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM    = process.env.RESEND_FROM || 'MindVault <noreply@mindvault.app>';
const APP_URL        = process.env.APP_URL      || 'https://mindvault.app';

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  // Rate limit: 5 reset requests per IP per hour
  try {
    const { allowed } = await checkRateLimit(getIp(req), 'forgot-password');
    if (!allowed) {
      return res.status(429).json({ error: 'Too many attempts. Please try again in an hour.' });
    }
  } catch (_) {}

  try {
    const [user] = await sql`
      SELECT id FROM users WHERE email = ${email.toLowerCase()}
    `;

    // Always respond with success to prevent email enumeration
    if (!user) {
      return res.json({ ok: true });
    }

    const token  = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store token (upsert so repeated requests just overwrite)
    await sql`
      INSERT INTO password_reset_tokens (user_id, token, expires_at)
      VALUES (${user.id}, ${token}, ${expiry})
      ON CONFLICT (user_id)
      DO UPDATE SET token = ${token}, expires_at = ${expiry}, created_at = now()
    `;

    if (!RESEND_API_KEY) {
      console.warn('RESEND_API_KEY not set — reset token generated but email not sent. Token:', token);
      return res.json({ ok: true });
    }

    const resetUrl = `${APP_URL}/reset.html?token=${token}`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: email.toLowerCase(),
        subject: 'Reset your MindVault password',
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #090b11; color: #ede9df; border-radius: 12px;">
            <h1 style="font-family: Georgia, serif; font-weight: 300; font-size: 32px; margin: 0 0 8px; color: #ede9df;">MindVault</h1>
            <p style="color: #9e9888; font-size: 14px; margin: 0 0 32px;">Daily Memory Training</p>
            <h2 style="font-weight: 400; font-size: 20px; margin: 0 0 16px; color: #ede9df;">Password Reset Request</h2>
            <p style="color: #9e9888; margin: 0 0 24px; line-height: 1.6;">Click the button below to reset your password. This link expires in <strong style="color: #ede9df;">1 hour</strong>.</p>
            <a href="${resetUrl}" style="display: inline-block; background: #c9a84c; color: #090b11; text-decoration: none; padding: 14px 28px; border-radius: 100px; font-weight: 500; font-size: 15px; margin-bottom: 24px;">Reset Password →</a>
            <p style="color: #5c594f; font-size: 13px; margin: 0; line-height: 1.6;">If you didn't request this, you can safely ignore this email. Your password won't change.</p>
            <hr style="border: none; border-top: 1px solid #ffffff1e; margin: 32px 0 16px;">
            <p style="color: #5c594f; font-size: 12px; margin: 0;">If the button doesn't work, copy this link:<br><span style="color: #9e9888; word-break: break-all;">${resetUrl}</span></p>
          </div>
        `,
      }),
    });

    return res.json({ ok: true });

  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ error: 'Server error, please try again' });
  }
};
