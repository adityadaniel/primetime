"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSocket } from "@/lib/socket";
import { Chyron, Clock, CornerMarks, FrameCounter, OnAir, SmpteBars } from "@/components/Broadcast";

export default function JoinPage() {
  const router = useRouter();
  const socket = useSocket();
  const [pin, setPin] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!socket) return;
    setError(null);
    setErrorCode(null);
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      setError("PIN must be 6 digits");
      return;
    }
    if (!nickname.trim()) {
      setError("Pick a name");
      return;
    }
    setPending(true);
    socket.emit(
      "player:join",
      pin,
      nickname.trim(),
      (res: { ok: boolean; error?: string; code?: string; playerId?: string }) => {
        setPending(false);
        if (!res.ok) {
          setError(res.error ?? "Could not join");
          setErrorCode(res.code ?? null);
          return;
        }
        if (typeof window !== "undefined") {
          sessionStorage.setItem(`bc:player:${pin}`, res.playerId ?? "");
          sessionStorage.setItem(`bc:nick:${pin}`, nickname.trim());
        }
        router.push(`/play/${pin}`);
      },
    );
  }

  return (
    <main className="relative min-h-screen flex flex-col">
      <CornerMarks />
      <header className="px-6 pt-5 flex items-center justify-between">
        <Chyron label="STUDIO ENTRY" number="B" />
        <div className="flex items-center gap-5">
          <FrameCounter index={0} />
          <Clock />
          <OnAir live={false} />
        </div>
      </header>
      <SmpteBars className="h-1.5 mt-3" />

      <section className="px-6 pt-10 pb-10 flex-1 flex items-center">
        <div className="max-w-[640px] mx-auto w-full">
          <p className="chyron mb-3" style={{ color: "var(--vermilion)" }}>
            CONFIDENCE MONITOR · TALENT ENTRY
          </p>
          <h1
            className="display-num"
            style={{ fontSize: "clamp(72px, 16vw, 160px)", lineHeight: 0.85 }}
          >
            JOIN
          </h1>
          <p className="font-editorial italic text-xl mt-2 opacity-80">
            Tap in with the 6-digit PIN your host is showing.
          </p>

          <form onSubmit={submit} className="mt-8 space-y-5">
            <label className="block">
              <span className="chyron">GAME PIN</span>
              <input
                inputMode="numeric"
                pattern="\d*"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000 000"
                aria-label="6 digit PIN"
                className="w-full mt-2 ink-border bg-transparent display-num ticker tabular-nums text-center px-3 py-4"
                style={{
                  fontSize: "clamp(56px, 14vw, 120px)",
                  letterSpacing: "0.12em",
                  background: "var(--bone)",
                  minHeight: 84,
                }}
              />
            </label>

            <label className="block">
              <span className="chyron">YOUR NAME</span>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value.slice(0, 20))}
                placeholder="As it'll appear on the leaderboard"
                aria-label="Nickname"
                className="w-full mt-2 ink-border bg-transparent font-editorial text-2xl px-4 py-4"
                style={{ background: "var(--bone)", minHeight: 64 }}
              />
            </label>

            {error && errorCode === "full" && (
              <div
                className="ink-border halftone px-4 py-4"
                role="alert"
                style={{ background: "var(--ink)", color: "var(--bone)" }}
              >
                <span
                  className="ticker text-[11px] tracking-widest px-2 py-[2px] ink-border"
                  style={{ background: "var(--vermilion)", color: "var(--bone)" }}
                >
                  SIGNAL · AT CAPACITY
                </span>
                <p
                  className="display-num mt-3"
                  style={{ fontSize: "clamp(28px, 5vw, 44px)", lineHeight: 0.95 }}
                >
                  ROOM IS FULL
                </p>
                <p className="ticker text-[11px] tracking-widest mt-2 opacity-80">
                  TRY AGAIN LATER · ASK YOUR HOST FOR A NEW PIN
                </p>
              </div>
            )}

            {error && errorCode !== "full" && (
              <div
                className="ink-border px-4 py-3 ticker text-[12px] tracking-widest"
                role="alert"
                style={{ background: "var(--vermilion)", color: "var(--bone)" }}
              >
                ⚠ {error}
              </div>
            )}

            <button
              type="submit"
              disabled={pending}
              className="w-full ink-border stamp-lg ticker tracking-widest text-[14px] py-5"
              style={{
                background: "var(--vermilion)",
                color: "var(--bone)",
                minHeight: 64,
              }}
            >
              {pending ? "JOINING…" : "▶  GO ON AIR"}
            </button>
          </form>

          <p className="mt-6 ticker text-[11px] tracking-widest opacity-60">
            No account. No app. One tap and you're in.
          </p>
        </div>
      </section>

      <footer className="px-6 pb-6 flex justify-between items-center border-t-2 pt-3" style={{ borderColor: "var(--ink)" }}>
        <Link href="/" className="ticker text-[11px] tracking-widest">← studio master</Link>
        <span className="ticker text-[11px] tracking-widest opacity-60">PLAYER · CONFIDENCE</span>
      </footer>
    </main>
  );
}
