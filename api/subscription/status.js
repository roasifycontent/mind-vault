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

    const [user] = await sql`
      SELECT is_pro, stripe_customer_id, stripe_subscription_id,
             subscription_status, current_period_end
      FROM users
      WHERE id = ${userId}
    `;

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Determine plan type from subscription if active
    let plan = null;
    let renewalDate = null;
    const cancelled = user.subscription_status === 'cancelled';

    if (user.is_pro && user.current_period_end) {
      renewalDate = new Date(user.current_period_end).toISOString();
    }

    // Try to determine plan from Stripe if we have a subscription
    if (user.is_pro && user.stripe_subscription_id && process.env.STRIPE_SECRET_KEY) {
      try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const sub = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
        const priceId = sub.items?.data?.[0]?.price?.id;
        if (priceId === process.env.STRIPE_PRICE_ID_MONTHLY) plan = 'monthly';
        else if (priceId === process.env.STRIPE_PRICE_ID_ANNUAL) plan = 'annual';
        else plan = 'monthly'; // fallback
        if (sub.current_period_end) {
          renewalDate = new Date(sub.current_period_end * 1000).toISOString();
        }
      } catch (_) {
        // Stripe lookup failed — use DB values only
      }
    }

    return res.json({
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
