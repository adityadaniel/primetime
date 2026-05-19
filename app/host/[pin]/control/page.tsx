"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSocket } from "@/lib/socket";
import { CHANNELS, Shape } from "@/components/Shape";
import { Chyron, Clock, CornerMarks, FrameCounter, OnAir, SmpteBars } from "@/components/Broadcast";
import { Countdown } from "@/components/Countdown";
import type { PublicGameState } from "@/lib/types";

export default function ControlPanel({ params }: { params: Promise<{ pin: string }> }) {
  const socket = useSocket();
  const [pin, setPin] = useState<string>("");
  const [state, setState] = useState<PublicGameState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    params.then((p) => setPin(p.pin));
  }, [params]);

  useEffect(() => {
    if (!socket || !pin) return;
    socket.emit("host:attach", pin);
    const onState = (s: PublicGameState) => {
      if (s.pin === pin) setState(s);
    };
    const onReconnected = (e: { nickname: string }) => {
      setToast(`${e.nickname} reconnected`);
      window.setTimeout(() => setToast(null), 3500);
    };
    const onConnect = () => {
      socket.emit("host:attach", pin);
    };
    socket.on("state", onState);
    socket.on("event:reconnected", onReconnected);
    socket.on("connect", onConnect);
    return () => {
      socket.off("state", onState);
      socket.off("event:reconnected", onReconnected);
      socket.off("connect", onConnect);
    };
  }, [socket, pin]);

  function startGame() {
    if (!socket || !pin) return;
    socket.emit("host:start", pin);
  }
  function nextStep() {
    if (!socket || !pin) return;
    socket.emit("host:advance", pin);
  }
  function kick(playerId: string) {
    if (!socket || !pin) return;
    if (!confirm("Remove this player?")) return;
    socket.emit("host:kick", pin, playerId);
  }

  const phase = state?.phase ?? "lobby";
  const live = phase !== "lobby" && phase !== "final";
  const currentNo = Math.max(0, (state?.questionIndex ?? -1) + 1);

  const responseCount = state?.reveal?.totalAnswers ?? 0;
  const liveAnswers =
    phase === "question" || phase === "reveal"
      ? state?.players?.length ?? 0
      : 0;

  const playerCount = state?.playerCount ?? state?.players.length ?? 0;
  const softCap = state?.cap?.soft ?? 10;
  const hardCap = state?.cap?.hard ?? 150;
  const upsell = state?.cap?.upsell ?? false;

  const board = state ? [...state.players].sort((a, b) => b.score - a.score) : [];

  return (
    <main className="relative min-h-screen pb-20">
      <CornerMarks />
      {toast && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 ink-border stamp ticker text-[11px] tracking-widest px-3 py-2"
          style={{ background: "var(--ivy)", color: "var(--bone)" }}
        >
          ✓ {toast}
        </div>
      )}
      <header className="px-6 pt-4 flex items-center justify-between">
        <Chyron label="DIRECTOR · CONTROL ROOM" number="C" />
        <div className="flex items-center gap-6">
          <FrameCounter index={currentNo} />
          <Clock />
          <OnAir live={live} />
        </div>
      </header>
      <SmpteBars className="h-1.5 mt-3" />

      {upsell && (
        <div
          className="px-6 mt-3"
          role="status"
          aria-live="polite"
        >
          <div
            className="ink-border halftone px-4 py-3 flex items-center gap-4 max-w-[1500px] mx-auto"
            style={{ background: "var(--marigold)", color: "var(--ink)" }}
          >
            <span
              className="ticker text-[11px] tracking-widest px-2 py-[2px] ink-border shrink-0"
              style={{ background: "var(--ink)", color: "var(--bone)" }}
            >
              UPSELL · ADVISORY
            </span>
            <p className="font-editorial text-[15px] md:text-base leading-tight flex-1">
              Approaching <span className="ticker">{softCap}</span>-player limit.
              Upgrade to <span className="ticker">PRO</span> for{" "}
              <span className="ticker">{hardCap}</span> players.
            </p>
            <span className="ticker text-[11px] tracking-widest opacity-70 hidden md:inline">
              {String(playerCount).padStart(2, "0")} / {String(softCap).padStart(2, "0")}
            </span>
          </div>
        </div>
      )}

      <section className="px-6 pt-6 max-w-[1500px] mx-auto grid grid-cols-12 gap-5">
        <div
          className="col-span-12 lg:col-span-8 ink-border p-6"
          style={{ background: "var(--bone)" }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="chyron" style={{ color: "var(--vermilion)" }}>
                GAME PIN
              </span>
              <p
                className="display-num ticker mt-1"
                style={{ fontSize: "clamp(72px, 12vw, 160px)", letterSpacing: "0.06em" }}
              >
                {pin || "······"}
              </p>
              <p className="font-editorial italic mt-1 opacity-70">
                Players join at <span className="ticker not-italic">/join</span> with this code.
              </p>
            </div>
            <div className="flex flex-col items-end gap-3">
              <PhaseBadge phase={phase} />
              <a
                href={`/host/${pin}/display`}
                target="_blank"
                rel="noopener noreferrer"
                className="ink-border ticker text-[11px] tracking-widest px-3 py-2"
              >
                ⤴ OPEN PROJECTION
              </a>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-12 gap-4">
            <PanelStat
              cols="col-span-12 md:col-span-3"
              label="PLAYERS"
              value={`${String(playerCount).padStart(2, "0")} / ${String(softCap).padStart(2, "0")}`}
            />
            <PanelStat
              cols="col-span-12 md:col-span-3"
              label="QUESTION"
              value={`${String(currentNo).padStart(2, "0")} / ${String(state?.totalQuestions ?? 0).padStart(2, "0")}`}
            />
            <PanelStat
              cols="col-span-12 md:col-span-3"
              label="ANSWERS"
              value={`${responseCount}/${liveAnswers}`}
            />
            <div className="col-span-12 md:col-span-3 ink-border p-4 flex flex-col items-start" style={{ background: "var(--bone)" }}>
              <span className="chyron opacity-70">TIMER</span>
              {state?.endsAt && (phase === "question") ? (
                <Countdown endsAt={state.endsAt} startedAt={state.startedAt} size={70} />
              ) : (
                <span className="display-num text-3xl">—</span>
              )}
            </div>
          </div>

          <div className="mt-8">
            {phase === "lobby" && state && (
              <LobbyView state={state} onStart={startGame} onKick={kick} />
            )}
            {(phase === "question" || phase === "reveal") && state && (
              <QuestionStage state={state} />
            )}
            {phase === "leaderboard" && state && (
              <LeaderboardStage state={state} />
            )}
            {phase === "final" && state && (
              <FinalStage state={state} pin={pin} />
            )}
          </div>
        </div>

        <aside
          className="col-span-12 lg:col-span-4 ink-border p-5 flex flex-col"
          style={{ background: "var(--bone)" }}
        >
          <div className="flex items-center justify-between">
            <span className="chyron">STANDINGS</span>
            <span className="ticker text-[11px] tracking-widest opacity-60">
              {String(playerCount).padStart(2, "0")} / {String(softCap).padStart(2, "0")} PLAYERS
            </span>
          </div>
          <ol className="mt-3 divide-y" style={{ borderColor: "rgba(15,15,15,.18)" }}>
            {board.length === 0 && (
              <li className="font-editorial italic opacity-60 py-3">
                No players have joined yet.
              </li>
            )}
            {board.map((p, i) => (
              <li
                key={p.id}
                className="py-2 flex items-center gap-3 border-b last:border-b-0"
                style={{ borderColor: "rgba(15,15,15,.18)" }}
              >
                <span className="display-num text-2xl" style={{ minWidth: 36 }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-editorial flex-1 truncate text-lg">{p.nickname}</span>
                <span className="ticker text-sm">{p.score.toLocaleString()}</span>
                {!p.connected && (
                  <span className="ticker text-[10px] tracking-widest opacity-60">OFFLINE</span>
                )}
              </li>
            ))}
          </ol>

          <div className="mt-auto pt-4 border-t-2 flex flex-col gap-2" style={{ borderColor: "var(--ink)" }}>
            <button
              onClick={nextStep}
              className="ink-border stamp px-4 py-3 ticker tracking-widest text-[12px]"
              style={{ background: "var(--vermilion)", color: "var(--bone)" }}
            >
              ▶ {nextLabel(phase)}
            </button>
            <Link href="/host" className="ticker text-[11px] tracking-widest opacity-70">
              ← back to builder
            </Link>
          </div>
        </aside>
      </section>
    </main>
  );
}

function nextLabel(phase: string) {
  switch (phase) {
    case "lobby":
      return "START GAME";
    case "question":
      return "LOCK ANSWERS";
    case "reveal":
      return "SHOW LEADERBOARD";
    case "leaderboard":
      return "NEXT QUESTION";
    case "final":
      return "GAME OVER";
    default:
      return "ADVANCE";
  }
}

function PhaseBadge({ phase }: { phase: string }) {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    lobby: { label: "LOBBY · STANDBY", bg: "var(--ash)", fg: "var(--ink)" },
    question: { label: "ON AIR · LIVE", bg: "var(--vermilion)", fg: "var(--bone)" },
    reveal: { label: "REVEAL", bg: "var(--marigold)", fg: "var(--ink)" },
    leaderboard: { label: "PODIUM", bg: "var(--cobalt)", fg: "var(--bone)" },
    final: { label: "FADE OUT", bg: "var(--ink)", fg: "var(--bone)" },
  };
  const s = map[phase] ?? map.lobby;
  return (
    <span
      className="ticker tracking-widest text-[12px] px-3 py-1 ink-border"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

function PanelStat({ cols, label, value }: { cols: string; label: string; value: string }) {
  return (
    <div
      className={`${cols} ink-border p-4 flex flex-col`}
      style={{ background: "var(--bone)" }}
    >
      <span className="chyron opacity-70">{label}</span>
      <span className="display-num text-3xl mt-1 ticker">{value}</span>
    </div>
  );
}

function LobbyView({
  state,
  onStart,
  onKick,
}: {
  state: PublicGameState;
  onStart: () => void;
  onKick: (id: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="font-editorial text-xl italic">
          {state.players.length === 0
            ? "Waiting for players to join…"
            : "Players checked in. Roll tape when ready."}
        </p>
        <button
          onClick={onStart}
          disabled={state.players.length === 0}
          className="ink-border stamp px-4 py-2 ticker tracking-widest text-[12px]"
          style={{
            background: state.players.length ? "var(--ink)" : "var(--ash)",
            color: "var(--bone)",
          }}
        >
          ▶ ROLL TAPE
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {state.players.map((p, i) => (
          <div
            key={p.id}
            className="ink-border px-3 py-2 flex items-center justify-between"
            style={{ background: "var(--bone)" }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="ticker text-[11px] tracking-widest opacity-60">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="font-editorial truncate">{p.nickname}</span>
            </div>
            <button
              onClick={() => onKick(p.id)}
              className="ticker text-[10px] tracking-widest opacity-60 hover:opacity-100"
              aria-label={`Kick ${p.nickname}`}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuestionStage({ state }: { state: PublicGameState }) {
  const q = state.question;
  if (!q) return null;
  const dist = state.reveal?.distribution ?? new Array(q.options.length).fill(0);
  const total = Math.max(1, dist.reduce((a, b) => a + b, 0));
  const correct = state.reveal?.correct;
  return (
    <div>
      <p
        className="font-editorial leading-tight teleprompter"
        style={{ fontSize: "clamp(28px, 4vw, 48px)" }}
      >
        {q.text}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-6">
        {q.options.map((opt, i) => {
          const ch = CHANNELS[i] ?? CHANNELS[0];
          const pct = Math.round((dist[i] / total) * 100);
          const isCorrect = state.phase === "reveal" && correct === i;
          const isWrong = state.phase === "reveal" && correct !== undefined && correct !== i;
          return (
            <div
              key={i}
              className="ink-border relative overflow-hidden"
              style={{
                background: "var(--bone)",
                opacity: isWrong ? 0.5 : 1,
              }}
            >
              <div
                className="absolute inset-y-0 left-0"
                style={{
                  width: state.phase === "reveal" ? `${pct}%` : "0%",
                  background: ch.color,
                  opacity: 0.18,
                  transition: "width 380ms ease-out",
                }}
              />
              <div className="relative flex items-center gap-3 p-3">
                <div
                  className="grid place-items-center w-12 h-12 shrink-0 border-r-2"
                  style={{ borderColor: "var(--ink)", background: ch.color }}
                >
                  <Shape kind={ch.key} fill="var(--bone)" stroke="var(--ink)" size={28} />
                </div>
                <div className="flex-1">
                  <span className="chyron opacity-70">CH.{String(i + 1).padStart(2, "0")}</span>
                  <p className="font-editorial text-lg">{opt}</p>
                </div>
                <div className="ticker tabular-nums text-right">
                  <div className="text-2xl">{dist[i]}</div>
                  <div className="text-[10px] tracking-widest opacity-60">
                    {state.phase === "reveal" ? `${pct}%` : "·"}
                  </div>
                </div>
                {isCorrect && (
                  <span
                    className="absolute -top-2 right-2 ticker text-[10px] tracking-widest px-2 py-[2px]"
                    style={{ background: "var(--ivy)", color: "var(--bone)" }}
                  >
                    ✓ CORRECT
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LeaderboardStage({ state }: { state: PublicGameState }) {
  const top = state.podium ?? [];
  return (
    <div>
      <p className="chyron mb-3" style={{ color: "var(--vermilion)" }}>
        STANDINGS · BETWEEN CUES
      </p>
      <div className="grid grid-cols-3 gap-3 items-end">
        {[1, 0, 2].map((rankIdx, i) => {
          const p = top[rankIdx];
          if (!p) return <div key={i} />;
          const heights = ["h-24", "h-32", "h-20"];
          return (
            <div key={p.id} className="flex flex-col items-center">
              <div className="font-editorial text-lg truncate w-full text-center">{p.nickname}</div>
              <div className="ticker text-2xl tabular-nums">{p.score.toLocaleString()}</div>
              <div
                className={`w-full ${heights[i]} ink-border mt-2 grid place-items-center`}
                style={{
                  background:
                    rankIdx === 0
                      ? "var(--marigold)"
                      : rankIdx === 1
                      ? "var(--ash)"
                      : "var(--vermilion)",
                }}
              >
                <span className="display-num text-6xl">{rankIdx + 1}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FinalStage({ state, pin }: { state: PublicGameState; pin: string }) {
  const board = [...state.players].sort((a, b) => b.score - a.score);
  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="chyron mb-2" style={{ color: "var(--vermilion)" }}>
            TRANSMISSION COMPLETE
          </p>
          <p className="display-num" style={{ fontSize: "clamp(40px, 6vw, 96px)" }}>
            FADE OUT.
          </p>
        </div>
        {pin && (
          <a
            href={`/host/${pin}/results.csv`}
            download
            className="ink-border stamp px-4 py-3 ticker tracking-widest text-[12px] self-end"
            style={{ background: "var(--ink)", color: "var(--bone)" }}
          >
            ⬇ DOWNLOAD RESULTS
          </a>
        )}
      </div>
      <ol className="mt-6 divide-y-2" style={{ borderColor: "var(--ink)" }}>
        {board.map((p, i) => (
          <li
            key={p.id}
            className="py-3 flex items-center gap-4 border-b-2 last:border-b-0"
            style={{ borderColor: "var(--ink)" }}
          >
            <span className="display-num text-4xl" style={{ minWidth: 64 }}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="font-editorial flex-1 text-2xl">{p.nickname}</span>
            <span className="ticker tabular-nums text-2xl">{p.score.toLocaleString()}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
