const bcrypt = require('bcryptjs');
const { sql } = require('../../lib/db');
const { signToken, signSessionToken, setSessionCookie } = require('../../lib/auth');
const { checkRateLimit, getIp } = require('../../lib/rate-limit');

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

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const { allowed, remaining } = await checkRateLimit(getIp(req), 'login');
    if (!allowed) {
      return res.status(429).json({ error: 'Too many attempts. Please try again in an hour.' });
    }
    res.setHeader('X-RateLimit-Remaining', remaining);
  } catch (_) {
    // Fail open — don't block users if rate limit DB check fails
  }

  try {
    const [user] = await sql`
      SELECT id, email, password_hash, is_pro FROM users
      WHERE email = ${email.toLowerCase()}
    `;

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user.id, user.is_pro);
    setSessionCookie(res, signSessionToken({ userId: user.id, email: user.email, isPro: user.is_pro }));
    return res.json({ token, user: { id: user.id, email: user.email, is_pro: user.is_pro } });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Server error, please try again' });
  }
};
