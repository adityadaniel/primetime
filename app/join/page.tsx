"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSocket } from "@/lib/socket";
import { Clock, CornerMarks, DateStamp, OnAir, SmpteBars } from "@/components/Broadcast";

export default function JoinPage() {
  const router = useRouter();
  const socket = useSocket();
  const [pin, setPin] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!socket) return;
    if (inFlight.current) return;
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
    inFlight.current = true;
    setPending(true);
    socket.emit(
      "player:join",
      pin,
      nickname.trim(),
      (res: { ok: boolean; error?: string; code?: string; playerId?: string }) => {
        inFlight.current = false;
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
    <main className="relative flex flex-col h-[100dvh] overflow-hidden">
      <CornerMarks fixed />
      <header className="px-6 pt-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <DateStamp />
          <span className="ticker text-[11px] opacity-40">·</span>
          <Clock />
        </div>
        <OnAir live={false} />
      </header>
      <SmpteBars className="h-1.5 mt-2" />

      <section className="px-6 pt-5 pb-4 flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[640px] mx-auto w-full">
          <h1
            className="display-num"
            style={{ fontSize: "clamp(56px, 13vw, 140px)", lineHeight: 0.9 }}
          >
            JOIN
          </h1>
          <p className="font-editorial italic text-base mt-1 opacity-80">
            Tap in with the 6-digit PIN your host is showing.
          </p>

          <form onSubmit={submit} className="mt-5 space-y-3">
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
                className="w-full mt-1 ink-border bg-transparent display-num ticker tabular-nums text-center px-3 py-3"
                style={{
                  fontSize: "clamp(44px, 11vw, 96px)",
                  letterSpacing: "0.12em",
                  background: "var(--bone)",
                  minHeight: 70,
                }}
              />
            </label>

            <label className="block">
              <span className="chyron">YOUR NAME</span>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value.slice(0, 20))}
                placeholder="Your name"
                aria-label="Nickname"
                className="w-full mt-1 ink-border bg-transparent font-editorial text-xl px-4 py-3"
                style={{ background: "var(--bone)", minHeight: 56 }}
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
              className="w-full ink-border stamp-lg ticker tracking-widest text-[14px] py-4"
              style={{
                background: "var(--vermilion)",
                color: "var(--bone)",
                minHeight: 56,
              }}
            >
              {pending ? "JOINING…" : "▶  GO ON AIR"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
