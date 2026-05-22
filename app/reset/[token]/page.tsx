import { createHash } from 'node:crypto';
import Link from 'next/link';
import { Clock, CornerMarks, DateStamp, OnAir, SmpteBars } from '@/components/Broadcast';
import { prisma } from '@/lib/db';
import ResetTokenClient from './ResetTokenClient';

export const dynamic = 'force-dynamic';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export default async function ResetTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tokenHash = hashToken(token);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  const valid = !!record && !record.used && record.expires.getTime() > Date.now();

  if (!valid) {
    return (
      <main className="relative flex flex-col min-h-[100dvh] overflow-hidden">
        <CornerMarks fixed />
        <header className="px-6 pt-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <DateStamp />
            <span className="ticker text-[11px] opacity-40">·</span>
            <Clock />
          </div>
          <OnAir live={false} />
        </header>
        <SmpteBars className="h-1.5 mt-2" />
        <section className="px-6 pt-8 pb-8 flex-1">
          <div className="max-w-[420px] mx-auto w-full">
            <p className="ticker text-[11px] tracking-widest opacity-70 mb-2">▶ BROADCAST ◀</p>
            <h1
              className="display-num"
              style={{ fontSize: 'clamp(48px, 11vw, 96px)', lineHeight: 0.9 }}
            >
              LINK
              <br />
              EXPIRED
            </h1>
            <div
              className="mt-6 ink-border px-4 py-4"
              style={{ background: 'var(--vermilion)', color: 'var(--bone)' }}
              role="alert"
            >
              <p className="ticker text-[12px] tracking-widest">
                THIS RESET LINK IS NO LONGER VALID. REQUEST A NEW ONE.
              </p>
            </div>
            <div className="mt-6 flex flex-col gap-3">
              <Link
                href="/reset"
                className="ink-border stamp-lg ticker tracking-widest text-[14px] py-4 text-center"
                style={{ background: 'var(--ink)', color: 'var(--bone)', minHeight: 56 }}
              >
                ▶ REQUEST NEW LINK
              </Link>
              <Link
                href="/signin"
                className="ticker text-[12px] tracking-widest underline self-start"
              >
                BACK TO SIGN IN
              </Link>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return <ResetTokenClient token={token} />;
}
