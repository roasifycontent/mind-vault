// GET /api/auth/check
// Checks current session from httpOnly cookie or Bearer token
const { sql } = require('../../lib/db');
const { verifyToken, tokenFromRequest } = require('../../lib/auth');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true',
};

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = tokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ authenticated: false, error: 'No session' });
  }

  try {
    const decoded = verifyToken(token);

    // Magic-link tokens are not session tokens
    if (decoded.purpose === 'magic-link') {
      return res.status(401).json({ authenticated: false, error: 'Invalid session' });
    }

    const userId = decoded.userId;
    if (!userId) {
      return res.status(401).json({ authenticated: false, error: 'Invalid session' });
    }

    const rows = await sql`
      SELECT id, email, is_pro, subscription_status, current_period_end
      FROM users WHERE id = ${userId}
    `;

    if (!rows || rows.length === 0) {
      return res.status(401).json({ authenticated: false, error: 'User not found' });
    }

    const user = rows[0];

    return res.status(200).json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        is_pro: user.is_pro || false,
        subscription_status: user.subscription_status || null,
        current_period_end: user.current_period_end || null,
      },
    });

  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ authenticated: false, error: 'Session expired' });
    }
    console.error('Auth check error:', err);
    return res.status(500).json({ authenticated: false, error: 'Server error' });
  }
};
