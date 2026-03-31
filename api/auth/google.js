const crypto = require('crypto');
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

  const { credential } = req.body || {};

  if (!credential) {
    return res.status(400).json({ error: 'Google credential is required' });
  }

  try {
    // Verify the Google ID token via Google's tokeninfo endpoint
    const verifyRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
    );

    if (!verifyRes.ok) {
      return res.status(401).json({ error: 'Invalid Google token' });
    }

    const payload = await verifyRes.json();

    // Validate the audience matches our client ID
    const expectedAud = (process.env.GOOGLE_CLIENT_ID || '').trim();
    const actualAud = (payload.aud || '').trim();
    console.log('Google auth aud check:', { actualAud, expectedAud, match: actualAud === expectedAud });
    if (actualAud !== expectedAud) {
      console.error('Token audience mismatch:', { actualAud, expectedAud });
      return res.status(401).json({ error: 'Token audience mismatch' });
    }

    const email = payload.email?.toLowerCase();
    if (!email) {
      return res.status(401).json({ error: 'No email found in Google token' });
    }

    // Check if user already exists
    const [existing] = await sql`
      SELECT id, email, is_pro FROM users
      WHERE email = ${email}
    `;

    if (existing) {
      // Existing user — sign in
      const token = signToken(existing.id, existing.is_pro);
      return res.json({
        token,
        user: { id: existing.id, email: existing.email, is_pro: existing.is_pro },
      });
    }

    // New user — create account with a random password hash (they'll use Google to sign in)
    const randomPass = crypto.randomBytes(32).toString('hex');
    const hash = await bcrypt.hash(randomPass, 12);

    const [user] = await sql`
      INSERT INTO users (email, password_hash)
      VALUES (${email}, ${hash})
      RETURNING id, email
    `;

    // Create empty stats row for the new user
    await sql`
      INSERT INTO user_stats (user_id)
      VALUES (${user.id})
      ON CONFLICT (user_id) DO NOTHING
    `;

    const token = signToken(user.id, false);
    return res.status(201).json({
      token,
      user: { id: user.id, email: user.email, is_pro: false },
    });

  } catch (err) {
    console.error('Google auth error:', err);
    return res.status(500).json({ error: 'Server error, please try again' });
  }
};
