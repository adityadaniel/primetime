import { config } from '@/lib/config';
import type { SendResetEmailParams, SendResetEmailResult } from '@/lib/mailer';
import { buildResetMailer } from '@/lib/mailer';

export async function sendResetEmail(params: SendResetEmailParams): Promise<SendResetEmailResult> {
  const mailer = buildResetMailer(config.emailProvider);
  return mailer(params);
}
