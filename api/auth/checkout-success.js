const { sql } = require('../../lib/db');
const { signSessionToken, setSessionCookie } = require('../../lib/auth');

const RECALL_BETTER_PRODUCTS = [
  'prod_UFqRDx6Pg8YgKj',
  'prod_UFsvG0WqtI13Yz',
  'prod_UKLAbGRU6zvkpQ',
];

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe not configured');
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

async function sendWelcomeEmail(email) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[checkout-success] RESEND_API_KEY not set, skipping welcome email');
    return;
  }

  const html = `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:32px 20px;">
  <h1 style="color:#2D7A5F;font-size:28px;">Welcome to Recall Better</h1>
  <p style="color:#2C2C2C;font-size:16px;line-height:1.7;">Your personalised memory training programme is ready. Here's how to get started:</p>
  <div style="background:#E8F5EE;border-radius:12px;padding:20px;margin:24px 0;">
    <p style="font-weight:700;color:#2C2C2C;margin-bottom:8px;">Your daily routine (5 minutes):</p>
    <p style="color:#2C2C2C;line-height:1.6;">1. Open Recall Better on your phone, tablet, or computer<br>2. Complete your 3 recommended games<br>3. Track your progress each week</p>
  </div>
  <a href="https://recallbetter.com/app" style="display:inline-block;background:#2D7A5F;color:white;padding:16px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;">Start My First Session</a>
  <p style="color:#8A8A8A;font-size:14px;margin-top:24px;">Tip: Bookmark recallbetter.com/app or add it to your home screen for easy daily access.</p>
  <hr style="border:none;border-top:1px solid #E8E2D9;margin:32px 0;">
  <p style="color:#8A8A8A;font-size:12px;">Need help? Reply to this email or contact help@recallbetter.com</p>
</div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Recall Better <hello@recallbetter.com>',
        to: email,
        subject: 'Your Recall Better training is ready',
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[checkout-success] Welcome email error', res.status, body);
    }
  } catch (e) {
    console.error('[checkout-success] Welcome email failed:', e.message);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { session_id } = req.query || {};
  if (!session_id) {
    return res.redirect(302, '/app?error=missing_session');
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['subscription', 'subscription.items.data.price'],
    });

    const email = (session.customer_email || '').toLowerCase().trim();
    const customerId = session.customer;
    const subscription = session.subscription;
    const subId = typeof subscription === 'string' ? subscription : subscription?.id;
    const subStatus = typeof subscription === 'string' ? 'active' : (subscription?.status || 'active');

    // Determine plan from subscription metadata or price
    let plan = session.metadata?.plan || 'monthly';

    if (!email) {
      console.error('[checkout-success] No email in checkout session');
      return res.redirect(302, '/app?error=no_email');
    }

    // Look up or create user
    let users = await sql`SELECT id, is_pro FROM users WHERE email = ${email}`;
    let userId;

    if (users.length > 0) {
      userId = users[0].id;
      await sql`
        UPDATE users
        SET is_pro = true,
            stripe_customer_id = ${customerId},
            stripe_subscription_id = ${subId},
            subscription_status = ${subStatus}
        WHERE id = ${userId}
      `;
    } else {
      // User created by webhook — but if not, create now
      const crypto = require('crypto');
      const bcrypt = require('bcryptjs');
      const randomPass = crypto.randomBytes(32).toString('hex');
      const hash = await bcrypt.hash(randomPass, 12);
      try {
        const [newUser] = await sql`
          INSERT INTO users (email, password_hash, is_pro, stripe_customer_id, stripe_subscription_id, subscription_status)
          VALUES (${email}, ${hash}, true, ${customerId}, ${subId}, ${subStatus})
          RETURNING id
        `;
        userId = newUser.id;
        await sql`INSERT INTO user_stats (user_id) VALUES (${userId}) ON CONFLICT (user_id) DO NOTHING`;
      } catch (e) {
        if (e.code === '23505') {
          // Race condition — user was created between our check and insert
          users = await sql`SELECT id FROM users WHERE email = ${email}`;
          userId = users[0]?.id;
          if (userId) {
            await sql`
              UPDATE users
              SET is_pro = true, stripe_customer_id = ${customerId},
                  stripe_subscription_id = ${subId}, subscription_status = ${subStatus}
              WHERE id = ${userId}
            `;
          }
        } else {
          throw e;
        }
      }
    }

    // Set session cookie
    const sessionToken = signSessionToken({
      userId,
      email,
      isPro: true,
    });
    setSessionCookie(res, sessionToken);

    // Send welcome email (fire-and-forget)
    sendWelcomeEmail(email).catch(() => {});

    return res.redirect(302, '/app?checkout=success');

  } catch (err) {
    console.error('[checkout-success] Error:', err.message);
    return res.redirect(302, '/app?error=checkout_failed');
  }
};
