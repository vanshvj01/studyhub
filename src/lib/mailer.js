// Email delivery. Resend is used when RESEND_API_KEY is set; otherwise the
// message is written to the log, which keeps local development working with no
// account, no SMTP server and no extra dependency (Node 18+ has global fetch).
const { logger } = require('./logger');

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** 'resend' once a key is configured, 'log' otherwise. */
const transport = () => (process.env.RESEND_API_KEY ? 'resend' : 'log');

/**
 * Accounts skip verification entirely when AUTO_VERIFY=true. Useful for a demo
 * deployment with no mail provider — anyone can sign up and use the app
 * immediately. It is deliberately explicit, not a silent default.
 */
const autoVerifyEnabled = () => String(process.env.AUTO_VERIFY || '').toLowerCase() === 'true';

const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Builds the verification message. Pure, so the wording can be unit-tested. */
function verificationEmail({ name, url }) {
  const safeName = escapeHtml((name || '').split(' ')[0] || 'there');
  const safeUrl = escapeHtml(url);
  return {
    subject: 'Verify your StudyHub account',
    text: [
      `Hi ${(name || '').split(' ')[0] || 'there'},`,
      '',
      'Confirm your email address to finish setting up your StudyHub account:',
      url,
      '',
      'The link is single-use. If you did not sign up, you can ignore this message.',
    ].join('\n'),
    html: `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#101828">
  <table role="presentation" style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e4e7ec;border-radius:10px">
    <tr><td style="padding:28px">
      <div style="display:inline-block;width:28px;height:28px;border-radius:6px;background:#3538cd;color:#fff;
                  text-align:center;line-height:28px;font-weight:700;font-size:13px">SH</div>
      <span style="font-weight:600;margin-left:8px">StudyHub</span>

      <h1 style="font-size:20px;font-weight:600;margin:22px 0 8px">Verify your email address</h1>
      <p style="color:#475467;font-size:14px;line-height:1.55;margin:0 0 20px">
        Hi ${safeName}, confirm this address to finish setting up your account.
      </p>

      <a href="${safeUrl}" style="display:inline-block;background:#3538cd;color:#fff;text-decoration:none;
         padding:11px 20px;border-radius:8px;font-weight:500;font-size:14px">Verify my email</a>

      <p style="color:#667085;font-size:12.5px;line-height:1.55;margin:22px 0 0">
        Or paste this link into your browser:<br>
        <span style="word-break:break-all;color:#3538cd">${safeUrl}</span>
      </p>
      <p style="color:#667085;font-size:12.5px;margin:16px 0 0">
        The link can only be used once. If you didn't sign up, ignore this email.
      </p>
    </td></tr>
  </table>
</body></html>`,
  };
}

async function send({ to, subject, html, text }) {
  if (transport() === 'log') {
    logger.info('email (not sent — no RESEND_API_KEY)', { to, subject });
    logger.info(text.split('\n').find(line => line.startsWith('http')) || '');
    return { delivered: false, transport: 'log' };
  }

  const from = process.env.MAIL_FROM || 'StudyHub <onboarding@resend.dev>';
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      logger.error('email delivery failed', { to, status: res.status, detail: detail.slice(0, 200) });
      return { delivered: false, transport: 'resend', error: `Resend returned ${res.status}` };
    }
    logger.info('email sent', { to, subject });
    return { delivered: true, transport: 'resend' };
  } catch (err) {
    // A signup must not fail because the mail provider is down.
    logger.error('email delivery threw', { to, error: err.message });
    return { delivered: false, transport: 'resend', error: err.message };
  }
}

function passwordResetEmail({ name, url }) {
  const safeName = escapeHtml((name || '').split(' ')[0] || 'there');
  const safeUrl = escapeHtml(url);
  return {
    subject: 'Reset your StudyHub password',
    text: [
      `Hi ${(name || '').split(' ')[0] || 'there'},`,
      '',
      'Use this link within the next hour to set a new password:',
      url,
      '',
      'If you did not ask for this, ignore the message — your password stays as it is.',
    ].join('\n'),
    html: `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#101828">
  <table role="presentation" style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e4e7ec;border-radius:10px">
    <tr><td style="padding:28px">
      <div style="display:inline-block;width:28px;height:28px;border-radius:6px;background:#3538cd;color:#fff;
                  text-align:center;line-height:28px;font-weight:700;font-size:13px">SH</div>
      <span style="font-weight:600;margin-left:8px">StudyHub</span>
      <h1 style="font-size:20px;font-weight:600;margin:22px 0 8px">Reset your password</h1>
      <p style="color:#475467;font-size:14px;line-height:1.55;margin:0 0 20px">
        Hi ${safeName}, choose a new password using the button below. The link works once and expires in an hour.
      </p>
      <a href="${safeUrl}" style="display:inline-block;background:#3538cd;color:#fff;text-decoration:none;
         padding:11px 20px;border-radius:8px;font-weight:500;font-size:14px">Choose a new password</a>
      <p style="color:#667085;font-size:12.5px;line-height:1.55;margin:22px 0 0">
        Or paste this link into your browser:<br>
        <span style="word-break:break-all;color:#3538cd">${safeUrl}</span>
      </p>
      <p style="color:#667085;font-size:12.5px;margin:16px 0 0">
        Didn't ask for this? Ignore this email — nothing has changed.
      </p>
    </td></tr>
  </table>
</body></html>`,
  };
}

async function sendPasswordReset({ to, name, url }) {
  return send({ to, ...passwordResetEmail({ name, url }) });
}

async function sendVerification({ to, name, url }) {
  return send({ to, ...verificationEmail({ name, url }) });
}

module.exports = {
  send, sendVerification, sendPasswordReset,
  verificationEmail, passwordResetEmail, transport, autoVerifyEnabled,
};
