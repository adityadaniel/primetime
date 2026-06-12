import type { Metadata } from 'next';
import Link from 'next/link';
import { Chyron, Clock, DateStamp, SmpteBars } from '@/components/Broadcast';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'Privacy policy for PRIMETIME.',
  robots: { index: false, follow: false },
};

export default function PrivacyPage() {
  return (
    <main className="relative flex flex-col min-h-[100dvh] overflow-hidden grain">
      <header className="px-6 pt-4 flex items-center justify-between">
        <Chyron label="PRIMETIME / DOC.PRIVACY" number="P" />
        <div className="flex items-center gap-3">
          <DateStamp />
          <span className="ticker text-[11px] opacity-40">·</span>
          <Clock />
        </div>
      </header>
      <SmpteBars className="h-1.5 mt-2" />

      <section className="px-6 pt-10 pb-12 flex-1">
        <div className="max-w-[720px] mx-auto w-full">
          <p className="ticker text-[11px] tracking-widest opacity-70 mb-3">▶ PRIVACY ◀</p>
          <h1
            className="display-num"
            style={{ fontSize: 'clamp(56px, 12vw, 132px)', lineHeight: 0.88 }}
          >
            PRIVACY
            <br />
            <span style={{ color: 'var(--vermilion)' }}>POLICY.</span>
          </h1>

          <div className="mt-10 ink-border p-6 md:p-8" style={{ background: 'var(--bone)' }}>
            <p className="font-editorial text-xl md:text-2xl leading-[1.4]">
              Privacy policy coming soon. We collect the minimum needed to run a live quiz: your
              email and display name when you sign up, the nicknames and answers your players submit
              during a session, and the usual server logs. Contact{' '}
              <a className="underline" href="mailto:support@theprimetime.id">
                support@theprimetime.id
              </a>{' '}
              with questions.
            </p>
          </div>

          <p className="mt-8 ticker text-[12px] tracking-widest">
            <Link
              href="/"
              className="underline inline-flex items-center min-h-11 px-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{ outlineColor: 'var(--ink)' }}
            >
              ← BACK TO PRIMETIME
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
