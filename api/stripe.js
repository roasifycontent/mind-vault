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

// POST /api/stripe?action=public-checkout (no auth - for quiz pages)
const PUBLIC_PRICE_MAP = {
  weekly:    'price_1THN9rAWM5kTbKjpw42Yp8t7',
  monthly:   'price_1THN9uAWM5kTbKjpFvvvh3YB',
  quarterly: 'price_1THN9xAWM5kTbKjpMoMkkNM4',
  yearly:    'price_1THN9xAWM5kTbKjpMoMkkNM4',
};

const PRICES2_MAP = {
  weekly:    'price_1THfyIAWM5kTbKjpTRMQs07H',   // $6.93/week
  monthly:   'price_1THfyJAWM5kTbKjpqqF9jX1I',   // $19.99/month
  quarterly: 'price_1THfyKAWM5kTbKjpL3YoASM5',   // $39.99/3 months
  yearly:    'price_1THfyKAWM5kTbKjpL3YoASM5',
};

async function createPublicCheckout(req, res) {
  const { plan, email, pricing } = req.body || {};

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const priceMap = pricing === 'prices2' ? PRICES2_MAP : PUBLIC_PRICE_MAP;
  const priceId = priceMap[plan];
  if (!priceId) {
    return res.status(400).json({ error: 'Invalid plan. Use: weekly, monthly, or quarterly' });
  }

  const stripe = getStripe();

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: email.toLowerCase().trim(),
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { app: 'recall-better', plan, source: 'quiz' },
    allow_promotion_codes: true,
    subscription_data: {
      metadata: { app: 'recall-better', plan },
    },
    success_url: 'https://recallbetter.com/app?checkout=success&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://recallbetter.com/quiz',
  });

  return res.status(200).json({ url: session.url });
}

// POST /api/stripe?action=embedded-checkout (no auth - native payment form)
async function createEmbeddedCheckout(req, res) {
  const { plan, email, pricing } = req.body || {};

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const priceMap = pricing === 'prices2' ? PRICES2_MAP : PUBLIC_PRICE_MAP;
  const priceId = priceMap[plan];
  if (!priceId) {
    return res.status(400).json({ error: 'Invalid plan. Use: weekly, monthly, or quarterly' });
  }

  const stripe = getStripe();
  const cleanEmail = email.toLowerCase().trim();

  // Find or create customer
  const existing = await stripe.customers.list({ email: cleanEmail, limit: 1 });
  let customer;
  if (existing.data.length > 0) {
    customer = existing.data[0];
  } else {
    customer = await stripe.customers.create({
      email: cleanEmail,
      metadata: { app: 'recall-better', source: 'quiz-embedded' },
    });
  }

  // Create subscription with incomplete payment
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: priceId }],
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    metadata: { app: 'recall-better', plan, source: 'quiz-embedded' },
    expand: ['latest_invoice.payment_intent'],
  });

  const paymentIntent = subscription.latest_invoice.payment_intent;

  return res.status(200).json({
    subscriptionId: subscription.id,
    clientSecret: paymentIntent.client_secret,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  });
}

// POST /api/stripe?action=checkout (authenticated - for app)
async function createCheckoutSession(req, res) {
  const decoded = authUser(req);
  if (!decoded) return res.status(401).json({ error: 'Authentication required' });

  const { price_id, plan, success_url, cancel_url } = req.body || {};
  if (!price_id) return res.status(400).json({ error: 'price_id is required' });

  const rows = await sql`SELECT id, email, stripe_customer_id FROM users WHERE id = ${decoded.userId}`;
  if (!rows || rows.length === 0) return res.status(404).json({ error: 'User not found' });
  const user = rows[0];

  const stripe = getStripe();

  // Re-use existing Stripe customer if available
  const sessionParams = {
    mode: 'subscription',
    line_items: [{ price: price_id, quantity: 1 }],
    metadata: { user_id: String(user.id), app: 'recall-better', plan: plan || 'unknown' },
    allow_promotion_codes: true,
    subscription_data: {
      metadata: { app: 'recall-better', plan: plan || 'unknown' },
    },
    success_url: (success_url || req.headers.origin) + '&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: cancel_url || req.headers.origin,
  };

  // Attach existing customer or use email for new
  if (user.stripe_customer_id) {
    sessionParams.customer = user.stripe_customer_id;
  } else {
    sessionParams.customer_email = user.email;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

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
      const price = sub.items?.data?.[0]?.price;
      const interval = price?.recurring?.interval;
      const intervalCount = price?.recurring?.interval_count || 1;
      if (interval === 'week' && intervalCount === 1) plan = 'weekly';
      else if (interval === 'week' && intervalCount === 4) plan = 'monthly';
      else if (interval === 'week' && intervalCount === 12) plan = 'quarterly';
      else plan = sub.metadata?.plan || 'unknown';
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
    if (req.method === 'POST' && action === 'public-checkout') return await createPublicCheckout(req, res);
    if (req.method === 'POST' && action === 'embedded-checkout') return await createEmbeddedCheckout(req, res);
    if (req.method === 'POST' && action === 'checkout') return await createCheckoutSession(req, res);
    if (req.method === 'POST' && action === 'portal') return await createPortalSession(req, res);
    if (req.method === 'GET' && action === 'session') return await getSession(req, res);
    if (req.method === 'GET' && action === 'status') return await getSubscriptionStatus(req, res);

    return res.status(400).json({ error: 'Invalid action. Use: public-checkout, checkout, portal, session, or status' });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired, please sign in again' });
    }
    console.error('Stripe API error:', err.type, err.code, err.message, err.param);
    const msg = err.type === 'StripeInvalidRequestError' ? err.message : 'Server error';
    return res.status(500).json({ error: msg });
  }
};
