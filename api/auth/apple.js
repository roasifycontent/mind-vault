const crypto = require('crypto');
const { sql } = require('../../lib/db');
const { signToken } = require('../../lib/auth');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * Decode an Apple ID token (JWT) without full verification.
 * Splits by '.', base64url-decodes the payload segment, and JSON-parses it.
 */
function decodeAppleToken(idToken) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');

  // Base64url -> Base64 -> Buffer -> JSON
  const payload = parts[1]
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const decoded = Buffer.from(payload, 'base64').toString('utf8');
  return JSON.parse(decoded);
}

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id_token, user: appleUser } = req.body || {};

  if (!id_token) {
    return res.status(400).json({ error: 'Apple ID token is required' });
  }

  let payload;
  try {
    payload = decodeAppleToken(id_token);
  } catch (err) {
    console.error('Apple token decode error:', err);
    return res.status(400).json({ error: 'Invalid Apple ID token' });
  }

  const appleSub = payload.sub;
  if (!appleSub) {
    return res.status(400).json({ error: 'Apple token missing subject (sub)' });
  }

  // Email from token payload, or from the user object Apple sends on first sign-in
  const email = (payload.email || appleUser?.email || '').toLowerCase().trim();
  if (!email) {
    return res.status(400).json({ error: 'Could not determine email from Apple sign-in' });
  }

  try {
    // Check if user already exists with this email
    const [existingUser] = await sql`
      SELECT id, email, is_pro FROM users
      WHERE email = ${email}
    `;

    if (existingUser) {
      const token = signToken(existingUser.id, existingUser.is_pro);
      return res.json({
        token,
        user: { id: existingUser.id, email: existingUser.email, is_pro: existingUser.is_pro },
      });
    }

    // New user — create account with a random password hash (they'll sign in via Apple)
    const randomPassword = crypto.randomBytes(32).toString('hex');
    // We use a simple hash here since the password is random and will never be used for login
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(randomPassword, 12);

    const [newUser] = await sql`
      INSERT INTO users (email, password_hash, auth_provider)
      VALUES (${email}, ${hash}, 'apple')
      RETURNING id, email
    `;

    // Create empty stats row for the new user
    await sql`
      INSERT INTO user_stats (user_id)
      VALUES (${newUser.id})
      ON CONFLICT (user_id) DO NOTHING
    `;

    const token = signToken(newUser.id, false);
    return res.status(201).json({
      token,
      user: { id: newUser.id, email: newUser.email, is_pro: false },
    });

  } catch (err) {
    console.error('Apple auth error:', err);
    return res.status(500).json({ error: 'Server error, please try again' });
  }
};
