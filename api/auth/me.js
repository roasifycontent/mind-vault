const { sql } = require('../../lib/db');
const { verifyToken, tokenFromRequest } = require('../../lib/auth');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = tokenFromRequest(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const { userId } = verifyToken(token);

    const [row] = await sql`
      SELECT u.id, u.email, u.is_pro,
             COALESCE(s.streak, 0) AS streak,
             COALESCE(s.games_played, 0) AS games_played,
             COALESCE(s.best_score, 0) AS best_score
      FROM users u
      LEFT JOIN user_stats s ON s.user_id = u.id
      WHERE u.id = ${userId}
    `;

    if (!row) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      id:           row.id,
      email:        row.email,
      is_pro:       row.is_pro || false,
      streak:       row.streak,
      games_played: row.games_played,
      best_score:   row.best_score,
    });

  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired, please sign in again' });
    }
    console.error('Auth me error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
