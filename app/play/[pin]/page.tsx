"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSocket } from "@/lib/socket";
import { CHANNELS, Shape } from "@/components/Shape";
import { Chyron, Clock, CornerMarks, FrameCounter, OnAir, SmpteBars } from "@/components/Broadcast";
import { Countdown } from "@/components/Countdown";
import type { AnswerIndex, PublicGameState } from "@/lib/types";

interface Personal {
  hasAnswered: boolean;
  lastAnswer?: AnswerIndex;
  lastAwarded?: number;
  lastCorrect?: boolean;
  rank?: number;
  total?: number;
  score?: number;
}

export default function PlayPage({ params }: { params: Promise<{ pin: string }> }) {
  const socket = useSocket();
  const [pin, setPin] = useState<string>("");
  const [state, setState] = useState<PublicGameState | null>(null);
  const [personal, setPersonal] = useState<Personal | null>(null);
  const [me, setMe] = useState<{ id: string; nickname: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    params.then((p) => setPin(p.pin));
  }, [params]);

  useEffect(() => {
    if (!pin) return;
    const id = sessionStorage.getItem(`bc:player:${pin}`);
    const nick = sessionStorage.getItem(`bc:nick:${pin}`);
    if (id && nick) setMe({ id, nickname: nick });
  }, [pin]);

  useEffect(() => {
    if (!socket || !pin) return;
    const onState = (s: PublicGameState) => {
      if (s.pin === pin) setState(s);
    };
    const onPersonal = (p: Personal) => setPersonal(p);
    socket.on("state", onState);
    socket.on("personal", onPersonal);
    return () => {
      socket.off("state", onState);
      socket.off("personal", onPersonal);
    };
  }, [socket, pin]);

  function submit(i: AnswerIndex) {
    if (!socket || !pin) return;
    if (state?.phase !== "question") return;
    if (personal?.hasAnswered) return;
    setSubmitting(true);
    setError(null);
    socket.emit(
      "player:answer",
      pin,
      i,
      (res: { ok: boolean; error?: string }) => {
        setSubmitting(false);
        if (!res.ok) setError(res.error ?? "Could not submit");
      },
    );
  }

  const phase = state?.phase ?? "lobby";
  const live = phase !== "lobby" && phase !== "final";
  const currentNo = Math.max(0, (state?.questionIndex ?? -1) + 1);

  if (!me) {
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <div className="max-w-md text-center">
          <p className="chyron mb-3" style={{ color: "var(--vermilion)" }}>
            NO CREDENTIAL FOUND
          </p>
          <p className="font-editorial text-xl mb-4">
            Looks like you arrived without checking in.
          </p>
          <Link
            href="/join"
            className="ink-border stamp ticker text-[12px] tracking-widest px-4 py-3 inline-block"
            style={{ background: "var(--vermilion)", color: "var(--bone)" }}
          >
            ↩ HEAD TO /JOIN
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen pb-10 flex flex-col">
      <CornerMarks />
      <header className="px-5 pt-4 flex items-center justify-between gap-3">
        <Chyron label="ON AIR · TALENT" number="B" />
        <div className="flex items-center gap-4">
          <FrameCounter index={currentNo} />
          <Clock />
          <OnAir live={live} />
        </div>
      </header>
      <SmpteBars className="h-1.5 mt-3" />

      <div className="px-5 pt-4 max-w-[680px] mx-auto w-full flex-1 flex flex-col">
        <div className="flex items-center justify-between border-b-2 pb-2" style={{ borderColor: "var(--ink)" }}>
          <span className="font-editorial text-lg">
            <span className="opacity-60">ID·</span>
            <span className="ml-1">{me.nickname}</span>
          </span>
          <span className="ticker text-[11px] tracking-widest opacity-70">
            PIN {pin}
          </span>
        </div>

        {phase === "lobby" && <PlayerLobby state={state} nickname={me.nickname} />}
        {phase === "question" && state && (
          <PlayerQuestion
            state={state}
            personal={personal}
            onSubmit={submit}
            submitting={submitting}
            error={error}
          />
        )}
        {phase === "reveal" && state && <PlayerReveal state={state} personal={personal} />}
        {phase === "leaderboard" && <PlayerInterstitial personal={personal} />}
        {phase === "final" && <PlayerFinal personal={personal} state={state} />}
      </div>
    </main>
  );
}

function PlayerLobby({ state, nickname }: { state: PublicGameState | null; nickname: string }) {
  return (
    <div className="flex-1 flex flex-col justify-center items-center text-center pt-10">
      <p className="chyron mb-3" style={{ color: "var(--vermilion)" }}>
        STAND BY · MIC HOT
      </p>
      <h1 className="display-num" style={{ fontSize: "clamp(72px, 18vw, 160px)" }}>
        YOU'RE&nbsp;IN.
      </h1>
      <p className="font-editorial text-2xl mt-3">
        On air as <span className="font-bold not-italic">{nickname}</span>.
      </p>
      <p className="font-editorial italic text-lg mt-1 opacity-70">
        Look at the host's screen. We'll cut to the first question shortly.
      </p>
      <div className="mt-8 flex items-center gap-3">
        <span className="live-dot" />
        <span className="ticker text-[11px] tracking-widest">
          {state?.players.length ?? 0} ON THE FLOOR
        </span>
      </div>
    </div>
  );
}

function PlayerQuestion({
  state,
  personal,
  onSubmit,
  submitting,
  error,
}: {
  state: PublicGameState;
  personal: Personal | null;
  onSubmit: (i: AnswerIndex) => void;
  submitting: boolean;
  error: string | null;
}) {
  const q = state.question;
  if (!q) return null;
  const answered = personal?.hasAnswered;
  const myChoice = personal?.lastAnswer;

  return (
    <div className="pt-4 flex-1 flex flex-col">
      <div className="flex items-center justify-between">
        <span
          className="ticker text-[11px] tracking-widest px-2 py-[2px]"
          style={{ background: "var(--vermilion)", color: "var(--bone)" }}
        >
          CUE {String(state.questionIndex + 1).padStart(2, "0")} / {String(state.totalQuestions).padStart(2, "0")}
        </span>
        <Countdown endsAt={state.endsAt} startedAt={state.startedAt} size={64} />
      </div>

      <p className="font-editorial leading-tight mt-3 teleprompter" style={{ fontSize: "clamp(22px, 5vw, 32px)" }}>
        {q.text}
      </p>

      <div className="grid grid-cols-2 gap-3 mt-6">
        {q.options.map((opt, i) => {
          const ch = CHANNELS[i] ?? CHANNELS[0];
          const mine = myChoice === i;
          const dim = answered && !mine;
          return (
            <button
              key={i}
              onClick={() => onSubmit(i as AnswerIndex)}
              disabled={answered || submitting}
              className="answer-tile relative ink-border p-4 flex flex-col items-start text-left"
              style={{
                background: ch.color,
                color: "var(--bone)",
                opacity: dim ? 0.45 : 1,
                minHeight: 132,
              }}
              aria-label={`${ch.label}: ${opt}`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="ticker text-[11px] tracking-widest opacity-90">
                  CH.{String(i + 1).padStart(2, "0")}
                </span>
                <Shape kind={ch.key} fill="var(--bone)" stroke="var(--ink)" size={36} />
              </div>
              <span className="font-editorial text-xl mt-3 leading-snug">
                {q.type === "truefalse" ? opt : opt}
              </span>
              {mine && (
                <span
                  className="absolute -top-3 -right-3 ticker text-[11px] tracking-widest px-2 py-1 stamp stamp-in"
                  style={{ background: "var(--ink)", color: "var(--bone)" }}
                >
                  LOCKED
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-5 min-h-[28px]">
        {error && (
          <p
            className="ticker text-[11px] tracking-widest"
            style={{ color: "var(--vermilion)" }}
          >
            ⚠ {error}
          </p>
        )}
        {answered && (
          <p className="font-editorial italic text-lg">
            Answer locked. Hold for the reveal.
          </p>
        )}
      </div>
    </div>
  );
}

function PlayerReveal({ state, personal }: { state: PublicGameState; personal: Personal | null }) {
  const correct = state.reveal?.correct;
  const correctCh = correct !== undefined ? CHANNELS[correct] : null;
  const isCorrect = personal?.lastCorrect === true;
  const noAnswer = personal && !personal.hasAnswered;
  const score = personal?.score ?? 0;
  const awarded = personal?.lastAwarded ?? 0;
  const rank = personal?.rank;
  const total = personal?.total;

  let banner: { label: string; bg: string; fg: string };
  if (noAnswer) banner = { label: "NO ANSWER", bg: "var(--ash)", fg: "var(--ink)" };
  else if (isCorrect) banner = { label: "CORRECT", bg: "var(--ivy)", fg: "var(--bone)" };
  else banner = { label: "INCORRECT", bg: "var(--vermilion)", fg: "var(--bone)" };

  return (
    <div className="pt-6 flex-1 flex flex-col">
      <div
        className="ink-border stamp px-4 py-6 flash-cut"
        style={{ background: banner.bg, color: banner.fg }}
      >
        <span className="chyron" style={{ color: banner.fg, opacity: 0.85 }}>
          REVEAL
        </span>
        <p className="display-num mt-1" style={{ fontSize: "clamp(64px, 16vw, 130px)" }}>
          {banner.label}
        </p>
        {!noAnswer && isCorrect && (
          <p className="ticker tabular-nums text-3xl">+{awarded.toLocaleString()} pts</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 mt-5">
        <div className="ink-border p-4" style={{ background: "var(--bone)" }}>
          <span className="chyron opacity-70">YOUR SCORE</span>
          <p className="display-num text-5xl mt-1 ticker">{score.toLocaleString()}</p>
        </div>
        <div className="ink-border p-4" style={{ background: "var(--bone)" }}>
          <span className="chyron opacity-70">RANK</span>
          <p className="display-num text-5xl mt-1 ticker">
            {rank ? `${rank}/${total ?? "—"}` : "—"}
          </p>
        </div>
      </div>

      {correctCh && (
        <div
          className="mt-5 ink-border p-4 flex items-center gap-4"
          style={{ background: correctCh.color, color: "var(--bone)" }}
        >
          <Shape kind={correctCh.key} fill="var(--bone)" stroke="var(--ink)" size={42} />
          <div>
            <span className="chyron" style={{ color: "var(--bone)", opacity: 0.85 }}>
              CORRECT ANSWER
            </span>
            <p className="font-editorial text-xl">
              {state.question?.options[correct!]}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerInterstitial({ personal }: { personal: Personal | null }) {
  return (
    <div className="flex-1 flex flex-col justify-center items-center text-center pt-10">
      <p className="chyron mb-3" style={{ color: "var(--vermilion)" }}>
        BETWEEN CUES · STANDBY
      </p>
      <p className="display-num" style={{ fontSize: "clamp(56px, 14vw, 120px)" }}>
        HOLD&nbsp;TIGHT.
      </p>
      <div className="grid grid-cols-2 gap-3 mt-8 w-full max-w-[420px]">
        <div className="ink-border p-4" style={{ background: "var(--bone)" }}>
          <span className="chyron opacity-70">SCORE</span>
          <p className="display-num text-4xl mt-1 ticker">
            {(personal?.score ?? 0).toLocaleString()}
          </p>
        </div>
        <div className="ink-border p-4" style={{ background: "var(--bone)" }}>
          <span className="chyron opacity-70">RANK</span>
          <p className="display-num text-4xl mt-1 ticker">
            {personal?.rank ? `${personal.rank}/${personal.total}` : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}

function PlayerFinal({
  personal,
  state,
}: {
  personal: Personal | null;
  state: PublicGameState | null;
}) {
  const rank = personal?.rank ?? 0;
  const podium = rank > 0 && rank <= 3;
  return (
    <div className="flex-1 flex flex-col items-center text-center pt-8">
      <p className="chyron mb-3" style={{ color: "var(--vermilion)" }}>
        TRANSMISSION COMPLETE
      </p>
      <p className="display-num" style={{ fontSize: "clamp(72px, 18vw, 160px)" }}>
        {podium ? "ON THE PODIUM." : "WRAP IT UP."}
      </p>
      <div className="grid grid-cols-2 gap-3 mt-6 w-full max-w-[420px]">
        <div className="ink-border p-4" style={{ background: "var(--marigold)" }}>
          <span className="chyron opacity-70">FINAL SCORE</span>
          <p className="display-num text-4xl mt-1 ticker">
            {(personal?.score ?? 0).toLocaleString()}
          </p>
        </div>
        <div className="ink-border p-4" style={{ background: "var(--bone)" }}>
          <span className="chyron opacity-70">FINAL RANK</span>
          <p className="display-num text-4xl mt-1 ticker">
            {personal?.rank ? `${personal.rank}/${personal.total}` : "—"}
          </p>
        </div>
      </div>
      <Link
        href="/"
        className="mt-8 ink-border stamp ticker text-[12px] tracking-widest px-4 py-3"
        style={{ background: "var(--ink)", color: "var(--bone)" }}
      >
        ← back to studio master
      </Link>
    </div>
  );
}
