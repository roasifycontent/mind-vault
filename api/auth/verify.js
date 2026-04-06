// GET /api/auth/verify?token=xxx
// Verifies a magic link token, creates session, redirects to /app
const { sql } = require('../../lib/db');
const { verifyToken, signSessionToken, setSessionCookie } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.query || {};
  if (!token) {
    return redirect(res, '/login?error=missing-token');
  }

  try {
    const decoded = verifyToken(token);

    // Must be a magic-link token
    if (decoded.purpose !== 'magic-link' || !decoded.email) {
      return redirect(res, '/login?error=invalid-token');
    }

    const email = decoded.email.toLowerCase().trim();

    // Look up user
    const rows = await sql`SELECT id, email, is_pro FROM users WHERE email = ${email}`;

    if (!rows || rows.length === 0) {
      return redirect(res, '/login?error=no-account');
    }

    const user = rows[0];

    // Create session token (30-day httpOnly cookie)
    const sessionToken = signSessionToken({
      userId: user.id,
      email: user.email,
      isPro: user.is_pro || false,
    });

    setSessionCookie(res, sessionToken);

    // Redirect to app
    return redirect(res, '/app');

  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return redirect(res, '/login?error=expired');
    }
    if (err.name === 'JsonWebTokenError') {
      return redirect(res, '/login?error=invalid-token');
    }
    console.error('Magic link verify error:', err);
    return redirect(res, '/login?error=server-error');
  }
};

function redirect(res, path) {
  const baseUrl = process.env.APP_URL || 'https://recallbetter.com';
  res.writeHead(302, { Location: baseUrl + path });
  res.end();
}
