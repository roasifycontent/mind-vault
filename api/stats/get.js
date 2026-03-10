const { sql } = require('../../lib/db');
const { verifyToken, tokenFromRequest } = require('../../lib/auth');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = tokenFromRequest(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const { userId } = verifyToken(token);

    const [stats] = await sql`
      SELECT games_played, best_score, total_score, scores, streak, last_played
      FROM user_stats
      WHERE user_id = ${userId}
    `;

    if (!stats) {
      return res.json({ games_played: 0, best_score: 0, scores: [], streak: 0, last_played: null });
    }

    return res.json({
      games_played: stats.games_played,
      best_score:   stats.best_score,
      scores:       stats.scores || [],
      streak:       stats.streak,
      last_played:  stats.last_played,
    });

  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired, please sign in again' });
    }
    console.error('Stats get error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
