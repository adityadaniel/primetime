'use client';

import { useEffect, useState } from 'react';

export function FrameCounter({ index, dark = false }: { index: number; dark?: boolean }) {
  const padded = String(Math.max(0, index)).padStart(3, '0');
  return (
    <div
      className="ticker flex items-center gap-2"
      style={{ color: dark ? 'var(--bone)' : 'var(--ink)' }}
    >
      <span className="opacity-60">FRAME</span>
      <span className="tracking-widest">{padded}</span>
    </div>
  );
}

export function OnAir({ live = true, dark = false }: { live?: boolean; dark?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {live ? (
        <span className="live-dot" />
      ) : (
        <span
          className="block w-[9px] h-[9px] rounded-full"
          style={{ background: dark ? 'var(--ash)' : 'var(--ash)' }}
        />
      )}
      <span
        className="ticker tracking-widest text-[11px]"
        style={{ color: dark ? 'var(--bone)' : 'var(--ink)' }}
      >
        {live ? 'ON AIR' : 'STANDBY'}
      </span>
    </div>
  );
}

export function CornerMarks({ dark = false, fixed = false }: { dark?: boolean; fixed?: boolean }) {
  const color = dark ? 'var(--bone)' : 'var(--ink)';
  const base = fixed ? 'fixed' : 'absolute';
  return (
    <>
      <span
        className={`${base} top-3 left-3 w-3 h-3 border-t-2 border-l-2`}
        style={{ borderColor: color }}
        aria-hidden
      />
      <span
        className={`${base} top-3 right-3 w-3 h-3 border-t-2 border-r-2`}
        style={{ borderColor: color }}
        aria-hidden
      />
      <span
        className={`${base} bottom-3 left-3 w-3 h-3 border-b-2 border-l-2`}
        style={{ borderColor: color }}
        aria-hidden
      />
      <span
        className={`${base} bottom-3 right-3 w-3 h-3 border-b-2 border-r-2`}
        style={{ borderColor: color }}
        aria-hidden
      />
    </>
  );
}

export function Clock({ dark = false }: { dark?: boolean }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return (
    <span
      className="ticker tracking-widest text-[11px]"
      style={{ color: dark ? 'var(--bone)' : 'var(--ink)' }}
    >
      {hh}:{mm}:{ss}
    </span>
  );
}

export function DateStamp({ dark = false }: { dark?: boolean }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return (
    <span
      className="ticker tracking-widest text-[11px]"
      style={{ color: dark ? 'var(--bone)' : 'var(--ink)' }}
    >
      {yyyy}.{mm}.{dd}
    </span>
  );
}

export function SmpteBars({ className = '' }: { className?: string }) {
  return <div className={`smpte-bars ${className}`} aria-hidden />;
}

export function Chyron({
  label,
  number,
  dark = false,
}: {
  label: string;
  number?: string;
  dark?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      {number && (
        <span
          className="ticker tracking-widest text-[11px] px-2 py-[2px]"
          style={{
            background: 'var(--vermilion)',
            color: 'var(--bone)',
          }}
        >
          {number}
        </span>
      )}
      <span
        className="ticker tracking-widest text-[11px]"
        style={{ color: dark ? 'var(--bone)' : 'var(--ink)' }}
      >
        {label}
      </span>
    </div>
  );
}
