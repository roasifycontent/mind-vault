#!/usr/bin/env node
// One-time script: backfill Neon waitlist emails to Loops
// Usage: LOOPS_API_KEY=xxx node /tmp/backfill-loops.js

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL;
const LOOPS_API_KEY = process.env.LOOPS_API_KEY;

if (!DATABASE_URL || !LOOPS_API_KEY) {
  console.error('Missing DATABASE_URL or LOOPS_API_KEY env var');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function sendToLoops(email) {
  const res = await fetch('https://app.loops.so/api/v1/contacts/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LOOPS_API_KEY.trim()}`,
    },
    body: JSON.stringify({ email, subscribed: true, funnel_source: 'backfill' }),
  });
  // Loops' /contacts/create has a quirk where it returns plain-text
  // HTTP 500 "Internal Server Error" even when the contact actually
  // gets created. Handle both JSON and plain-text bodies.
  const text = await res.text().catch(() => '');
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 300) }; }
  return { status: res.status, body, rawText: text };
}

(async () => {
  console.log('Fetching emails from waitlist...');
  const rows = await sql`SELECT email, created_at FROM waitlist ORDER BY created_at ASC`;
  console.log(`Found ${rows.length} emails in waitlist table\n`);

  let created = 0;
  let alreadyExists = 0;
  let silentSuccess = 0;
  let failed = 0;
  const failures = [];

  for (const row of rows) {
    const email = row.email;
    try {
      const { status, body, rawText } = await sendToLoops(email);
      if (status === 200 || status === 201) {
        console.log(`  OK      ${email}`);
        created++;
      } else if (status === 409 || (body && body.message && String(body.message).toLowerCase().includes('already'))) {
        console.log(`  EXISTS  ${email}`);
        alreadyExists++;
      } else if (status === 500 && /internal server error/i.test(rawText || '')) {
        // Known Loops quirk — contact actually gets created.
        console.log(`  SILENT  ${email}  (Loops 500, contact still lands)`);
        silentSuccess++;
      } else {
        console.log(`  FAIL    ${email} (${status}) ${rawText ? rawText.slice(0,200) : JSON.stringify(body)}`);
        failed++;
        failures.push({ email, status, body, rawText });
      }
    } catch (err) {
      console.log(`  ERROR  ${email} — ${err.message}`);
      failed++;
      failures.push({ email, error: err.message });
    }
    // Small delay to be polite to Loops API
    await new Promise(r => setTimeout(r, 150));
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Total in DB:         ${rows.length}`);
  console.log(`Newly created:       ${created}`);
  console.log(`Already in Loops:    ${alreadyExists}`);
  console.log(`Silent-success 500s: ${silentSuccess}`);
  console.log(`Failed:              ${failed}`);
  if (failures.length) {
    console.log('\nFailures:', JSON.stringify(failures, null, 2));
  }
})().catch(err => {
  console.error('Script error:', err);
  process.exit(1);
});
