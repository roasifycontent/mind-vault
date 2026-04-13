const { sql } = require('../lib/db');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Sanitize a single UTM value: trim, coerce to string, cap length, null if empty.
function cleanUtm(v) {
  if (v == null) return null;
  const s = String(v).trim().slice(0, 255);
  return s || null;
}

// Loops' /contacts/create endpoint has a quirk where it returns plain-text
// HTTP 500 "Internal Server Error" even when the contact write succeeds.
// We log it as a warning but treat it as non-fatal so we don't spam the
// Vercel error log with false negatives. Verified by manual inspection:
// contacts DO land in the Loops dashboard even when this 500 is returned.
function isLoopsSilentSuccess(status, body) {
  return status === 500 && /internal server error/i.test(body || '');
}

async function sendToLoops(email, source, utm, extras) {
  const rawKey = process.env.LOOPS_API_KEY;
  if (!rawKey) {
    console.error('[Loops] MISSING LOOPS_API_KEY env var — skipping sync for', email);
    return { ok: false, reason: 'missing_api_key' };
  }

  // Trim defensively — the key in Vercel has historically had a trailing \n.
  const key = String(rawKey).trim();

  const payload = { email, subscribed: true, funnel_source: source };
  if (utm) {
    if (utm.utm_source)   payload.utm_source   = utm.utm_source;
    if (utm.utm_medium)   payload.utm_medium   = utm.utm_medium;
    if (utm.utm_campaign) payload.utm_campaign = utm.utm_campaign;
    if (utm.utm_content)  payload.utm_content  = utm.utm_content;
    if (utm.utm_term)     payload.utm_term     = utm.utm_term;
  }
  // Forward quiz score data for email personalisation
  if (extras) {
    if (extras.memoryScore != null) payload.memoryScore = Number(extras.memoryScore) || 0;
    if (extras.weakArea)            payload.weakArea    = String(extras.weakArea).slice(0, 100);
  }

  try {
    const res = await fetch('https://app.loops.so/api/v1/contacts/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
    });
    const bodyText = await res.text().catch(() => '');

    if (res.ok) {
      console.log(`[Loops] OK ${res.status} ${email}`);
      return { ok: true, status: res.status };
    }

    // 409 = already exists in Loops. That's fine, treat as success.
    if (res.status === 409) {
      console.log(`[Loops] EXISTS ${email}`);
      return { ok: true, status: 409, alreadyExists: true };
    }

    // Known Loops quirk: plain-text 500 while the contact actually lands.
    if (isLoopsSilentSuccess(res.status, bodyText)) {
      console.warn(`[Loops] SILENT-SUCCESS 500 ${email} (contact still created on Loops side)`);
      return { ok: true, status: 500, silentSuccess: true };
    }

    console.error(`[Loops] FAIL ${res.status} ${email} — ${bodyText.slice(0, 300)}`);
    return { ok: false, reason: 'api_error', status: res.status, body: bodyText.slice(0, 300) };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.error(`[Loops] NETWORK ERROR ${email} — ${msg}`);
    return { ok: false, reason: 'network_error', error: msg };
  }
}

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const { email, source } = body;

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email is required' });
  }

  const trimmed = email.trim().toLowerCase();

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // Capture UTMs — sanitized, nullable
  const utm_source   = cleanUtm(body.utm_source);
  const utm_medium   = cleanUtm(body.utm_medium);
  const utm_campaign = cleanUtm(body.utm_campaign);
  const utm_content  = cleanUtm(body.utm_content);
  const utm_term     = cleanUtm(body.utm_term);
  const utmObj = { utm_source, utm_medium, utm_campaign, utm_content, utm_term };

  try {
    await sql`
      INSERT INTO waitlist (email, utm_source, utm_medium, utm_campaign, utm_content, utm_term)
      VALUES (${trimmed}, ${utm_source}, ${utm_medium}, ${utm_campaign}, ${utm_content}, ${utm_term})
    `;

    // Await the Loops sync so Vercel doesn't freeze the function before it completes.
    // sendToLoops never throws — all errors are caught internally and logged.
    // Build extras object from request body for Loops personalisation
    const extras = {
      memoryScore: body.memoryScore,
      weakArea: body.weakArea,
    };
    await sendToLoops(trimmed, source || 'unknown', utmObj, extras);

    return res.json({ ok: true });

  } catch (err) {
    // Unique constraint violation = already registered
    if (err.code === '23505' || (err.message && err.message.includes('unique'))) {
      // Still sync to Loops in case they weren't added there before
      const extras = { memoryScore: body.memoryScore, weakArea: body.weakArea };
      await sendToLoops(trimmed, source || 'unknown', utmObj, extras);
      return res.status(409).json({ error: 'Already registered' });
    }
    console.error('Waitlist error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
