const { sql } = require('../lib/db');
const { verifyToken, tokenFromRequest } = require('../lib/auth');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const VALID_GAMES = ['word', 'sequence', 'symbol', 'gridmem', 'missing', 'growing', 'pairs'];

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = tokenFromRequest(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const { userId } = verifyToken(token);

    // ========== GET: fetch stats ==========
    if (req.method === 'GET') {
      const [row] = await sql`
        SELECT s.games_played, s.best_score, s.total_score, s.scores, s.streak, s.last_played, u.is_pro
        FROM user_stats s
        JOIN users u ON u.id = s.user_id
        WHERE s.user_id = ${userId}
      `;

      const base = row
        ? {
            games_played: row.games_played,
            best_score:   row.best_score,
            scores:       row.scores || [],
            streak:       row.streak,
            last_played:  row.last_played,
            is_pro:       row.is_pro || false,
          }
        : { games_played: 0, best_score: 0, scores: [], streak: 0, last_played: null, is_pro: false };

      if (!row) {
        const [user] = await sql`SELECT is_pro FROM users WHERE id = ${userId}`;
        base.is_pro = user?.is_pro || false;
      }

      let scores_by_game = {};
      let daily_scores = [];

      try {
        const gameRows = await sql`
          SELECT game_type, score, played_at
          FROM game_scores
          WHERE user_id = ${userId}
          ORDER BY played_at DESC, created_at DESC
        `;

        const counts = {};
        for (const r of gameRows) {
          const g = r.game_type;
          if (!scores_by_game[g]) scores_by_game[g] = [];
          if (!counts[g]) counts[g] = 0;
          if (counts[g] < 30) {
            scores_by_game[g].push(r.score);
            counts[g]++;
          }
        }

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 30);
        const cutoffISO = cutoff.toISOString().split('T')[0];

        daily_scores = gameRows
          .filter(r => {
            const d = typeof r.played_at === 'string' ? r.played_at : r.played_at?.toISOString?.()?.split('T')[0];
            return d && d >= cutoffISO;
          })
          .slice(0, 100)
          .map(r => ({
            date:  typeof r.played_at === 'string' ? r.played_at : r.played_at?.toISOString?.()?.split('T')[0],
            score: r.score,
            game:  r.game_type,
          }));
      } catch (e) {
        console.warn('game_scores query failed (table may not exist):', e.message);
      }

      return res.json({ ...base, scores_by_game, daily_scores });
    }

    // ========== POST: save stats ==========
    if (req.method === 'POST') {
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

      if (game_type && VALID_GAMES.includes(game_type) && scores.length > 0) {
        const latestScore = scores[scores.length - 1];
        await sql`
          INSERT INTO game_scores (user_id, game_type, score, played_at)
          VALUES (${userId}, ${game_type}, ${latestScore}, ${last_played || new Date().toISOString().split('T')[0]})
        `;
      }

      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired, please sign in again' });
    }
    console.error('Stats error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
