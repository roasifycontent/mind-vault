const { sql } = require('../../lib/db');
const { verifyToken, tokenFromRequest } = require('../../lib/auth');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const VALID_GAMES = ['word', 'sequence', 'symbol', 'gridmem', 'missing', 'growing', 'pairs'];

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = tokenFromRequest(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const { userId } = verifyToken(token);
    const { scores = [], games_played = 0, streak = 0, last_played = null, game_type = null } = req.body || {};

    const best_score  = scores.length ? Math.max(...scores) : 0;
    const total_score = scores.reduce((a, b) => a + b, 0);

    await sql`
      INSERT INTO user_stats (user_id, scores, games_played, best_score, total_score, streak, last_played)
      VALUES (
        ${userId},
        ${JSON.stringify(scores)},
        ${games_played},
        ${best_score},
        ${total_score},
        ${streak},
        ${last_played}
      )
      ON CONFLICT (user_id) DO UPDATE SET
        scores       = EXCLUDED.scores,
        games_played = EXCLUDED.games_played,
        best_score   = EXCLUDED.best_score,
        total_score  = EXCLUDED.total_score,
        streak       = EXCLUDED.streak,
        last_played  = EXCLUDED.last_played,
        updated_at   = NOW()
    `;

    // Store per-game score if game_type provided
    if (game_type && VALID_GAMES.includes(game_type) && scores.length > 0) {
      const latestScore = scores[scores.length - 1];
      await sql`
        INSERT INTO game_scores (user_id, game_type, score, played_at)
        VALUES (${userId}, ${game_type}, ${latestScore}, ${last_played || new Date().toISOString().split('T')[0]})
      `;
    }

    return res.json({ ok: true });

  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired, please sign in again' });
    }
    console.error('Stats save error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
