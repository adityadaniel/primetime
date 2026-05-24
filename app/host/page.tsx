'use client';

import Link from 'next/link';
import AccountMenu from '@/components/AccountMenu';
import { Chyron, Clock, CornerMarks, FrameCounter, OnAir, SmpteBars } from '@/components/Broadcast';

export default function HostMenu() {
  return (
    <main className="relative min-h-screen pb-24">
      <CornerMarks />
      <header className="px-8 pt-6 flex items-center justify-between">
        <Chyron label="DIRECTOR · ACTIVITIES" number="00" />
        <div className="flex items-center gap-6">
          <FrameCounter index={0} />
          <Clock />
          <OnAir live={false} />
          <AccountMenu />
        </div>
      </header>
      <SmpteBars className="h-2 mt-4" />

      <section className="px-8 pt-8 max-w-[1400px] mx-auto">
        <p className="chyron mb-3" style={{ color: 'var(--vermilion)' }}>
          QUICK ACTIVITIES · STANDALONE
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href="/host/wordcloud/new"
            className="ink-border stamp p-5 flex flex-col gap-3 transition-transform hover:-translate-y-[2px] focus:-translate-y-[2px] outline-none focus:shadow-[6px_6px_0_0_var(--vermilion)]"
            style={{ background: 'var(--bone)', color: 'var(--ink)' }}
          >
            <div className="flex items-center justify-between">
              <span
                className="ticker tracking-widest text-[10px] px-2 py-[2px] ink-border"
                style={{ background: 'var(--ink)', color: 'var(--bone)' }}
              >
                WORD CLOUD · LIVE PROMPT
              </span>
              <span className="ticker tracking-widest text-[10px] opacity-60">NEW</span>
            </div>
            <h3
              className="font-editorial leading-[0.95]"
              style={{ fontSize: 'clamp(28px, 3.2vw, 40px)' }}
            >
              Run a Word Cloud.
            </h3>
            <p className="font-editorial italic text-[15px] leading-snug opacity-80">
              Take the room's temperature. Players type a word, the display piles them up by
              frequency.
            </p>
            <span
              className="mt-auto ticker tracking-widest text-[11px] inline-flex items-center gap-2"
              style={{ color: 'var(--vermilion)' }}
            >
              ▸ START ACTIVITY
            </span>
          </Link>

          <Link
            href="/host/quiz/new"
            className="ink-border stamp p-5 flex flex-col gap-3 transition-transform hover:-translate-y-[2px] focus:-translate-y-[2px] outline-none focus:shadow-[6px_6px_0_0_var(--vermilion)]"
            style={{ background: 'var(--bone)', color: 'var(--ink)' }}
          >
            <div className="flex items-center justify-between">
              <span
                className="ticker tracking-widest text-[10px] px-2 py-[2px] ink-border"
                style={{ background: 'var(--ink)', color: 'var(--bone)' }}
              >
                QUIZ · CUE SHEET
              </span>
              <span className="ticker tracking-widest text-[10px] opacity-60">NEW</span>
            </div>
            <h3
              className="font-editorial leading-[0.95]"
              style={{ fontSize: 'clamp(28px, 3.2vw, 40px)' }}
            >
              Build a Quiz.
            </h3>
            <p className="font-editorial italic text-[15px] leading-snug opacity-80">
              Pick a topic, write the cues, run the room. Multiple choice and true/false,
              server-scored, projector-ready.
            </p>
            <span
              className="mt-auto ticker tracking-widest text-[11px] inline-flex items-center gap-2"
              style={{ color: 'var(--vermilion)' }}
            >
              ▸ START ACTIVITY
            </span>
          </Link>
        </div>
      </section>
    </main>
  );
}
