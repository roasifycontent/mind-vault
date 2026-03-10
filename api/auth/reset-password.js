const bcrypt = require('bcryptjs');
const { sql } = require('../../lib/db');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, password } = req.body || {};

  if (!token || typeof token !== 'string' || token.length < 32) {
    return res.status(400).json({ error: 'Invalid reset token' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const [row] = await sql`
      SELECT user_id, expires_at
      FROM password_reset_tokens
      WHERE token = ${token}
    `;

    if (!row) {
      return res.status(400).json({ error: 'This reset link is invalid or has already been used.' });
    }

    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });
    }

    const hash = await bcrypt.hash(password, 12);

    await sql`
      UPDATE users SET password_hash = ${hash} WHERE id = ${row.user_id}
    `;

    await sql`
      DELETE FROM password_reset_tokens WHERE user_id = ${row.user_id}
    `;

    return res.json({ ok: true });

  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ error: 'Server error, please try again' });
  }
};
