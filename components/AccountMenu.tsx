'use client';

import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';

function initialsFor(email?: string | null, name?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase()).join('') || '·';
  }
  if (email) return email[0]?.toUpperCase() ?? '·';
  return '·';
}

export default function AccountMenu() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function escHandler(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escHandler);
    };
  }, [open]);

  if (status === 'loading') {
    return <span className="ticker text-[11px] tracking-widest opacity-50">…</span>;
  }

  if (!session?.user) {
    return (
      <Link
        href="/signin"
        className="ink-border ticker tracking-widest text-[11px] px-3 py-2"
        style={{ background: 'var(--bone)', color: 'var(--ink)' }}
      >
        SIGN IN
      </Link>
    );
  }

  const email = session.user.email ?? '';
  const name = session.user.name ?? '';
  const tier = (session.user as { tier?: string }).tier ?? 'free';
  const tierLabel = tier === 'pro' ? 'PRO' : 'FREE';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="ink-border display-num text-base flex items-center justify-center"
        style={{
          width: 40,
          height: 40,
          background: 'var(--ink)',
          color: 'var(--bone)',
        }}
      >
        {initialsFor(email, name)}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 ink-border stamp z-50"
          style={{ background: 'var(--bone)', minWidth: 240 }}
        >
          <div className="px-4 py-3 border-b-2" style={{ borderColor: 'var(--ink)' }}>
            <p className="ticker text-[11px] tracking-widest opacity-60">SIGNED IN AS</p>
            <p className="font-editorial text-base truncate" title={email}>
              {email || '—'}
            </p>
            <span
              className="inline-block mt-2 ticker text-[10px] tracking-widest px-2 py-[2px] ink-border"
              style={{
                background: tier === 'pro' ? 'var(--marigold)' : 'var(--bone)',
                color: 'var(--ink)',
              }}
            >
              TIER · {tierLabel}
            </span>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => signOut({ callbackUrl: '/' })}
            className="w-full text-left px-4 py-3 ticker tracking-widest text-[12px]"
            style={{ background: 'var(--bone)', color: 'var(--ink)' }}
          >
            ▶ SIGN OUT
          </button>
        </div>
      )}
    </div>
  );
}
