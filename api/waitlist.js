const { sql } = require('../lib/db');

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

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email is required' });
  }

  const trimmed = email.trim().toLowerCase();

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  try {
    await sql`
      INSERT INTO waitlist (email) VALUES (${trimmed})
    `;
    return res.json({ ok: true });

  } catch (err) {
    // Unique constraint violation = already registered
    if (err.code === '23505' || (err.message && err.message.includes('unique'))) {
      return res.status(409).json({ error: 'Already registered' });
    }
    console.error('Waitlist error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
