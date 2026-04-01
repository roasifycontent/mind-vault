// Public checkout endpoint for quiz pages (no auth required)
// POST /api/create-checkout
// Body: { plan: "weekly"|"monthly"|"quarterly", email: "user@email.com" }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const PRICE_MAP = {
  weekly:    'price_1THKkdAWM5kTbKjpctRLzxoh',
  monthly:   'price_1THKkjAWM5kTbKjpPcdnX7KJ',
  quarterly: 'price_1THKkpAWM5kTbKjpzn2VKP8C',
};

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { plan, email } = req.body || {};

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const priceId = PRICE_MAP[plan];
    if (!priceId) {
      return res.status(400).json({ error: 'Invalid plan. Use: weekly, monthly, or quarterly' });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Stripe not configured' });
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email.toLowerCase().trim(),
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { app: 'recall-better', plan, source: 'quiz' },
      allow_promotion_codes: true,
      subscription_data: {
        trial_period_days: 7,
        metadata: { app: 'recall-better', plan },
      },
      payment_settings: {
        statement_descriptor_suffix: 'RECALLBETTER',
      },
      success_url: 'https://recallbetter.com/app?checkout=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://recallbetter.com/quiz',
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Create checkout error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
