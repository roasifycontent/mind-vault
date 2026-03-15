const { sql } = require('../../lib/db');
const { verifyToken, tokenFromRequest } = require('../../lib/auth');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = tokenFromRequest(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const { userId } = verifyToken(token);

    const { stripe_session_id } = req.body || {};
    if (!stripe_session_id) {
      return res.status(400).json({ error: 'stripe_session_id is required' });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Stripe not configured' });
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(stripe_session_id);

    if (session.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    const customerId = session.customer || null;
    const subscriptionId = session.subscription || null;

    await sql`
      UPDATE users
      SET is_pro = true,
          stripe_customer_id = COALESCE(${customerId}, stripe_customer_id),
          stripe_subscription_id = COALESCE(${subscriptionId}, stripe_subscription_id),
          subscription_status = 'active'
      WHERE id = ${userId}
    `;

    return res.status(200).json({ ok: true, is_pro: true });

  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired, please sign in again' });
    }
    console.error('Subscription activate error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
