const { sql } = require('./db');

// Max attempts per IP per endpoint per hour
const LIMIT = 15;

/**
 * Check rate limit for a given IP + endpoint.
 * Returns { allowed: boolean, remaining: number }.
 * Throws only on DB error (caller should fail open if desired).
 */
async function checkRateLimit(ip, endpoint) {
  // Truncate to current hour window
  const [row] = await sql`
    INSERT INTO rate_limits (ip, endpoint, window_start, count)
    VALUES (
      ${ip},
      ${endpoint},
      date_trunc('hour', now()),
      1
    )
    ON CONFLICT (ip, endpoint, window_start)
    DO UPDATE SET count = rate_limits.count + 1
    RETURNING count
  `;

  const count = row?.count ?? 1;
  const allowed = count <= LIMIT;
  const remaining = Math.max(0, LIMIT - count);

  // Probabilistic cleanup of old windows (1% chance per request)
  if (Math.random() < 0.01) {
    sql`DELETE FROM rate_limits WHERE window_start < now() - interval '2 hours'`.catch(() => {});
  }

  return { allowed, remaining };
}

/**
 * Get client IP from a Vercel serverless request.
 */
function getIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

module.exports = { checkRateLimit, getIp };
