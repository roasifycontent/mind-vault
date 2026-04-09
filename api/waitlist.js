const { sql } = require('../lib/db');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function sendToLoops(email, source) {
  if (!process.env.LOOPS_API_KEY) {
    console.error('[Loops] MISSING LOOPS_API_KEY env var — skipping sync for', email);
    return;
  }

  console.log(`[Loops] Syncing ${email} (source: ${source})`);

  try {
    const res = await fetch('https://app.loops.so/api/v1/contacts/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.LOOPS_API_KEY}`,
      },
      body: JSON.stringify({ email, subscribed: true, funnel_source: source }),
    });

    const bodyText = await res.text().catch(() => '');

    if (res.ok) {
      console.log(`[Loops] OK ${res.status} ${email}`);
    } else {
      console.error(`[Loops] FAIL ${res.status} ${email} — ${bodyText}`);
    }
  } catch (err) {
    console.error(`[Loops] NETWORK ERROR ${email} — ${err && err.message ? err.message : err}`);
  }
}

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, source } = req.body || {};

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email is required' });
  }

  const trimmed = email.trim().toLowerCase();

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  try {
    await sql`
      INSERT INTO waitlist (email) VALUES (${trimmed})
    `;

    // Await the Loops sync so Vercel doesn't freeze the function before it completes.
    // sendToLoops never throws — all errors are caught internally and logged.
    await sendToLoops(trimmed, source || 'unknown');

    return res.json({ ok: true });

  } catch (err) {
    // Unique constraint violation = already registered
    if (err.code === '23505' || (err.message && err.message.includes('unique'))) {
      // Still sync to Loops in case they weren't added there before
      await sendToLoops(trimmed, source || 'unknown');
      return res.status(409).json({ error: 'Already registered' });
    }
    console.error('Waitlist error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
