const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is not set');

function signToken(userId, isPro = false) {
  return jwt.sign({ userId, is_pro: isPro }, JWT_SECRET, { expiresIn: '30d' });
}

function signSessionToken({ userId, email, isPro = false }) {
  return jwt.sign({ userId, email, is_pro: isPro }, JWT_SECRET, { expiresIn: '30d' });
}

function signMagicToken(email) {
  return jwt.sign({ email, purpose: 'magic-link' }, JWT_SECRET, { expiresIn: '15m' });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET); // throws if invalid/expired
}

function tokenFromRequest(req) {
  // 1. Try Authorization header (Bearer token)
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);

  // 2. Try rb_session cookie
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)rb_session=([^;]+)/);
  if (match) return match[1];

  return null;
}

function setSessionCookie(res, token) {
  const maxAge = 30 * 24 * 60 * 60; // 30 days
  res.setHeader('Set-Cookie', `rb_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'rb_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
}

module.exports = { signToken, signSessionToken, signMagicToken, verifyToken, tokenFromRequest, setSessionCookie, clearSessionCookie };
