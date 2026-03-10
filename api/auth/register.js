const bcrypt = require('bcryptjs');
const { sql } = require('../../lib/db');
const { signToken } = require('../../lib/auth');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body || {};

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const hash = await bcrypt.hash(password, 12);

    const [user] = await sql`
      INSERT INTO users (email, password_hash)
      VALUES (${email.toLowerCase()}, ${hash})
      RETURNING id, email
    `;

    // Create empty stats row for the new user
    await sql`
      INSERT INTO user_stats (user_id)
      VALUES (${user.id})
      ON CONFLICT (user_id) DO NOTHING
    `;

    const token = signToken(user.id);
    return res.status(201).json({ token, user: { id: user.id, email: user.email } });

  } catch (err) {
    if (err.message?.includes('unique') || err.code === '23505') {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Server error, please try again' });
  }
};
