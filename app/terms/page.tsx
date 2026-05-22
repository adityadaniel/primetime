import type { Metadata } from 'next';
import Link from 'next/link';
import { Chyron, Clock, CornerMarks, DateStamp, OnAir, SmpteBars } from '@/components/Broadcast';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'Terms of service for BROADCAST.',
};

export default function TermsPage() {
  return (
    <main className="relative flex flex-col min-h-[100dvh] overflow-hidden grain">
      <CornerMarks fixed />
      <header className="px-6 pt-4 flex items-center justify-between">
        <Chyron label="BROADCAST / DOC.TERMS" number="T" />
        <div className="flex items-center gap-3">
          <DateStamp />
          <span className="ticker text-[11px] opacity-40">·</span>
          <Clock />
          <OnAir live={false} />
        </div>
      </header>
      <SmpteBars className="h-1.5 mt-2" />

      <section className="px-6 pt-10 pb-12 flex-1">
        <div className="max-w-[720px] mx-auto w-full">
          <p className="ticker text-[11px] tracking-widest opacity-70 mb-3">▶ TERMS ◀</p>
          <h1
            className="display-num"
            style={{ fontSize: 'clamp(56px, 12vw, 132px)', lineHeight: 0.88 }}
          >
            TERMS OF
            <br />
            <span style={{ color: 'var(--vermilion)' }}>SERVICE.</span>
          </h1>

          <div className="mt-10 ink-border p-6 md:p-8" style={{ background: 'var(--bone)' }}>
            <p className="font-editorial text-xl md:text-2xl leading-[1.4]">
              Terms of service coming soon. While we&apos;re in beta, BROADCAST is provided as-is
              for classroom and small-room use. Don&apos;t use it to run anything you wouldn&apos;t
              want a server outage to interrupt. Contact{' '}
              <a className="underline" href="mailto:support@broadcast.example">
                support@broadcast.example
              </a>{' '}
              with questions.
            </p>
          </div>

          <p className="mt-8 ticker text-[12px] tracking-widest">
            <Link href="/" className="underline">
              ← BACK TO BROADCAST
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
