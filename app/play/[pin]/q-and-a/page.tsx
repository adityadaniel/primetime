// Q&A player surface — FOLLOW-UP SURFACE STUB (MID-333).
// /join and /play/[pin] route Q&A PINs here. The real participant flow
// (submit, vote, personal state) ships with MID-335. This stub only confirms
// the session exists so the redirect has a stable, public landing page.

import { notFound } from 'next/navigation';
import { Clock, CornerMarks, DateStamp, OnAir, SmpteBars } from '@/components/Broadcast';
import { prisma } from '@/lib/db';

export default async function QAndAPlayerStub({ params }: { params: Promise<{ pin: string }> }) {
  const { pin } = await params;
  if (!/^\d{6}$/.test(pin)) notFound();
  const session = await prisma.qASession.findUnique({
    where: { pin },
    select: { title: true, description: true, status: true },
  });
  if (!session) notFound();

  return (
    <main className="relative flex flex-col min-h-[100dvh]">
      <CornerMarks fixed />
      <header className="px-6 pt-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <DateStamp />
          <span className="ticker text-[11px] opacity-40">·</span>
          <Clock />
        </div>
        <OnAir live={session.status === 'OPEN'} />
      </header>
      <SmpteBars className="h-1.5 mt-2" />

      <section className="px-6 pt-8 flex-1">
        <div className="max-w-[640px] mx-auto w-full">
          <p className="chyron mb-2" style={{ color: 'var(--vermilion)' }}>
            AUDIENCE Q&A · PIN {pin}
          </p>
          <h1
            className="font-editorial leading-[0.95]"
            style={{ fontSize: 'clamp(32px, 8vw, 56px)' }}
          >
            {session.title}
          </h1>
          {session.description && (
            <p className="font-editorial italic mt-2 opacity-80">{session.description}</p>
          )}

          <div className="mt-8 ink-border px-4 py-5" style={{ background: 'var(--bone)' }}>
            <p className="ticker text-[11px] tracking-widest opacity-70">
              STAND BY · QUESTION DESK OPENS WITH THE NEXT BROADCAST UPGRADE
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
