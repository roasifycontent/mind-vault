const { signMagicToken } = require('../../lib/auth');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function sendEmail(to, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'Recall Better <hello@recallbetter.com>',
      to,
      subject,
      html,
    }),
  });
  const body = await res.text().catch(() => '');
  if (!res.ok) {
    console.error('[magic-link] Resend error', res.status, body);
    throw new Error('Failed to send email');
  }
  return body;
}

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const cleanEmail = email.trim().toLowerCase();

  try {
    const token = signMagicToken(cleanEmail);
    const magicUrl = `https://recallbetter.com/api/auth/verify?token=${encodeURIComponent(token)}`;

    const html = `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:32px 20px;">
  <h1 style="color:#2D7A5F;font-size:28px;">Log in to Recall Better</h1>
  <p style="color:#2C2C2C;font-size:16px;line-height:1.7;">Click the button below to access your memory training:</p>
  <a href="${magicUrl}" style="display:inline-block;background:#2D7A5F;color:white;padding:16px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;margin:24px 0;">Log In to Recall Better</a>
  <p style="color:#8A8A8A;font-size:14px;">This link expires in 15 minutes. If you didn't request this, you can safely ignore this email.</p>
  <hr style="border:none;border-top:1px solid #E8E2D9;margin:32px 0;">
  <p style="color:#8A8A8A;font-size:12px;">Recall Better &mdash; recallbetter.com</p>
</div>`;

    await sendEmail(cleanEmail, 'Your Recall Better login link', html);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[magic-link] Error:', err.message);
    return res.status(500).json({ error: 'Failed to send login link. Please try again.' });
  }
};
