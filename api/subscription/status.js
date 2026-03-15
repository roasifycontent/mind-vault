// v2 — live Stripe subscription lookup
const { sql } = require('../../lib/db');
const { verifyToken, tokenFromRequest } = require('../../lib/auth');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = tokenFromRequest(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const { userId } = verifyToken(token);

    const rows = await sql`
      SELECT is_pro, stripe_customer_id, stripe_subscription_id,
             subscription_status, current_period_end
      FROM users
      WHERE id = ${userId}
    `;

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = rows[0];

    // Default response for users with no subscription
    let plan = null;
    let renewalDate = null;
    let cancelled = false;

    // If user has a Stripe subscription, fetch live data
    if (user.stripe_subscription_id && process.env.STRIPE_SECRET_KEY) {
      try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const sub = await stripe.subscriptions.retrieve(user.stripe_subscription_id);

        // Determine plan from recurring interval
        const interval = sub.items?.data?.[0]?.price?.recurring?.interval;
        plan = interval === 'year' ? 'annual' : 'monthly';

        // Renewal date from Stripe (epoch seconds → ISO)
        if (sub.current_period_end) {
          renewalDate = new Date(sub.current_period_end * 1000).toISOString();
        }

        // Cancelled = set to cancel at end of billing period
        cancelled = sub.cancel_at_period_end === true;

      } catch (err) {
        // Stripe lookup failed — fall back to DB values
        console.warn('Stripe subscription lookup failed:', err.message);
        cancelled = user.subscription_status === 'cancelled';
        if (user.current_period_end) {
          renewalDate = new Date(user.current_period_end).toISOString();
        }
      }
    } else {
      // No Stripe subscription — use DB values only
      cancelled = user.subscription_status === 'cancelled';
      if (user.current_period_end) {
        renewalDate = new Date(user.current_period_end).toISOString();
      }
    }

    return res.status(200).json({
      is_pro: user.is_pro || false,
      plan,
      renewal_date: renewalDate,
      cancelled,
    });

  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired, please sign in again' });
    }
    console.error('Subscription status error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
