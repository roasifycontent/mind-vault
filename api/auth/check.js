const { sql } = require('../../lib/db');
const { verifyToken, signSessionToken, setSessionCookie, tokenFromRequest } = require('../../lib/auth');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const RECALL_BETTER_PRODUCTS = [
  'prod_UFqRDx6Pg8YgKj',
  'prod_UFsvG0WqtI13Yz',
  'prod_UKLAbGRU6zvkpQ',
];

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe not configured');
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = tokenFromRequest(req);
  if (!token) {
    return res.status(200).json({ active: false, reason: 'no_session' });
  }

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      // Token expired — try to refresh if we can identify the user
      try {
        const jwt = require('jsonwebtoken');
        const payload = jwt.decode(token);
        if (payload?.email) {
          decoded = { email: payload.email, userId: payload.userId };
        } else {
          return res.status(200).json({ active: false, reason: 'expired' });
        }
      } catch {
        return res.status(200).json({ active: false, reason: 'expired' });
      }
    } else {
      return res.status(200).json({ active: false, reason: 'invalid_token' });
    }
  }

  const email = decoded.email;
  if (!email) {
    return res.status(200).json({ active: false, reason: 'no_email_in_token' });
  }

  try {
    // Look up user
    const users = await sql`
      SELECT id, email, is_pro, stripe_customer_id, subscription_status
      FROM users WHERE email = ${email}
    `;

    if (users.length === 0) {
      return res.status(200).json({ active: false, email, reason: 'no_user' });
    }

    const user = users[0];
    let status = user.subscription_status || 'none';
    let plan = null;

    // Live-check Stripe if customer exists
    if (user.stripe_customer_id) {
      try {
        const stripe = getStripe();
        const subs = await stripe.subscriptions.list({
          customer: user.stripe_customer_id,
          status: 'all',
          limit: 10,
        });

        const activeSub = subs.data.find(sub => {
          const isActive = ['active', 'trialing'].includes(sub.status);
          const product = sub.items?.data?.[0]?.price?.product;
          return isActive && RECALL_BETTER_PRODUCTS.includes(product);
        });

        if (activeSub) {
          status = activeSub.status;
          plan = activeSub.metadata?.plan || 'monthly';
        } else {
          // No active Recall Better subscription
          status = 'inactive';
        }
      } catch (e) {
        console.error('[auth/check] Stripe error:', e.message);
        // Fall back to DB status
      }
    }

    const active = status === 'active' || status === 'trialing';

    // Auto-refresh token if subscription is still active
    if (active) {
      const newToken = signSessionToken({
        userId: user.id,
        email: user.email,
        isPro: true,
      });
      setSessionCookie(res, newToken);
    }

    return res.status(200).json({
      active,
      email: user.email,
      plan,
      status,
    });

  } catch (err) {
    console.error('[auth/check] Error:', err.message);
    return res.status(500).json({ active: false, reason: 'server_error' });
  }
};
