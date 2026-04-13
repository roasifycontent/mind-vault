const { sql } = require('../../lib/db');
const { verifyToken, signSessionToken, setSessionCookie } = require('../../lib/auth');

const RECALL_BETTER_PRODUCTS = [
  'prod_UFqRDx6Pg8YgKj',  // Original
  'prod_UFsvG0WqtI13Yz',  // Prices2
  'prod_UKLAbGRU6zvkpQ',  // Free Trial
];

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe not configured');
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.query || {};
  if (!token) {
    return res.redirect(302, '/login?error=missing_token');
  }

  try {
    const decoded = verifyToken(token);
    if (decoded.purpose !== 'magic-link') {
      return res.redirect(302, '/login?error=invalid_token');
    }

    const email = decoded.email;

    // Look up user in DB
    const users = await sql`
      SELECT id, email, is_pro, stripe_customer_id, subscription_status
      FROM users WHERE email = ${email}
    `;

    let status = 'none';
    let plan = null;
    let userId = null;

    if (users.length > 0) {
      const user = users[0];
      userId = user.id;
      status = user.subscription_status || 'none';

      // Live-check Stripe subscription if customer exists
      if (user.stripe_customer_id) {
        try {
          const stripe = getStripe();
          const subs = await stripe.subscriptions.list({
            customer: user.stripe_customer_id,
            status: 'all',
            limit: 10,
          });

          // Find active/trialing sub for Recall Better products
          const activeSub = subs.data.find(sub => {
            const isActive = ['active', 'trialing'].includes(sub.status);
            const product = sub.items?.data?.[0]?.price?.product;
            return isActive && RECALL_BETTER_PRODUCTS.includes(product);
          });

          if (activeSub) {
            status = activeSub.status;
            plan = activeSub.metadata?.plan || 'monthly';
          }
        } catch (e) {
          console.error('[verify] Stripe lookup error:', e.message);
          // Fall back to DB status
        }
      }
    }

    // Create session token
    const sessionToken = signSessionToken({
      userId,
      email,
      isPro: status === 'active' || status === 'trialing',
    });

    setSessionCookie(res, sessionToken);
    return res.redirect(302, '/app');

  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.redirect(302, '/login?error=expired');
    }
    console.error('[verify] Error:', err.message);
    return res.redirect(302, '/login?error=invalid_token');
  }
};
