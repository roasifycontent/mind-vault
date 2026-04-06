// Unified auth handler — routes by query param ?action= or path
// Consolidates all auth endpoints into a single serverless function
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sql } = require('../lib/db');
const { signToken, signSessionToken, signMagicToken, verifyToken, tokenFromRequest, setSessionCookie, clearSessionCookie } = require('../lib/auth');
const { checkRateLimit, getIp } = require('../lib/rate-limit');
const { sendEmail, magicLinkEmail, welcomeEmail } = require('../lib/email');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const BASE_URL = () => process.env.APP_URL || 'https://recallbetter.com';

function redirect(res, path) {
  res.writeHead(302, { Location: BASE_URL() + path });
  res.end();
}

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action || '';

  try {
    switch (action) {
      case 'login':         return await handleLogin(req, res);
      case 'register':      return await handleRegister(req, res);
      case 'google':        return await handleGoogle(req, res);
      case 'magic-link':    return await handleMagicLink(req, res);
      case 'verify':        return await handleVerify(req, res);
      case 'checkout-success': return await handleCheckoutSuccess(req, res);
      case 'check':         return await handleCheck(req, res);
      case 'logout':        return await handleLogout(req, res);
      case 'me':            return await handleMe(req, res);
      case 'forgot-password': return await handleForgotPassword(req, res);
      case 'reset-password':  return await handleResetPassword(req, res);
      default:
        return res.status(400).json({ error: 'Unknown action: ' + action });
    }
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/* ── LOGIN ── */
async function handleLogin(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  try {
    const { allowed, remaining } = await checkRateLimit(getIp(req), 'login');
    if (!allowed) return res.status(429).json({ error: 'Too many attempts. Please try again in an hour.' });
    res.setHeader('X-RateLimit-Remaining', remaining);
  } catch (_) { /* fail open */ }

  const [user] = await sql`SELECT id, email, password_hash, is_pro FROM users WHERE email = ${email.toLowerCase()}`;
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  const token = signToken(user.id, user.is_pro);
  setSessionCookie(res, signSessionToken({ userId: user.id, email: user.email, isPro: user.is_pro }));
  return res.json({ token, user: { id: user.id, email: user.email, is_pro: user.is_pro } });
}

/* ── REGISTER ── */
async function handleRegister(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email, password } = req.body || {};

  try {
    const { allowed } = await checkRateLimit(getIp(req), 'register');
    if (!allowed) return res.status(429).json({ error: 'Too many attempts. Please try again in an hour.' });
  } catch (_) { /* fail open */ }

  if (!email || typeof email !== 'string' || !email.includes('@')) return res.status(400).json({ error: 'Valid email is required' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const hash = await bcrypt.hash(password, 12);
    const [user] = await sql`INSERT INTO users (email, password_hash) VALUES (${email.toLowerCase()}, ${hash}) RETURNING id, email`;
    await sql`INSERT INTO user_stats (user_id) VALUES (${user.id}) ON CONFLICT (user_id) DO NOTHING`;
    const token = signToken(user.id, false);
    setSessionCookie(res, signSessionToken({ userId: user.id, email: user.email, isPro: false }));
    return res.status(201).json({ token, user: { id: user.id, email: user.email, is_pro: false } });
  } catch (err) {
    if (err.message?.includes('unique') || err.code === '23505') return res.status(409).json({ error: 'An account with that email already exists' });
    throw err;
  }
}

/* ── GOOGLE ── */
async function handleGoogle(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: 'Google credential is required' });

  const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!verifyRes.ok) return res.status(401).json({ error: 'Invalid Google token' });

  const payload = await verifyRes.json();
  const expectedAud = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const actualAud = (payload.aud || '').trim();
  if (actualAud !== expectedAud) return res.status(401).json({ error: 'Token audience mismatch' });

  const email = payload.email?.toLowerCase();
  if (!email) return res.status(401).json({ error: 'No email found in Google token' });

  const [existing] = await sql`SELECT id, email, is_pro FROM users WHERE email = ${email}`;
  if (existing) {
    const token = signToken(existing.id, existing.is_pro);
    setSessionCookie(res, signSessionToken({ userId: existing.id, email: existing.email, isPro: existing.is_pro }));
    return res.json({ token, user: { id: existing.id, email: existing.email, is_pro: existing.is_pro } });
  }

  const randomPass = crypto.randomBytes(32).toString('hex');
  const hash = await bcrypt.hash(randomPass, 12);
  const [user] = await sql`INSERT INTO users (email, password_hash) VALUES (${email}, ${hash}) RETURNING id, email`;
  await sql`INSERT INTO user_stats (user_id) VALUES (${user.id}) ON CONFLICT (user_id) DO NOTHING`;
  const token = signToken(user.id, false);
  setSessionCookie(res, signSessionToken({ userId: user.id, email: user.email, isPro: false }));
  return res.status(201).json({ token, user: { id: user.id, email: user.email, is_pro: false } });
}

/* ── MAGIC LINK ── */
async function handleMagicLink(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email } = req.body || {};
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email is required' });

  const cleanEmail = email.toLowerCase().trim();
  const rows = await sql`SELECT id, email, is_pro FROM users WHERE email = ${cleanEmail}`;

  if (!rows || rows.length === 0) {
    console.log('Magic link requested for unknown email:', cleanEmail);
    return res.status(200).json({ sent: true }); // Don't reveal existence
  }

  const token = signMagicToken(cleanEmail);
  const magicUrl = `${BASE_URL()}/api/auth?action=verify&token=${token}`;

  const result = await sendEmail({
    to: cleanEmail,
    subject: 'Sign in to Recall Better',
    html: magicLinkEmail(magicUrl),
  });
  if (!result.success) console.error('Failed to send magic link to', cleanEmail, result.error);

  return res.status(200).json({ sent: true });
}

/* ── VERIFY (magic link click) ── */
async function handleVerify(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { token } = req.query || {};
  if (!token) return redirect(res, '/login?error=missing-token');

  try {
    const decoded = verifyToken(token);
    if (decoded.purpose !== 'magic-link' || !decoded.email) return redirect(res, '/login?error=invalid-token');

    const email = decoded.email.toLowerCase().trim();
    const rows = await sql`SELECT id, email, is_pro FROM users WHERE email = ${email}`;
    if (!rows || rows.length === 0) return redirect(res, '/login?error=no-account');

    const user = rows[0];
    const sessionToken = signSessionToken({ userId: user.id, email: user.email, isPro: user.is_pro || false });
    setSessionCookie(res, sessionToken);
    return redirect(res, '/app');
  } catch (err) {
    if (err.name === 'TokenExpiredError') return redirect(res, '/login?error=expired');
    if (err.name === 'JsonWebTokenError') return redirect(res, '/login?error=invalid-token');
    console.error('Magic link verify error:', err);
    return redirect(res, '/login?error=server-error');
  }
}

/* ── CHECKOUT SUCCESS ── */
async function handleCheckoutSuccess(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const sessionId = req.query.session_id;
  if (!sessionId) return redirect(res, '/login?error=missing-session');

  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session || session.payment_status !== 'paid') return redirect(res, '/login?error=payment-incomplete');
    if (session.metadata?.app && session.metadata.app !== 'recall-better') return redirect(res, '/login?error=wrong-app');

    const email = (session.customer_email || '').toLowerCase().trim();
    if (!email) return redirect(res, '/login?error=no-email');

    const customerId = session.customer;
    const subscriptionId = session.subscription;

    let rows = await sql`SELECT id, email, is_pro FROM users WHERE email = ${email}`;
    let user;

    if (rows && rows.length > 0) {
      user = rows[0];
      await sql`UPDATE users SET is_pro = true, stripe_customer_id = ${customerId}, stripe_subscription_id = ${subscriptionId}, subscription_status = 'active' WHERE id = ${user.id}`;
      user.is_pro = true;
    } else {
      const randomPass = crypto.randomBytes(32).toString('hex');
      const hash = await bcrypt.hash(randomPass, 12);
      const insertRows = await sql`INSERT INTO users (email, password_hash, is_pro, stripe_customer_id, stripe_subscription_id, subscription_status) VALUES (${email}, ${hash}, true, ${customerId}, ${subscriptionId}, 'active') RETURNING id, email, is_pro`;
      user = insertRows[0];
      await sql`INSERT INTO user_stats (user_id) VALUES (${user.id}) ON CONFLICT (user_id) DO NOTHING`;
    }

    const sessionToken = signSessionToken({ userId: user.id, email: user.email, isPro: true });
    setSessionCookie(res, sessionToken);

    // Welcome email (async)
    sendEmail({ to: email, subject: 'Welcome to Recall Better — your training starts now', html: welcomeEmail(`${BASE_URL()}/app`) }).catch(err => console.error('Welcome email failed:', err));

    return redirect(res, '/app?welcome=1');
  } catch (err) {
    console.error('Checkout success error:', err);
    return redirect(res, '/login?error=server-error');
  }
}

/* ── CHECK SESSION ── */
async function handleCheck(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = tokenFromRequest(req);
  if (!token) return res.status(401).json({ authenticated: false, error: 'No session' });

  try {
    const decoded = verifyToken(token);
    if (decoded.purpose === 'magic-link') return res.status(401).json({ authenticated: false, error: 'Invalid session' });

    const userId = decoded.userId;
    if (!userId) return res.status(401).json({ authenticated: false, error: 'Invalid session' });

    const rows = await sql`SELECT id, email, is_pro, subscription_status, current_period_end FROM users WHERE id = ${userId}`;
    if (!rows || rows.length === 0) return res.status(401).json({ authenticated: false, error: 'User not found' });

    const user = rows[0];
    return res.status(200).json({
      authenticated: true,
      user: { id: user.id, email: user.email, is_pro: user.is_pro || false, subscription_status: user.subscription_status || null, current_period_end: user.current_period_end || null },
    });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') return res.status(401).json({ authenticated: false, error: 'Session expired' });
    console.error('Auth check error:', err);
    return res.status(500).json({ authenticated: false, error: 'Server error' });
  }
}

/* ── LOGOUT ── */
async function handleLogout(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  clearSessionCookie(res);
  return res.status(200).json({ success: true });
}

/* ── ME (legacy — validates token, returns user) ── */
async function handleMe(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = tokenFromRequest(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const { userId } = verifyToken(token);
    const rows = await sql`
      SELECT u.id, u.email, u.is_pro,
             COALESCE(s.streak, 0) AS streak,
             COALESCE(s.games_played, 0) AS games_played,
             COALESCE(s.best_score, 0) AS best_score
      FROM users u LEFT JOIN user_stats s ON s.user_id = u.id
      WHERE u.id = ${userId}
    `;
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const row = rows[0];
    return res.status(200).json({
      id: row.id, email: row.email, is_pro: row.is_pro || false,
      streak: parseInt(row.streak) || 0, games_played: parseInt(row.games_played) || 0, best_score: parseInt(row.best_score) || 0,
    });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Session expired, please sign in again' });
    console.error('Auth /me error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

/* ── FORGOT PASSWORD ── */
async function handleForgotPassword(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email } = req.body || {};
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email is required' });

  const cleanEmail = email.toLowerCase().trim();
  const [user] = await sql`SELECT id, email FROM users WHERE email = ${cleanEmail}`;
  if (!user) return res.status(200).json({ sent: true }); // Don't reveal

  // Generate reset token
  const resetToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await sql`INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (${user.id}, ${resetToken}, ${expiresAt.toISOString()}) ON CONFLICT (user_id) DO UPDATE SET token = ${resetToken}, expires_at = ${expiresAt.toISOString()}, created_at = NOW()`;

  const resetUrl = `${BASE_URL()}/reset-password?token=${resetToken}`;
  await sendEmail({
    to: cleanEmail,
    subject: 'Reset your Recall Better password',
    html: `<p>Click here to reset your password: <a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour.</p>`,
  }).catch(err => console.error('Reset email failed:', err));

  return res.status(200).json({ sent: true });
}

/* ── RESET PASSWORD ── */
async function handleResetPassword(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { token: resetToken, password } = req.body || {};
  if (!resetToken || !password || password.length < 6) return res.status(400).json({ error: 'Token and password (min 6 chars) required' });

  const [row] = await sql`SELECT user_id, expires_at FROM password_reset_tokens WHERE token = ${resetToken}`;
  if (!row) return res.status(400).json({ error: 'Invalid or expired reset token' });
  if (new Date(row.expires_at) < new Date()) {
    await sql`DELETE FROM password_reset_tokens WHERE token = ${resetToken}`;
    return res.status(400).json({ error: 'Reset token has expired' });
  }

  const hash = await bcrypt.hash(password, 12);
  await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${row.user_id}`;
  await sql`DELETE FROM password_reset_tokens WHERE user_id = ${row.user_id}`;

  return res.status(200).json({ success: true });
}
