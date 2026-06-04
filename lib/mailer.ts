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
    `[reset] dev/local email log — no SMTP transport configured. ` +
    `Open this URL to reset the password:\n${url}`
  );
}

async function sendWithSmtp(params: SendResetEmailParams): Promise<SendResetEmailResult> {
  const host = process.env.SMTP_HOST ?? '';
  const portRaw = process.env.SMTP_PORT ?? '';
  const user = process.env.SMTP_USER ?? '';
  const pass = process.env.SMTP_PASSWORD ?? '';
  const from = process.env.SMTP_FROM ?? user;
  const port = Number(portRaw);
  if (!Number.isFinite(port)) {
    return { ok: false, error: `Invalid SMTP_PORT: ${portRaw}` };
  }

  // Dynamic import: nodemailer is optional. Only resolve at runtime when
  // EMAIL_PROVIDER=smtp is configured and env validation already passed.
  // If the package is not installed, return a clear actionable error.
  try {
    const nodemailer = await import('nodemailer');

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    await transporter.sendMail({
      from,
      to: params.to,
      subject: 'Reset your PRIMETIME password',
      text: `Open this link to reset your password: ${params.url}\n\nIf you did not request this, ignore this email.`,
      html: `<p>Open this link to reset your password: <a href="${params.url}">${params.url}</a></p><p>If you did not request this, ignore this email.</p>`,
    });
    return { ok: true };
  } catch (err: unknown) {
    if (err instanceof Error && err.message?.includes('Cannot find module')) {
      return {
        ok: false,
        error: 'nodemailer is not installed. Run `npm install nodemailer` to enable SMTP email.',
      };
    }
    throw err;
  }
}

export function buildResetMailer(provider: EmailProvider): ResetMailer {
  switch (provider) {
    case 'token-print':
      return async (params) => {
        console.warn(formatDevWarning(params.url));
        return { ok: true, devUrl: params.url };
      };
    case 'smtp':
      return sendWithSmtp;
    default:
      return async (params) => {
        console.warn(formatDevWarning(params.url));
        return { ok: true, devUrl: params.url };
      };
  }
}
