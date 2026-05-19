import Link from "next/link";
import { Chyron, CornerMarks, FrameCounter, OnAir, SmpteBars, Clock } from "@/components/Broadcast";
import { Shape } from "@/components/Shape";

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden grain">
      <CornerMarks />

      <header className="relative z-10 px-8 pt-6 flex items-center justify-between">
        <Chyron label="BROADCAST / NETWORK MASTER" number="00" />
        <div className="flex items-center gap-6">
          <FrameCounter index={0} />
          <Clock />
          <OnAir live={false} />
        </div>
      </header>

      <SmpteBars className="h-2 mt-4" />

      <section className="relative px-8 pt-14 pb-10">
        <div className="max-w-[1240px] mx-auto">
          <p
            className="chyron mb-6"
            style={{ color: "var(--vermilion)" }}
          >
            ⏵ A LIVE QUIZ NETWORK · EST. 2026 · STUDIO 4
          </p>

          <h1
            className="display-num"
            style={{ fontSize: "clamp(96px, 18vw, 280px)" }}
          >
            <span className="block">BROAD&shy;</span>
            <span
              className="block"
              style={{ marginTop: "-0.18em", color: "var(--vermilion)" }}
            >
              CAST.
            </span>
          </h1>

          <div
            className="grid grid-cols-12 gap-6 mt-12 border-t-2 pt-6"
            style={{ borderColor: "var(--ink)" }}
          >
            <div className="col-span-12 md:col-span-6">
              <p className="font-editorial text-2xl md:text-3xl leading-[1.18] max-w-[640px]">
                A real-time quiz <em>broadcast</em> for classrooms, conference rooms, and the back of any room with a projector.
                You are the producer, the room is the audience, the answers are tabulated <em>live</em>.
              </p>
            </div>
            <div className="col-span-12 md:col-span-6 md:pl-10">
              <ul className="space-y-3">
                {[
                  "BUILD A QUIZ IN UNDER FIVE MINUTES",
                  "PROJECT THE FEED. KEEP THE CONTROLS PRIVATE.",
                  "SCORING WEIGHTED BY SPEED. SERVER-AUTHORITATIVE.",
                  "PLAYERS JOIN WITH A SIX-DIGIT PIN. NO LOGIN.",
                ].map((s, i) => (
                  <li key={s} className="flex gap-4 items-baseline">
                    <span
                      className="ticker text-[11px] tracking-widest"
                      style={{ color: "var(--vermilion)" }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="font-editorial text-lg">{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="relative px-8 pb-16">
        <div className="max-w-[1240px] mx-auto grid grid-cols-12 gap-6">
          <Link
            href="/host"
            className="col-span-12 md:col-span-7 group ink-border stamp-lg p-8 md:p-10 relative"
            style={{ background: "var(--vermilion)", color: "var(--bone)" }}
          >
            <div className="flex items-start justify-between">
              <Chyron label="HOST · CTRL ROOM" number="A" />
              <span className="ticker text-[11px] tracking-widest opacity-80">PRESS · ENTER</span>
            </div>
            <p
              className="display-num mt-6"
              style={{ fontSize: "clamp(56px, 9vw, 132px)" }}
            >
              GO LIVE
            </p>
            <p className="font-editorial text-lg mt-4 max-w-md">
              Open the director's console. Build a quiz, generate a PIN, and start the broadcast.
            </p>
            <span className="absolute bottom-6 right-8 ticker text-[11px] tracking-widest">
              /host →
            </span>
          </Link>

          <Link
            href="/join"
            className="col-span-12 md:col-span-5 group ink-border stamp-lg p-8 md:p-10 relative"
            style={{ background: "var(--bone)" }}
          >
            <div className="flex items-start justify-between">
              <Chyron label="PLAYER · STUDIO" number="B" />
              <span className="ticker text-[11px] tracking-widest" style={{ color: "var(--ash)" }}>
                NO ACCOUNT
              </span>
            </div>
            <p
              className="display-num mt-6"
              style={{ fontSize: "clamp(56px, 9vw, 132px)" }}
            >
              JOIN
            </p>
            <p className="font-editorial text-lg mt-4">
              Have a 6-digit PIN? Tap in, pick a name, and you're on air.
            </p>
            <span className="absolute bottom-6 right-8 ticker text-[11px] tracking-widest">
              /join →
            </span>
          </Link>
        </div>

        <div
          className="max-w-[1240px] mx-auto mt-10 ink-border p-6 flex flex-wrap items-center gap-8 justify-between"
          style={{ background: "var(--bone)" }}
        >
          <div className="flex items-center gap-5">
            <span className="ticker text-[11px] tracking-widest opacity-70">CHANNELS</span>
            {[
              { kind: "triangle", color: "var(--vermilion)" },
              { kind: "diamond", color: "var(--cobalt)" },
              { kind: "circle", color: "var(--marigold)" },
              { kind: "square", color: "var(--ivy)" },
            ].map((c, i) => (
              <div key={c.kind} className="flex items-center gap-2">
                <Shape kind={c.kind as any} fill={c.color} size={28} />
                <span className="ticker text-[11px] tracking-widest">
                  CH.{String(i + 1).padStart(2, "0")}
                </span>
              </div>
            ))}
          </div>
          <p className="font-editorial italic max-w-md">
            Distinguishable by shape, not just color — keep the four answer channels readable for every audience member.
          </p>
        </div>
      </section>

      <footer className="px-8 pb-8 max-w-[1240px] mx-auto flex items-end justify-between border-t-2 pt-4" style={{ borderColor: "var(--ink)" }}>
        <span className="ticker text-[11px] tracking-widest opacity-60">
          © BROADCAST NETWORK · STUDIO 4 · TRANSMISSION 0001
        </span>
        <span className="font-editorial italic opacity-60">
          "Roll tape."
        </span>
      </footer>
    </main>
  );
}
