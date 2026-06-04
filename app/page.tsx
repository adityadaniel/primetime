import Link from 'next/link';
import { Chyron, Clock, CornerMarks, FrameCounter, OnAir, SmpteBars } from '@/components/Broadcast';
import { Shape } from '@/components/Shape';

const DIFFERENTIATORS: Array<{ index: string; title: string; body: string }> = [
  {
    index: '01',
    title: 'PRIMETIME identity',
    body: 'A coherent editorial-brutalist look across builder, control room, projector display, and player phones. No purple gradient. No Kahoot cosplay.',
  },
  {
    index: '02',
    title: 'Per-answer CSV export — on free',
    body: 'Walk away with the data, not just the leaderboard. Every player, every question, every reaction time. Free tier, no asterisks.',
  },
  {
    index: '03',
    title: 'Real-time, low-latency',
    body: 'WebSocket-first architecture, server-authoritative scoring, paused recovery if the host blinks. Built for a room, not a tab.',
  },
  {
    index: '04',
    title: 'No purple gradient',
    body: 'A direction we picked, then committed to. Bone, ink, vermilion, cobalt, marigold, ivy — drawn from a print shop, not a slide deck.',
  },
];

const SURFACES: Array<{
  kind: 'triangle' | 'diamond' | 'circle' | 'square';
  color: string;
  title: string;
  body: string;
}> = [
  {
    kind: 'triangle',
    color: 'var(--vermilion)',
    title: 'Live quiz',
    body: 'Build in five minutes. Launch a 6-digit PIN. Run the room from a private control panel.',
  },
  {
    kind: 'diamond',
    color: 'var(--cobalt)',
    title: 'Projector display',
    body: 'A second screen for the back of the room. Huge type, four shapes, a countdown that means business.',
  },
  {
    kind: 'circle',
    color: 'var(--marigold)',
    title: 'Player phones',
    body: 'Players join with a PIN and a nickname. Tap a shape. One-handed-friendly tap targets, thumb-reachable.',
  },
];

export default function HomePage() {
  const demoPin = process.env.NEXT_PUBLIC_DEMO_PIN?.trim();

  return (
    <main className="relative min-h-screen overflow-hidden grain">
      <CornerMarks />

      <header className="relative z-10 px-8 pt-6 flex items-center justify-between">
        <Chyron label="PRIMETIME / NETWORK MASTER" number="00" />
        <div className="flex items-center gap-6">
          <FrameCounter index={0} />
          <Clock />
          <OnAir live={false} />
        </div>
      </header>

      <SmpteBars className="h-2 mt-4" />

      {/* HERO */}
      <section className="relative px-8 pt-14 pb-12">
        <div className="max-w-[1240px] mx-auto">
          <p className="chyron mb-6" style={{ color: 'var(--vermilion)' }}>
            ⏵ A LIVE QUIZ NETWORK · EST. 2026 · STUDIO 4
          </p>

          <h1 className="display-num" style={{ fontSize: 'clamp(96px, 18vw, 280px)' }}>
            <span className="block" style={{ color: 'var(--vermilion)' }}>
              PRIME
            </span>
            <span className="block" style={{ marginTop: '-0.18em', color: 'var(--ink)' }}>
              TIME
            </span>
          </h1>

          <div
            className="grid grid-cols-12 gap-6 mt-12 border-t-2 pt-6"
            style={{ borderColor: 'var(--ink)' }}
          >
            <div className="col-span-12 md:col-span-7">
              <p className="font-editorial text-2xl md:text-3xl leading-[1.18] max-w-[640px]">
                <em>Live quizzes that don't look like Kahoot.</em> A real-time broadcast for
                classrooms, conference rooms, and the back of any room with a projector. You are the
                producer, the room is the audience, the answers are tabulated <em>live</em>.
              </p>
            </div>

            <div className="col-span-12 md:col-span-5 md:pl-10 flex flex-col gap-3 self-end">
              <Link
                href="/signin"
                className="ink-border stamp-lg ticker tracking-widest text-[14px] py-4 px-6 text-center"
                style={{ background: 'var(--ink)', color: 'var(--bone)', minHeight: 56 }}
              >
                ▶ SIGN IN
              </Link>
              <Link
                href="/signup"
                className="ink-border ticker tracking-widest text-[14px] py-4 px-6 text-center"
                style={{ background: 'var(--bone)', color: 'var(--ink)', minHeight: 56 }}
              >
                CREATE ACCOUNT →
              </Link>
              {demoPin ? (
                <Link
                  href={`/play/${encodeURIComponent(demoPin)}`}
                  className="ink-border ticker tracking-widest text-[12px] py-3 px-5 text-center"
                  style={{ background: 'var(--marigold)', color: 'var(--ink)', minHeight: 44 }}
                >
                  ◇ TRY A DEMO · PIN {demoPin}
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* WHAT IT IS */}
      <section className="relative px-8 pb-16">
        <div className="max-w-[1240px] mx-auto">
          <div
            className="flex items-baseline justify-between border-t-2 pt-4 mb-8"
            style={{ borderColor: 'var(--ink)' }}
          >
            <Chyron label="01 / WHAT IT IS" />
            <span className="ticker text-[11px] tracking-widest opacity-60">
              THREE SURFACES · ONE SIGNAL
            </span>
          </div>

          <div className="grid grid-cols-12 gap-6">
            {SURFACES.map((s, i) => (
              <article
                key={s.kind}
                className="col-span-12 md:col-span-4 ink-border p-6 md:p-8 flex flex-col gap-4"
                style={{ background: 'var(--bone)' }}
              >
                <div className="flex items-center justify-between">
                  <Shape kind={s.kind} fill={s.color} size={56} />
                  <span className="ticker text-[11px] tracking-widest opacity-60">
                    CH.{String(i + 1).padStart(2, '0')}
                  </span>
                </div>
                <h2 className="display-num" style={{ fontSize: 'clamp(36px, 5vw, 56px)' }}>
                  {s.title.toUpperCase()}
                </h2>
                <p className="font-editorial text-lg leading-[1.35]">{s.body}</p>
              </article>
            ))}
          </div>

          <div
            className="mt-8 ink-border p-5 flex flex-wrap items-center gap-6 justify-between"
            style={{ background: 'var(--bone)' }}
          >
            <div className="flex items-center gap-5 flex-wrap">
              <span className="ticker text-[11px] tracking-widest opacity-70">CHANNELS</span>
              {[
                { kind: 'triangle' as const, color: 'var(--vermilion)' },
                { kind: 'diamond' as const, color: 'var(--cobalt)' },
                { kind: 'circle' as const, color: 'var(--marigold)' },
                { kind: 'square' as const, color: 'var(--ivy)' },
              ].map((c, i) => (
                <div key={c.kind} className="flex items-center gap-2">
                  <Shape kind={c.kind} fill={c.color} size={24} />
                  <span className="ticker text-[11px] tracking-widest">
                    CH.{String(i + 1).padStart(2, '0')}
                  </span>
                </div>
              ))}
            </div>
            <p className="font-editorial italic max-w-md text-base">
              Distinguishable by shape, not just color — readable from the back of any room.
            </p>
          </div>
        </div>
      </section>

      {/* WHY US */}
      <section className="relative px-8 pb-16">
        <div className="max-w-[1240px] mx-auto">
          <div
            className="flex items-baseline justify-between border-t-2 pt-4 mb-8"
            style={{ borderColor: 'var(--ink)' }}
          >
            <Chyron label="02 / WHY US" />
            <span className="ticker text-[11px] tracking-widest opacity-60">
              FOUR REASONS · NO FILLER
            </span>
          </div>

          <div className="grid grid-cols-12 gap-6">
            {DIFFERENTIATORS.map((d) => (
              <article
                key={d.index}
                className="col-span-12 md:col-span-6 ink-border p-6 md:p-8 flex flex-col gap-3"
                style={{ background: 'var(--bone)' }}
              >
                <div className="flex items-baseline gap-4">
                  <span
                    className="ticker tracking-widest text-[12px] px-2 py-[2px]"
                    style={{ background: 'var(--vermilion)', color: 'var(--bone)' }}
                  >
                    {d.index}
                  </span>
                  <h3 className="display-num" style={{ fontSize: 'clamp(28px, 3.6vw, 44px)' }}>
                    {d.title.toUpperCase()}
                  </h3>
                </div>
                <p className="font-editorial text-lg leading-[1.35]">{d.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING TEASER */}
      <section className="relative px-8 pb-16">
        <div className="max-w-[1240px] mx-auto">
          <div
            className="flex items-baseline justify-between border-t-2 pt-4 mb-8"
            style={{ borderColor: 'var(--ink)' }}
          >
            <Chyron label="03 / RATE CARD" />
            <span className="ticker text-[11px] tracking-widest opacity-60">
              FREE FIRST · PRO LATER
            </span>
          </div>

          <div className="grid grid-cols-12 gap-6">
            <article
              className="col-span-12 md:col-span-6 ink-border p-6 md:p-8 flex flex-col gap-4"
              style={{ background: 'var(--bone)' }}
            >
              <div className="flex items-center justify-between">
                <Chyron label="TIER · FREE" number="F" />
                <span className="ticker text-[11px] tracking-widest opacity-60">$0</span>
              </div>
              <h3 className="display-num" style={{ fontSize: 'clamp(48px, 7vw, 88px)' }}>
                FREE.
              </h3>
              <ul className="font-editorial text-lg space-y-2">
                <li>· Unlimited live games</li>
                <li>· Up to 50 concurrent players</li>
                <li>· Per-answer CSV export</li>
                <li>· PRIMETIME watermark on the projector</li>
              </ul>
            </article>

            <article
              className="col-span-12 md:col-span-6 ink-border stamp-lg p-6 md:p-8 flex flex-col gap-4"
              style={{ background: 'var(--ink)', color: 'var(--bone)' }}
            >
              <div className="flex items-center justify-between">
                <Chyron label="TIER · PRO" number="P" dark />
                <span className="ticker text-[11px] tracking-widest opacity-70">SOON</span>
              </div>
              <h3
                className="display-num"
                style={{ fontSize: 'clamp(48px, 7vw, 88px)', color: 'var(--vermilion)' }}
              >
                PRO.
              </h3>
              <ul className="font-editorial text-lg space-y-2">
                <li>· Bigger rooms, bigger games</li>
                <li>· Team accounts &amp; quiz library</li>
                <li>· Branded projector themes</li>
                <li>· Priority support</li>
              </ul>
            </article>
          </div>

          <div className="mt-6 flex justify-end">
            <Link
              href="/pricing"
              className="ink-border ticker tracking-widest text-[12px] py-3 px-5"
              style={{ background: 'var(--bone)', minHeight: 44 }}
            >
              FULL RATE CARD →
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="relative px-8 pb-10">
        <div
          className="max-w-[1240px] mx-auto border-t-2 pt-6 flex flex-col md:flex-row md:items-end md:justify-between gap-6"
          style={{ borderColor: 'var(--ink)' }}
        >
          <div className="flex flex-col gap-2">
            <span className="ticker text-[11px] tracking-widest opacity-60">
              © PRIMETIME NETWORK · STUDIO 4 · TRANSMISSION 0001
            </span>
            <span className="font-editorial italic opacity-70">"Roll tape."</span>
          </div>
          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-x-4 gap-y-1 ticker text-[12px] tracking-widest">
              <li>
                <Link
                  href="/signin"
                  className="underline inline-flex items-center min-h-11 px-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  style={{ outlineColor: 'var(--ink)' }}
                >
                  SIGN IN
                </Link>
              </li>
              <li>
                <Link
                  href="/signup"
                  className="underline inline-flex items-center min-h-11 px-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  style={{ outlineColor: 'var(--ink)' }}
                >
                  SIGN UP
                </Link>
              </li>
              <li>
                <Link
                  href="/pricing"
                  className="underline inline-flex items-center min-h-11 px-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  style={{ outlineColor: 'var(--ink)' }}
                >
                  PRICING
                </Link>
              </li>
              <li>
                <Link
                  href="/privacy"
                  className="underline inline-flex items-center min-h-11 px-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  style={{ outlineColor: 'var(--ink)' }}
                >
                  PRIVACY
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  className="underline inline-flex items-center min-h-11 px-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  style={{ outlineColor: 'var(--ink)' }}
                >
                  TERMS
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </footer>
    </main>
  );
}
