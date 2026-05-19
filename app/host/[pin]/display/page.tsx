"use client";

import { useEffect, useState } from "react";
import { useSocket } from "@/lib/socket";
import { CHANNELS, Shape } from "@/components/Shape";
import { Chyron, Clock, FrameCounter, OnAir, SmpteBars } from "@/components/Broadcast";
import { Countdown } from "@/components/Countdown";
import type { PublicGameState } from "@/lib/types";

export default function DisplayPage({ params }: { params: Promise<{ pin: string }> }) {
  const socket = useSocket();
  const [pin, setPin] = useState<string>("");
  const [state, setState] = useState<PublicGameState | null>(null);

  useEffect(() => {
    params.then((p) => setPin(p.pin));
  }, [params]);

  useEffect(() => {
    if (!socket || !pin) return;
    socket.emit("display:attach", pin);
    const onState = (s: PublicGameState) => {
      if (s.pin === pin) setState(s);
    };
    socket.on("state", onState);
    return () => {
      socket.off("state", onState);
    };
  }, [socket, pin]);

  const phase = state?.phase ?? "lobby";
  const dark = phase === "question" || phase === "reveal";
  const live = phase !== "lobby" && phase !== "final";
  const currentNo = Math.max(0, (state?.questionIndex ?? -1) + 1);

  return (
    <main
      className={`relative min-h-screen w-full overflow-hidden grain ${dark ? "ink-bg" : ""}`}
      style={{
        background: dark ? "var(--ink)" : "var(--bone)",
        color: dark ? "var(--bone)" : "var(--ink)",
      }}
    >
      <CornerMarksDark dark={dark} />
      <header className="px-8 pt-5 flex items-center justify-between">
        <Chyron label="LIVE FEED · STUDIO 4" number="A" dark={dark} />
        <div className="flex items-center gap-7">
          <FrameCounter index={currentNo} dark={dark} />
          <Clock dark={dark} />
          <OnAir live={live} dark={dark} />
        </div>
      </header>
      <SmpteBars className="h-2 mt-3" />

      {state?.paused && <PausedOverlay resumeBy={state.paused.resumeBy} />}

      <section className="px-10 pt-8 pb-12 max-w-[1800px] mx-auto">
        {phase === "lobby" && state && <LobbyDisplay state={state} pin={pin} />}
        {(phase === "question" || phase === "reveal") && state && <QuestionDisplay state={state} />}
        {phase === "leaderboard" && state && <PodiumDisplay state={state} />}
        {phase === "final" && state && <FinalDisplay state={state} />}
      </section>
    </main>
  );
}

function CornerMarksDark({ dark }: { dark: boolean }) {
  const color = dark ? "var(--bone)" : "var(--ink)";
  return (
    <>
      <span
        className="absolute top-3 left-3 w-4 h-4 border-t-2 border-l-2"
        style={{ borderColor: color }}
        aria-hidden
      />
      <span
        className="absolute top-3 right-3 w-4 h-4 border-t-2 border-r-2"
        style={{ borderColor: color }}
        aria-hidden
      />
      <span
        className="absolute bottom-3 left-3 w-4 h-4 border-b-2 border-l-2"
        style={{ borderColor: color }}
        aria-hidden
      />
      <span
        className="absolute bottom-3 right-3 w-4 h-4 border-b-2 border-r-2"
        style={{ borderColor: color }}
        aria-hidden
      />
    </>
  );
}

function LobbyDisplay({ state, pin }: { state: PublicGameState; pin: string }) {
  return (
    <div className="grid grid-cols-12 gap-8 items-start">
      <div className="col-span-12 lg:col-span-7">
        <p className="chyron mb-3" style={{ color: "var(--vermilion)" }}>
          STAND BY · TRANSMITTING ON CHANNEL 4
        </p>
        <p className="ticker text-[14px] tracking-widest opacity-70">JOIN AT</p>
        <p className="display-num" style={{ fontSize: "clamp(48px, 8vw, 120px)", lineHeight: 0.85 }}>
          /JOIN
        </p>
        <p className="ticker text-[14px] tracking-widest opacity-70 mt-6">GAME PIN</p>
        <p
          className="display-num ticker"
          style={{
            fontSize: "clamp(140px, 22vw, 360px)",
            lineHeight: 0.82,
            letterSpacing: "0.04em",
          }}
        >
          {pin || "······"}
        </p>
        <p className="font-editorial italic text-2xl mt-6 max-w-2xl">
          {state.players.length === 0
            ? "Waiting for the first player to check in…"
            : `${state.players.length} on the floor — host signals ROLL TAPE to begin.`}
        </p>
      </div>

      <aside className="col-span-12 lg:col-span-5">
        <div className="ink-border p-5" style={{ background: "var(--bone)" }}>
          <div className="flex items-center justify-between">
            <span className="chyron">CHECK-IN</span>
            <span className="ticker text-[12px] tracking-widest">
              {String(state.players.length).padStart(2, "0")} / 10
            </span>
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-2">
            {state.players.length === 0 && (
              <li className="col-span-2 font-editorial italic opacity-60">No one on the floor.</li>
            )}
            {state.players.map((p, i) => (
              <li
                key={p.id}
                className="ink-border px-3 py-2 flex items-center gap-2 teleprompter"
                style={{ background: "var(--bone)" }}
              >
                <span className="ticker text-[11px] tracking-widest opacity-60">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-editorial truncate text-lg">{p.nickname}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="ticker text-[11px] tracking-widest mt-4 opacity-70">
          PLAYER UI: open <span className="opacity-100">/join</span> on a phone, enter the PIN, pick a name.
        </p>
      </aside>
    </div>
  );
}

function QuestionDisplay({ state }: { state: PublicGameState }) {
  const q = state.question;
  if (!q) return null;
  const qNum = String(state.questionIndex + 1).padStart(2, "0");
  const total = String(state.totalQuestions).padStart(2, "0");
  const dist = state.reveal?.distribution ?? new Array(q.options.length).fill(0);
  const totalAns = Math.max(1, dist.reduce((a, b) => a + b, 0));
  const correct = state.reveal?.correct;

  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span
            className="ticker text-[12px] tracking-widest px-2 py-[2px]"
            style={{ background: "var(--vermilion)", color: "var(--bone)" }}
          >
            CUE {qNum} / {total}
          </span>
          <span className="ticker text-[12px] tracking-widest opacity-80">
            {q.timeLimit}s · {q.doublePoints ? "2× POINTS" : "1× POINTS"}
          </span>
        </div>
        <Countdown endsAt={state.endsAt} startedAt={state.startedAt} size={120} dark />
      </div>

      <div className="col-span-12">
        <p
          className="font-editorial leading-[1.05] teleprompter"
          style={{ fontSize: "clamp(40px, 6.5vw, 108px)" }}
        >
          {q.text}
        </p>
      </div>

      <div className="col-span-12 grid grid-cols-2 lg:grid-cols-4 gap-4 mt-2">
        {q.options.map((_, i) => {
          const ch = CHANNELS[i] ?? CHANNELS[0];
          const pct = Math.round((dist[i] / totalAns) * 100);
          const isCorrect = state.phase === "reveal" && correct === i;
          const isWrong = state.phase === "reveal" && correct !== undefined && correct !== i;
          return (
            <div
              key={i}
              className="relative ink-border overflow-hidden"
              style={{
                background: ch.color,
                opacity: isWrong ? 0.35 : 1,
                aspectRatio: "1.05 / 1",
              }}
            >
              <div className="absolute inset-0 grid place-items-center">
                <Shape kind={ch.key} fill="var(--bone)" stroke="var(--ink)" size={150} strokeWidth={3} />
              </div>
              <div className="absolute top-2 left-2 ticker text-[11px] tracking-widest" style={{ color: "var(--bone)" }}>
                CH.{String(i + 1).padStart(2, "0")}
              </div>
              {state.phase === "reveal" && (
                <div className="absolute bottom-0 left-0 right-0 px-3 py-2 flex items-end justify-between" style={{ background: "rgba(15,15,15,0.78)" }}>
                  <span className="display-num text-5xl" style={{ color: "var(--bone)" }}>
                    {dist[i]}
                  </span>
                  <span className="ticker text-[12px] tracking-widest" style={{ color: "var(--bone)" }}>
                    {pct}%
                  </span>
                </div>
              )}
              {isCorrect && (
                <span
                  className="absolute -top-2 -right-2 ticker text-[12px] tracking-widest px-2 py-[3px] stamp"
                  style={{ background: "var(--ivy)", color: "var(--bone)", transform: "rotate(-4deg)" }}
                >
                  ✓ CORRECT
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PodiumDisplay({ state }: { state: PublicGameState }) {
  const order = state.podium ?? [];
  const slots = [order[1], order[0], order[2]];
  const heights = ["40%", "65%", "30%"];
  const colors = ["var(--ash)", "var(--marigold)", "var(--vermilion)"];
  const ranks = [2, 1, 3];
  return (
    <div>
      <p className="chyron mb-3" style={{ color: "var(--vermilion)" }}>
        AFTER CUE {String(state.questionIndex + 1).padStart(2, "0")} · STANDINGS
      </p>
      <div className="grid grid-cols-3 gap-6 items-end h-[60vh]">
        {slots.map((p, i) => (
          <div key={i} className="flex flex-col items-center justify-end h-full">
            {p ? (
              <>
                <div className="font-editorial text-3xl truncate w-full text-center mb-2">{p.nickname}</div>
                <div className="ticker tabular-nums text-2xl mb-3">{p.score.toLocaleString()}</div>
              </>
            ) : (
              <div className="font-editorial italic opacity-50 mb-3">—</div>
            )}
            <div
              className="w-full ink-border grid place-items-center"
              style={{ background: colors[i], height: heights[i] }}
            >
              <span
                className="display-num"
                style={{ fontSize: "clamp(80px, 14vw, 220px)", color: "var(--ink)" }}
              >
                {ranks[i]}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FinalDisplay({ state }: { state: PublicGameState }) {
  const board = [...state.players].sort((a, b) => b.score - a.score);
  const winner = board[0];
  const hostLeft = state.endedReason === "host-left";
  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12">
        <p className="chyron" style={{ color: "var(--vermilion)" }}>
          {hostLeft ? "HOST LEFT · TRANSMISSION ENDED" : "FADE TO BLACK · FINAL TRANSMISSION"}
        </p>
        <p className="display-num" style={{ fontSize: "clamp(80px, 16vw, 240px)", lineHeight: 0.85 }}>
          {hostLeft ? "OFF AIR." : "THAT'S A WRAP."}
        </p>
      </div>
      {winner && (
        <div className="col-span-12 lg:col-span-7 ink-border p-8" style={{ background: "var(--marigold)" }}>
          <span className="chyron">CHAMPION · CH.01</span>
          <p className="display-num mt-2" style={{ fontSize: "clamp(56px, 10vw, 144px)" }}>
            {winner.nickname}
          </p>
          <p className="ticker tabular-nums text-3xl mt-2">
            {winner.score.toLocaleString()} pts
          </p>
        </div>
      )}
      <div className="col-span-12 lg:col-span-5 ink-border" style={{ background: "var(--bone)" }}>
        <div className="px-4 py-2 border-b-2" style={{ borderColor: "var(--ink)" }}>
          <span className="chyron">FINAL ORDER</span>
        </div>
        <ol>
          {board.map((p, i) => (
            <li
              key={p.id}
              className="px-4 py-2 flex items-center gap-3 border-b last:border-b-0"
              style={{ borderColor: "rgba(15,15,15,.18)" }}
            >
              <span className="display-num text-3xl" style={{ minWidth: 40 }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="font-editorial flex-1 truncate text-lg">{p.nickname}</span>
              <span className="ticker tabular-nums">{p.score.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function PausedOverlay({ resumeBy }: { resumeBy: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const remaining = Math.max(0, Math.ceil((resumeBy - now) / 1000));
  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center"
      style={{ background: "rgba(15,15,15,0.92)" }}
    >
      <div className="text-center px-8" style={{ color: "var(--bone)" }}>
        <p className="chyron mb-3" style={{ color: "var(--marigold)" }}>
          SIGNAL DROPPED · STAND BY
        </p>
        <p className="display-num" style={{ fontSize: "clamp(80px, 14vw, 200px)", lineHeight: 0.85 }}>
          PAUSED.
        </p>
        <p className="font-editorial italic text-2xl mt-3 opacity-80">
          Host went off-air. Resuming if they reconnect.
        </p>
        <p
          className="display-num ticker tabular-nums mt-6"
          style={{ fontSize: "clamp(64px, 10vw, 120px)", color: "var(--marigold)" }}
        >
          {String(remaining).padStart(2, "0")}s
        </p>
      </div>
    </div>
  );
}
