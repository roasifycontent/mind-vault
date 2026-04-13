const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sql } = require('../../lib/db');

// Disable Vercel's automatic body parsing so we get the raw body for Stripe signature verification
const { buffer } = require('micro');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeSecretKey || !webhookSecret) {
    console.error('Stripe env vars not set');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  const stripe = require('stripe')(stripeSecretKey);

  // Get raw body for signature verification
  const rawBody = await buffer(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Stripe signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        // Only process Recall Better events (shared Stripe account)
        // Recognised products: prod_UFqRDx6Pg8YgKj (Original),
        // prod_UFsvG0WqtI13Yz (Prices2), prod_UKLAbGRU6zvkpQ (Free Trial)
        if (session.metadata?.app && session.metadata.app !== 'recall-better') {
          console.log('Skipping non-recall-better checkout:', session.metadata.app);
          break;
        }
        const email = session.customer_email;
        const userId = session.metadata?.user_id;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        // Tag the Stripe customer with app metadata
        if (customerId) {
          try {
            const stripe = require('stripe')(stripeSecretKey);
            await stripe.customers.update(customerId, { metadata: { app: 'recall-better' } });
          } catch (_) { /* non-critical */ }
        }

        if (userId) {
          await sql`
            UPDATE users
            SET is_pro = true,
                stripe_customer_id = ${customerId},
                stripe_subscription_id = ${subscriptionId},
                subscription_status = 'active'
            WHERE id = ${parseInt(userId)}
          `;
        } else if (email) {
          const cleanEmail = email.toLowerCase();
          // Try to update existing user first
          const updated = await sql`
            UPDATE users
            SET is_pro = true,
                stripe_customer_id = ${customerId},
                stripe_subscription_id = ${subscriptionId},
                subscription_status = 'active'
            WHERE email = ${cleanEmail}
            RETURNING id
          `;
          // If no user exists, create one (quiz funnel — user has no account yet)
          if (!updated || updated.length === 0) {
            try {
              const randomPass = crypto.randomBytes(32).toString('hex');
              const hash = await bcrypt.hash(randomPass, 12);
              const [newUser] = await sql`
                INSERT INTO users (email, password_hash, is_pro, stripe_customer_id, stripe_subscription_id, subscription_status)
                VALUES (${cleanEmail}, ${hash}, true, ${customerId}, ${subscriptionId}, 'active')
                RETURNING id
              `;
              // Create stats row
              await sql`
                INSERT INTO user_stats (user_id) VALUES (${newUser.id})
                ON CONFLICT (user_id) DO NOTHING
              `;
            } catch (insertErr) {
              // Unique constraint — user was created between our check and insert
              if (insertErr.code === '23505') {
                await sql`
                  UPDATE users
                  SET is_pro = true, stripe_customer_id = ${customerId},
                      stripe_subscription_id = ${subscriptionId}, subscription_status = 'active'
                  WHERE email = ${cleanEmail}
                `;
              } else {
                throw insertErr;
              }
            }
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const custId = sub.customer;
        const periodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;

        await sql`
          UPDATE users
          SET subscription_status = ${sub.status},
              current_period_end = ${periodEnd}
          WHERE stripe_customer_id = ${custId}
        `;
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        await sql`
          UPDATE users
          SET is_pro = false,
              subscription_status = 'cancelled'
          WHERE stripe_customer_id = ${customerId}
        `;
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        console.warn('Payment failed for customer:', invoice.customer);
        if (invoice.customer) {
          await sql`
            UPDATE users
            SET subscription_status = 'past_due'
            WHERE stripe_customer_id = ${invoice.customer}
          `;
        }
        break;
      }

      default:
        // Unhandled event type — acknowledge receipt
        break;
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};

// Tell Vercel not to parse the body
module.exports.config = {
  api: { bodyParser: false }
};
