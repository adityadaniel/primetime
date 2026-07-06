import type { EmailProvider } from './config';

export interface SendResetEmailParams {
  to: string;
  url: string;
}

export type SendResetEmailResult =
  | Readonly<{
      ok: true;
      devUrl?: string;
    }>
  | Readonly<{ ok: false; error: string }>;

export type ResetMailer = (params: SendResetEmailParams) => Promise<SendResetEmailResult>;

function formatDevWarning(url: string): string {
  return (
    `[reset] dev/local email log — no email provider configured. ` +
    `Open this URL to reset the password:\n${url}`
  );
}

function resetEmailText(url: string): string {
  return `Open this link to reset your password: ${url}\n\nIf you did not request this, ignore this email.`;
}

function resetEmailHtml(url: string): string {
  return `<p>Open this link to reset your password: <a href="${url}">${url}</a></p><p>If you did not request this, ignore this email.</p>`;
}

async function sendWithResend(params: SendResetEmailParams): Promise<SendResetEmailResult> {
  const apiKey = process.env.RESEND_API_KEY ?? '';
  const from = process.env.EMAIL_FROM ?? '';
  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY is required when EMAIL_PROVIDER=resend.' };
  }
  if (!from) {
    return { ok: false, error: 'EMAIL_FROM is required when EMAIL_PROVIDER=resend.' };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: params.to,
      subject: 'Reset your PRIMETIME password',
      text: resetEmailText(params.url),
      html: resetEmailHtml(params.url),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const suffix = body ? `: ${body}` : '';
    return { ok: false, error: `Resend API returned ${response.status}${suffix}` };
  }

  return { ok: true };
}

export function buildResetMailer(provider: EmailProvider): ResetMailer {
  switch (provider) {
    case 'token-print':
      return async (params) => {
        console.warn(formatDevWarning(params.url));
        return { ok: true, devUrl: params.url };
      };
    case 'resend':
      return sendWithResend;
    default:
      return async (params) => {
        console.warn(formatDevWarning(params.url));
        return { ok: true, devUrl: params.url };
      };
  }
}
