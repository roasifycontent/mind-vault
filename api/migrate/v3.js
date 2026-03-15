const { sql } = require('../../lib/db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const secret = req.headers['x-migrate-secret'] || req.body?.secret;
  if (secret !== process.env.JWT_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Add Stripe columns to users table
    await sql`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(30) DEFAULT 'inactive',
      ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ
    `;

    return res.json({ ok: true, message: 'Migration v3 complete — Stripe columns added' });
  } catch (err) {
    console.error('Migration v3 error:', err);
    return res.status(500).json({ error: err.message });
  }
};
