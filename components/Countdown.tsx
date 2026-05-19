"use client";

import { useEffect, useState } from "react";

export function useCountdown(endsAt: number | undefined): {
  msLeft: number;
  fraction: number;
} {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 80);
    return () => clearInterval(id);
  }, [endsAt]);
  if (!endsAt) return { msLeft: 0, fraction: 0 };
  const msLeft = Math.max(0, endsAt - now);
  return { msLeft, fraction: msLeft / Math.max(1, endsAt - (endsAt - 1000)) };
}

export function Countdown({
  endsAt,
  startedAt,
  size = 96,
  dark = false,
}: {
  endsAt?: number;
  startedAt?: number;
  size?: number;
  dark?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [endsAt]);
  if (!endsAt || !startedAt) return null;
  const total = Math.max(1, endsAt - startedAt);
  const left = Math.max(0, endsAt - now);
  const fraction = left / total;
  const seconds = Math.ceil(left / 1000);
  const stroke = dark ? "var(--bone)" : "var(--ink)";
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const dash = c * (1 - fraction);
  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: "rotate(-90deg)" }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={dark ? "rgba(242,235,220,0.18)" : "rgba(15,15,15,0.18)"}
          strokeWidth={6}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth={6}
          strokeDasharray={c}
          strokeDashoffset={dash}
          strokeLinecap="butt"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span
          className="display-num ticker"
          style={{ color: stroke, fontSize: size * 0.42, fontWeight: 700 }}
        >
          {seconds}
        </span>
      </div>
    </div>
  );
}
