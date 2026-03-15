const { sql } = require('../../lib/db');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const VALID_GAMES = ['word', 'sequence', 'symbol', 'gridmem', 'missing', 'growing', 'pairs'];

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const score = parseInt(req.query.score);
  const game  = req.query.game;

  if (isNaN(score) || score < 0 || score > 100) {
    return res.status(400).json({ error: 'score must be 0-100' });
  }
  if (!game || !VALID_GAMES.includes(game)) {
    return res.status(400).json({ error: 'Invalid game type' });
  }

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffISO = cutoff.toISOString().split('T')[0];

    const [stats] = await sql`
      SELECT
        COUNT(*)::int AS sample_size,
        COUNT(*) FILTER (WHERE score < ${score})::int AS below
      FROM game_scores
      WHERE game_type = ${game}
        AND played_at >= ${cutoffISO}::date
    `;

    const sample_size = stats?.sample_size || 0;

    if (sample_size < 10) {
      return res.json({ percentile: null, sample_size });
    }

    const percentile = Math.round((stats.below / sample_size) * 100);

    return res.json({ percentile, sample_size });

  } catch (err) {
    console.error('Percentile error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
