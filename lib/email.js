// Email utility using Resend API
// Requires RESEND_API_KEY env var

const FROM = 'Recall Better <hello@recallbetter.com>';

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY not set — email not sent');
    return { success: false, error: 'Email not configured' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('Resend API error:', res.status, err);
      return { success: false, error: err.message || 'Email send failed' };
    }

    const data = await res.json();
    return { success: true, id: data.id };
  } catch (err) {
    console.error('Email send error:', err);
    return { success: false, error: err.message };
  }
}

function magicLinkEmail(url) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f5f3ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ee;padding:40px 20px;">
<tr><td align="center">
<table width="100%" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <tr><td style="background:#1a1810;padding:32px 32px 24px;text-align:center;">
    <h1 style="margin:0;font-size:28px;font-weight:300;color:#e8c96a;font-family:Georgia,serif;letter-spacing:-0.02em;">Recall <em>Better</em></h1>
  </td></tr>
  <tr><td style="padding:32px;">
    <h2 style="margin:0 0 12px;font-size:22px;font-weight:500;color:#1a1810;">Sign in to your account</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#5a5748;line-height:1.6;">Tap the button below to securely sign in. This link expires in 15 minutes.</p>
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <a href="${url}" style="display:inline-block;padding:16px 40px;background:#c9a84c;color:#1a1810;text-decoration:none;border-radius:100px;font-size:16px;font-weight:600;letter-spacing:0.04em;">SIGN IN</a>
    </td></tr></table>
    <p style="margin:24px 0 0;font-size:13px;color:#8a8578;line-height:1.6;">If the button doesn't work, copy and paste this link:<br>
    <a href="${url}" style="color:#c9a84c;word-break:break-all;">${url}</a></p>
    <p style="margin:16px 0 0;font-size:13px;color:#8a8578;">If you didn't request this, you can safely ignore this email.</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function welcomeEmail(loginUrl) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f5f3ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ee;padding:40px 20px;">
<tr><td align="center">
<table width="100%" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <tr><td style="background:#1a1810;padding:32px 32px 24px;text-align:center;">
    <h1 style="margin:0;font-size:28px;font-weight:300;color:#e8c96a;font-family:Georgia,serif;letter-spacing:-0.02em;">Recall <em>Better</em></h1>
  </td></tr>
  <tr><td style="padding:32px;">
    <h2 style="margin:0 0 12px;font-size:22px;font-weight:500;color:#1a1810;">Welcome to Recall Better! 🧠</h2>
    <p style="margin:0 0 16px;font-size:15px;color:#5a5748;line-height:1.6;">Your subscription is active and your daily memory training programme is ready.</p>
    <p style="margin:0 0 8px;font-size:15px;color:#1a1810;font-weight:500;">Your programme includes:</p>
    <ul style="margin:0 0 24px;padding-left:20px;font-size:15px;color:#5a5748;line-height:2;">
      <li>7 science-aligned memory games</li>
      <li>New training session every day</li>
      <li>Progress tracking &amp; streaks</li>
      <li>All difficulty levels unlocked</li>
    </ul>
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <a href="${loginUrl}" style="display:inline-block;padding:16px 40px;background:#c9a84c;color:#1a1810;text-decoration:none;border-radius:100px;font-size:16px;font-weight:600;letter-spacing:0.04em;">START TRAINING</a>
    </td></tr></table>
    <p style="margin:24px 0 0;font-size:13px;color:#8a8578;line-height:1.6;">We recommend training daily for the best results. Just a few minutes a day keeps your mind sharp.</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

module.exports = { sendEmail, magicLinkEmail, welcomeEmail };
