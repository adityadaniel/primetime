'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { Clock, CornerMarks, DateStamp, OnAir, SmpteBars } from '@/components/Broadcast';

export default function ResetTokenClient({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    if (password.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setPending(true);
    const res = await fetch(`/api/auth/reset/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      setPending(false);
      const body = await res.json().catch(() => ({}));
      setError(typeof body?.error === 'string' ? body.error : "Couldn't update password.");
      return;
    }
    const body: { email?: string } = await res.json().catch(() => ({}));
    if (body.email) {
      const signinRes = await signIn('credentials', {
        email: body.email,
        password,
        redirect: false,
      });
      if (signinRes && !signinRes.error) {
        router.push('/host');
        router.refresh();
        return;
      }
    }
    setPending(false);
    router.push('/signin');
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
          <p className="ticker text-[11px] tracking-widest opacity-70 mb-2">▶ INPUT/OUTPUT ◀</p>
          <h1
            className="display-num"
            style={{ fontSize: 'clamp(44px, 10vw, 88px)', lineHeight: 0.9 }}
          >
            SET NEW
            <br />
            PASSWORD
          </h1>

          <form onSubmit={submit} className="mt-6 space-y-3" noValidate>
            <label className="block">
              <span className="chyron">NEW PASSWORD</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-label="New password"
                aria-describedby="reset-password-hint"
                className="w-full mt-1 ink-border bg-transparent font-editorial text-lg px-4 py-3"
                style={{ background: 'var(--bone)', minHeight: 56 }}
              />
              <span
                id="reset-password-hint"
                className="ticker text-[11px] tracking-widest opacity-60 block mt-1"
              >
                USE 8+ CHARACTERS
              </span>
            </label>
            <label className="block">
              <span className="chyron">CONFIRM NEW PASSWORD</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-label="Confirm new password"
                className="w-full mt-1 ink-border bg-transparent font-editorial text-lg px-4 py-3"
                style={{ background: 'var(--bone)', minHeight: 56 }}
              />
            </label>

            <div role="alert" aria-live="polite">
              {error && (
                <div
                  className="ink-border px-4 py-3 ticker text-[12px] tracking-widest"
                  style={{ background: 'var(--vermilion)', color: 'var(--bone)' }}
                >
                  ⚠ {error}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={pending}
              className="w-full ink-border stamp-lg ticker tracking-widest text-[14px] py-4"
              style={{ background: 'var(--ink)', color: 'var(--bone)', minHeight: 56 }}
            >
              {pending ? 'UPDATING…' : '▶  UPDATE PASSWORD'}
            </button>
          </form>

          <p className="mt-6 ticker text-[12px] tracking-widest opacity-80">
            CHANGED YOUR MIND?{' '}
            <Link href="/signin" className="underline">
              SIGN IN
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
