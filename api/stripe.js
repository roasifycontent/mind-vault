const { sql } = require('../lib/db');
const { verifyToken, tokenFromRequest } = require('../lib/auth');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe not configured');
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

function authUser(req) {
  const token = tokenFromRequest(req);
  if (!token) return null;
  return verifyToken(token);
}

// POST /api/stripe?action=checkout
async function createCheckoutSession(req, res) {
  const decoded = authUser(req);
  if (!decoded) return res.status(401).json({ error: 'Authentication required' });

  const { price_id, success_url, cancel_url } = req.body || {};
  if (!price_id) return res.status(400).json({ error: 'price_id is required' });

  const rows = await sql`SELECT id, email FROM users WHERE id = ${decoded.userId}`;
  if (!rows || rows.length === 0) return res.status(404).json({ error: 'User not found' });
  const user = rows[0];

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: user.email,
    line_items: [{ price: price_id, quantity: 1 }],
    metadata: { user_id: String(user.id) },
    allow_promotion_codes: true,
    subscription_data: { trial_period_days: 7 },
    success_url: (success_url || req.headers.origin) + '?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: cancel_url || req.headers.origin,
  });

  return res.status(200).json({ session_url: session.url, session_id: session.id });
}

// GET /api/stripe?action=session&session_id=xxx
async function getSession(req, res) {
  const decoded = authUser(req);
  if (!decoded) return res.status(401).json({ error: 'Authentication required' });

  const sessionId = req.query.session_id;
  if (!sessionId) return res.status(400).json({ error: 'session_id is required' });

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);

  return res.status(200).json({
    status: session.status,
    customer_email: session.customer_email,
    payment_status: session.payment_status,
    subscription: session.subscription,
  });
}

// POST /api/stripe?action=portal
async function createPortalSession(req, res) {
  const decoded = authUser(req);
  if (!decoded) return res.status(401).json({ error: 'Authentication required' });

  const rows = await sql`SELECT stripe_customer_id FROM users WHERE id = ${decoded.userId}`;
  if (!rows || rows.length === 0) return res.status(404).json({ error: 'User not found' });

  const customerId = rows[0].stripe_customer_id;
  if (!customerId) return res.status(400).json({ error: 'No subscription found' });

  const stripe = getStripe();
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: req.headers.origin || process.env.APP_URL || 'https://recallbetter.com',
  });

  return res.status(200).json({ url: portalSession.url });
}

// GET /api/stripe?action=status
async function getSubscriptionStatus(req, res) {
  const decoded = authUser(req);
  if (!decoded) return res.status(401).json({ error: 'Authentication required' });

  const rows = await sql`
    SELECT is_pro, stripe_customer_id, stripe_subscription_id,
           subscription_status, current_period_end
    FROM users WHERE id = ${decoded.userId}
  `;
  if (!rows || rows.length === 0) return res.status(404).json({ error: 'User not found' });

  const user = rows[0];
  let plan = null, renewalDate = null, cancelled = false;

  if (user.stripe_subscription_id && process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = getStripe();
      const sub = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
      const interval = sub.items?.data?.[0]?.price?.recurring?.interval;
      plan = interval === 'year' ? 'annual' : 'monthly';
      if (sub.current_period_end) renewalDate = new Date(sub.current_period_end * 1000).toISOString();
      cancelled = sub.cancel_at_period_end === true;
    } catch (_) {
      cancelled = user.subscription_status === 'cancelled';
      if (user.current_period_end) renewalDate = new Date(user.current_period_end).toISOString();
    }
  } else {
    cancelled = user.subscription_status === 'cancelled';
    if (user.current_period_end) renewalDate = new Date(user.current_period_end).toISOString();
  }

  return res.status(200).json({ is_pro: user.is_pro || false, plan, renewal_date: renewalDate, cancelled });
}

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action || req.body?.action;

  try {
    if (req.method === 'POST' && action === 'checkout') return await createCheckoutSession(req, res);
    if (req.method === 'POST' && action === 'portal') return await createPortalSession(req, res);
    if (req.method === 'GET' && action === 'session') return await getSession(req, res);
    if (req.method === 'GET' && action === 'status') return await getSubscriptionStatus(req, res);

    return res.status(400).json({ error: 'Invalid action. Use: checkout, portal, session, or status' });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired, please sign in again' });
    }
    console.error('Stripe API error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
