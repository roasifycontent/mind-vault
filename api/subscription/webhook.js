const crypto = require('crypto');
const { sql } = require('../../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('LEMONSQUEEZY_WEBHOOK_SECRET not set');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  // Verify signature
  const signature = req.headers['x-signature'] || '';
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(hmac))) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const eventName = payload.meta?.event_name;

    if (eventName === 'order_created') {
      const email = payload.data?.attributes?.user_email;
      if (email) {
        await sql`
          UPDATE users SET is_pro = true WHERE email = ${email.toLowerCase()}
        `;
      }
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};
