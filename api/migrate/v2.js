const { sql } = require('../../lib/db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Simple secret check so only you can run this
  const secret = req.headers['x-migrate-secret'] || req.body?.secret;
  if (secret !== process.env.JWT_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS game_scores (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        game_type  VARCHAR(30) NOT NULL,
        score      INTEGER NOT NULL DEFAULT 0,
        played_at  DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_game_scores_user ON game_scores(user_id, game_type)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_game_scores_lookup ON game_scores(game_type, played_at)`;

    await sql`
      CREATE TABLE IF NOT EXISTS waitlist (
        id         SERIAL PRIMARY KEY,
        email      VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    return res.json({ ok: true, message: 'Migration v2 complete' });
  } catch (err) {
    console.error('Migration error:', err);
    return res.status(500).json({ error: err.message });
  }
};
