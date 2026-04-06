// GET /api/auth/checkout-success?session_id=xxx
// Post-payment redirect: retrieves Stripe session, finds/creates user, sets session cookie, redirects to /app
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sql } = require('../../lib/db');
const { signSessionToken, setSessionCookie } = require('../../lib/auth');
const { sendEmail, welcomeEmail } = require('../../lib/email');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const sessionId = req.query.session_id;
  if (!sessionId) {
    return redirect(res, '/login?error=missing-session');
  }

  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session || session.payment_status !== 'paid') {
      return redirect(res, '/login?error=payment-incomplete');
    }

    // Only process Recall Better sessions
    if (session.metadata?.app && session.metadata.app !== 'recall-better') {
      return redirect(res, '/login?error=wrong-app');
    }

    const email = (session.customer_email || '').toLowerCase().trim();
    if (!email) {
      return redirect(res, '/login?error=no-email');
    }

    const customerId = session.customer;
    const subscriptionId = session.subscription;

    // Find or create user
    let rows = await sql`SELECT id, email, is_pro FROM users WHERE email = ${email}`;
    let user;
    let isNewUser = false;

    if (rows && rows.length > 0) {
      user = rows[0];
      // Update subscription info
      await sql`
        UPDATE users
        SET is_pro = true,
            stripe_customer_id = ${customerId},
            stripe_subscription_id = ${subscriptionId},
            subscription_status = 'active'
        WHERE id = ${user.id}
      `;
      user.is_pro = true;
    } else {
      // Create new user with random password hash (they'll use magic link to sign in)
      isNewUser = true;
      const randomPass = crypto.randomBytes(32).toString('hex');
      const hash = await bcrypt.hash(randomPass, 12);
      const insertRows = await sql`
        INSERT INTO users (email, password_hash, is_pro, stripe_customer_id, stripe_subscription_id, subscription_status)
        VALUES (${email}, ${hash}, true, ${customerId}, ${subscriptionId}, 'active')
        RETURNING id, email, is_pro
      `;
      user = insertRows[0];

      // Create empty stats row
      await sql`
        INSERT INTO user_stats (user_id)
        VALUES (${user.id})
        ON CONFLICT (user_id) DO NOTHING
      `;
    }

    // Create session token
    const sessionToken = signSessionToken({
      userId: user.id,
      email: user.email,
      isPro: true,
    });

    setSessionCookie(res, sessionToken);

    // Send welcome email (async, don't block redirect)
    const baseUrl = process.env.APP_URL || 'https://recallbetter.com';
    sendEmail({
      to: email,
      subject: 'Welcome to Recall Better — your training starts now',
      html: welcomeEmail(`${baseUrl}/app`),
    }).catch(err => console.error('Welcome email failed:', err));

    // Redirect to app
    return redirect(res, '/app?welcome=1');

  } catch (err) {
    console.error('Checkout success error:', err);
    return redirect(res, '/login?error=server-error');
  }
};

function redirect(res, path) {
  const baseUrl = process.env.APP_URL || 'https://recallbetter.com';
  res.writeHead(302, { Location: baseUrl + path });
  res.end();
}
