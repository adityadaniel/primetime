"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock, CornerMarks, DateStamp, OnAir, SmpteBars } from "@/components/Broadcast";

export default function ResetPage() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    if (!email.trim()) {
      setError("Enter your email.");
      return;
    }
    setPending(true);
    const res = await fetch("/api/auth/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    });
    setPending(false);
    if (!res.ok) {
      setError("Couldn't send reset link. Try again.");
      return;
    }
    const body: { devUrl?: string } = await res.json().catch(() => ({}));
    setDevUrl(body.devUrl ?? null);
    setSubmitted(true);
  }

  return (
    <main className="relative flex flex-col min-h-[100dvh] overflow-hidden">
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

      <section className="px-6 pt-8 pb-8 flex-1">
        <div className="max-w-[420px] mx-auto w-full">
          <p className="ticker text-[11px] tracking-widest opacity-70 mb-2">
            ▶ BROADCAST  ◀
          </p>
          <h1
            className="display-num"
            style={{ fontSize: "clamp(48px, 11vw, 100px)", lineHeight: 0.9 }}
          >
            RESET
            <br />
            PASSWORD
          </h1>

          {!submitted ? (
            <>
              <p className="font-editorial italic text-base mt-2 opacity-80">
                Enter your email and we&apos;ll send you a reset link.
              </p>

              <form onSubmit={submit} className="mt-6 space-y-3" noValidate>
                <label className="block">
                  <span className="chyron">EMAIL</span>
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-label="Email"
                    className="w-full mt-1 ink-border bg-transparent font-editorial text-lg px-4 py-3"
                    style={{ background: "var(--bone)", minHeight: 56 }}
                  />
                </label>

                <div role="alert" aria-live="polite">
                  {error && (
                    <div
                      className="ink-border px-4 py-3 ticker text-[12px] tracking-widest"
                      style={{ background: "var(--vermilion)", color: "var(--bone)" }}
                    >
                      ⚠ {error}
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={pending}
                  className="w-full ink-border stamp-lg ticker tracking-widest text-[14px] py-4"
                  style={{
                    background: "var(--ink)",
                    color: "var(--bone)",
                    minHeight: 56,
                  }}
                >
                  {pending ? "SENDING…" : "▶  SEND RESET LINK"}
                </button>
              </form>
            </>
          ) : (
            <div className="mt-6 space-y-4" role="status" aria-live="polite">
              <div
                className="ink-border px-4 py-4 halftone"
                style={{ background: "var(--bone)" }}
              >
                <p className="chyron mb-2">SIGNAL · DISPATCHED</p>
                <p className="font-editorial text-lg">
                  If an account exists, we just sent a reset link.
                  <br />
                  Check your inbox.
                </p>
              </div>
              {devUrl && (
                <div
                  className="ink-border px-4 py-4"
                  style={{ background: "var(--marigold)", color: "var(--ink)" }}
                >
                  <p className="ticker text-[11px] tracking-widest mb-2">
                    DEV ONLY · OPEN THIS LINK
                  </p>
                  <a
                    href={devUrl}
                    className="ticker text-[12px] tracking-tight underline break-all"
                  >
                    {devUrl}
                  </a>
                </div>
              )}
            </div>
          )}

          <p className="mt-6 ticker text-[12px] tracking-widest opacity-80">
            REMEMBERED IT?{" "}
            <Link href="/signin" className="underline">
              SIGN IN
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
