#!/usr/bin/env node
/**
 * Create the 4 offer coupons in Stripe (idempotent).
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/create-offer-coupons.js
 *
 * Coupons created:
 *   RECALL20 — 20% off, once
 *   RECALL30 — 30% off, once
 *   RECALL40 — 40% off, once
 *   RECALL50 — 50% off, once
 *
 * Safe to re-run: checks if each coupon already exists before creating.
 */

const SECRET = process.env.STRIPE_SECRET_KEY;
if (!SECRET) {
  console.error('ERROR: STRIPE_SECRET_KEY env var is required.');
  console.error('Run like: STRIPE_SECRET_KEY=sk_live_... node scripts/create-offer-coupons.js');
  process.exit(1);
}

const stripe = require('stripe')(SECRET);

const COUPONS = [
  { id: 'RECALL20', name: '20% off first month', percent_off: 20 },
  { id: 'RECALL30', name: '30% off first month', percent_off: 30 },
  { id: 'RECALL40', name: '40% off first month', percent_off: 40 },
  { id: 'RECALL50', name: '50% off first month', percent_off: 50 },
];

(async () => {
  for (const c of COUPONS) {
    try {
      const existing = await stripe.coupons.retrieve(c.id);
      console.log(`[skip] ${c.id} already exists (${existing.percent_off}% off, duration=${existing.duration})`);
      continue;
    } catch (err) {
      if (err.statusCode !== 404 && err.code !== 'resource_missing') {
        console.error(`[error] looking up ${c.id}:`, err.message);
        process.exit(1);
      }
    }

    try {
      const created = await stripe.coupons.create({
        id: c.id,
        name: c.name,
        percent_off: c.percent_off,
        duration: 'once',
      });
      console.log(`[created] ${created.id} — ${created.percent_off}% off, duration=${created.duration}`);
    } catch (err) {
      console.error(`[error] creating ${c.id}:`, err.message);
      process.exit(1);
    }
  }
  console.log('Done.');
})();
