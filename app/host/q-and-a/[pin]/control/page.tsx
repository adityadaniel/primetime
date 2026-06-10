// Q&A host control room — FOLLOW-UP SURFACE STUB (MID-333).
// The session-creation flow lands here after POST /api/q-and-a. The full
// control surface (live board, moderation queue, sort/filter/search) ships
// with MID-337/MID-338. This stub only confirms the session and shows the PIN.

import { notFound } from 'next/navigation';
import { Chyron, Clock, CornerMarks, OnAir, SmpteBars } from '@/components/Broadcast';
import { prisma } from '@/lib/db';

export default async function QAndAControlStub({ params }: { params: Promise<{ pin: string }> }) {
  const { pin } = await params;
  if (!/^\d{6}$/.test(pin)) notFound();
  const session = await prisma.qASession.findUnique({
    where: { pin },
    select: { title: true, description: true, status: true },
  });
  if (!session) notFound();

  return (
    <main className="relative min-h-screen pb-24">
      <CornerMarks />
      <header className="px-8 pt-6 flex items-center justify-between">
        <Chyron label="CONTROL ROOM · AUDIENCE Q&A" number="QA" />
        <div className="flex items-center gap-6">
          <Clock />
          <OnAir live={session.status === 'OPEN'} />
        </div>
      </header>
      <SmpteBars className="h-2 mt-4" />

      <section className="px-6 sm:px-8 pt-12 max-w-[920px] mx-auto">
        <p className="chyron mb-3" style={{ color: 'var(--vermilion)' }}>
          SESSION · {session.status}
        </p>
        <h1
          className="font-editorial leading-[0.95]"
          style={{ fontSize: 'clamp(32px, 5vw, 64px)' }}
        >
          {session.title}
        </h1>
        {session.description && (
          <p className="font-editorial italic mt-3 opacity-80 text-lg">{session.description}</p>
        )}

        <div className="mt-10 ink-border p-6 sm:p-8" style={{ background: 'var(--bone)' }}>
          <p className="chyron">GAME PIN</p>
          <p
            className="display-num ticker tabular-nums mt-2"
            style={{ fontSize: 'clamp(56px, 12vw, 120px)', letterSpacing: '0.12em' }}
          >
            {pin}
          </p>
          <p className="ticker text-[11px] tracking-widest mt-6 opacity-70">
            CONTROL SURFACE UNDER CONSTRUCTION · QUESTION BOARD AND MODERATION ARRIVE WITH THE NEXT
            BROADCAST UPGRADE
          </p>
        </div>
      </section>
    </main>
  );
}
