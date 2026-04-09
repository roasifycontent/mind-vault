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

async function postLoops(payload, rawKey) {
  try {
    const key = (rawKey == null ? '' : String(rawKey)).trim();
    const res = await fetch('https://app.loops.so/api/v1/contacts/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
    });
    const bodyText = await res.text().catch(() => '');
    return { status: res.status, ok: res.ok, body: bodyText.slice(0, 500) };
  } catch (err) {
    return { ok: false, reason: 'network_error', error: err && err.message ? err.message : String(err) };
  }
}

// Hits Loops' API-key validation endpoint to check whether the key itself
// authenticates at all, independent of /contacts/create.
async function testLoopsApiKey(rawKey) {
  try {
    const key = (rawKey == null ? '' : String(rawKey)).trim();
    const res = await fetch('https://app.loops.so/api/v1/api-key', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${key}`,
      },
    });
    const bodyText = await res.text().catch(() => '');
    return { status: res.status, ok: res.ok, body: bodyText.slice(0, 500) };
  } catch (err) {
    return { ok: false, reason: 'network_error', error: err && err.message ? err.message : String(err) };
  }
}

async function sendToLoops(email, source, utm, mode = 'full') {
  const rawKey = process.env.LOOPS_API_KEY;
  if (!rawKey) {
    console.error('[Loops] MISSING LOOPS_API_KEY env var — skipping sync for', email);
    return { ok: false, reason: 'missing_api_key' };
  }

  console.log(`[Loops] Syncing ${email} (source: ${source}, mode: ${mode})`);

  // Build payload according to mode:
  //   - minimal: only email + subscribed (no custom properties)
  //   - bare: only email
  //   - full: email + subscribed + funnel_source + UTM custom properties
  let payload;
  if (mode === 'bare') {
    payload = { email };
  } else if (mode === 'minimal') {
    payload = { email, subscribed: true };
  } else {
    payload = { email, subscribed: true, funnel_source: source };
    if (utm) {
      if (utm.utm_source)   payload.utm_source   = utm.utm_source;
      if (utm.utm_medium)   payload.utm_medium   = utm.utm_medium;
      if (utm.utm_campaign) payload.utm_campaign = utm.utm_campaign;
      if (utm.utm_content)  payload.utm_content  = utm.utm_content;
      if (utm.utm_term)     payload.utm_term     = utm.utm_term;
    }
  }

  const r = await postLoops(payload, rawKey);

  if (r.ok) {
    console.log(`[Loops] OK ${r.status} ${email}`);
    return { ok: true, status: r.status, mode, body: r.body };
  }
  console.error(`[Loops] FAIL ${r.status || '?'} ${email} — ${r.body || r.error}`);
  return { ok: false, reason: r.reason || 'api_error', status: r.status, mode, body: r.body, error: r.error };
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

  // Opt-in diagnostic mode: ?debug=1 echoes Loops result and env flag.
  const debug = req.query && (req.query.debug === '1' || req.query.debug === 'true');
  // Opt-in payload probe: ?probe=minimal|bare|full — controls Loops payload shape.
  const probeMode = (req.query && req.query.probe) || 'full';

  try {
    await sql`
      INSERT INTO waitlist (email, utm_source, utm_medium, utm_campaign, utm_content, utm_term)
      VALUES (${trimmed}, ${utm_source}, ${utm_medium}, ${utm_campaign}, ${utm_content}, ${utm_term})
    `;

    // Await the Loops sync so Vercel doesn't freeze the function before it completes.
    // sendToLoops never throws — all errors are caught internally and logged.
    const loopsResult = await sendToLoops(trimmed, source || 'unknown', utmObj, probeMode);

    if (debug) {
      const rk = process.env.LOOPS_API_KEY || '';
      const tk = rk.trim();
      const keyTest = await testLoopsApiKey(rk);
      return res.json({
        ok: true,
        _debug: {
          has_loops_key: !!rk,
          loops_key_len_raw: rk.length,
          loops_key_len_trimmed: tk.length,
          loops_key_first_cc: rk.length ? rk.charCodeAt(0) : null,
          loops_key_last_cc: rk.length ? rk.charCodeAt(rk.length - 1) : null,
          loops_key_has_whitespace: /\s/.test(rk),
          loops_key_test: keyTest,
          loops: loopsResult,
        },
      });
    }

    return res.json({ ok: true });

  } catch (err) {
    // Unique constraint violation = already registered
    if (err.code === '23505' || (err.message && err.message.includes('unique'))) {
      // Still sync to Loops in case they weren't added there before
      const loopsResult = await sendToLoops(trimmed, source || 'unknown', utmObj, probeMode);
      if (debug) {
        const rk = process.env.LOOPS_API_KEY || '';
        const tk = rk.trim();
        return res.status(409).json({
          error: 'Already registered',
          _debug: {
            has_loops_key: !!rk,
            loops_key_len_raw: rk.length,
            loops_key_len_trimmed: tk.length,
            loops_key_first_cc: rk.length ? rk.charCodeAt(0) : null,
            loops_key_last_cc: rk.length ? rk.charCodeAt(rk.length - 1) : null,
            loops_key_has_whitespace: /\s/.test(rk),
            loops: loopsResult,
          },
        });
      }
      return res.status(409).json({ error: 'Already registered' });
    }
    console.error('Waitlist error:', err);
    if (debug) {
      return res.status(500).json({
        error: 'Server error',
        _debug: { db_error: err && err.message ? err.message : String(err) },
      });
    }
    return res.status(500).json({ error: 'Server error' });
  }
};
