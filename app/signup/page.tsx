'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { Clock, CornerMarks, DateStamp, OnAir, SmpteBars } from '@/components/Broadcast';

type ErrorState =
  | { kind: 'none' }
  | { kind: 'duplicate' }
  | { kind: 'invite' }
  | { kind: 'message'; text: string };

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<ErrorState>({ kind: 'none' });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setErr({ kind: 'none' });

    if (!email.trim()) {
      setErr({ kind: 'message', text: 'Enter your email.' });
      return;
    }
    if (password.length < 8) {
      setErr({ kind: 'message', text: 'Use at least 8 characters.' });
      return;
    }
    if (password !== confirm) {
      setErr({ kind: 'message', text: "Passwords don't match." });
      return;
    }

    setPending(true);
    const normalizedEmail = email.trim().toLowerCase();
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: normalizedEmail,
        password,
        name: name.trim() || undefined,
        inviteCode: inviteCode.trim() || undefined,
      }),
    });

    if (res.status === 409) {
      setPending(false);
      setErr({ kind: 'duplicate' });
      return;
    }
    if (res.status === 403) {
      setPending(false);
      setErr({ kind: 'invite' });
      return;
    }
    if (!res.ok) {
      setPending(false);
      const body = await res.json().catch(() => ({}));
      setErr({
        kind: 'message',
        text: typeof body?.error === 'string' ? body.error : "Couldn't create that account.",
      });
      return;
    }

    const signin = await signIn('credentials', {
      email: normalizedEmail,
      password,
      redirect: false,
    });
    setPending(false);
    if (!signin || signin.error) {
      router.push('/signin');
      return;
    }
    router.push('/host');
    router.refresh();
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
          <p className="ticker text-[11px] tracking-widest opacity-70 mb-2">▶ BROADCAST ◀</p>
          <h1
            className="display-num"
            style={{ fontSize: 'clamp(48px, 11vw, 96px)', lineHeight: 0.9 }}
          >
            CREATE
            <br />
            ACCOUNT
          </h1>
          <p className="font-editorial italic text-base mt-2 opacity-80">
            Take the producer&apos;s chair.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-3" noValidate>
            <label className="block">
              <span className="chyron">DISPLAY NAME (OPTIONAL)</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 80))}
                aria-label="Display name (optional)"
                autoComplete="name"
                className="w-full mt-1 ink-border bg-transparent font-editorial text-lg px-4 py-3"
                style={{ background: 'var(--bone)', minHeight: 56 }}
              />
            </label>
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
                style={{ background: 'var(--bone)', minHeight: 56 }}
              />
            </label>
            <label className="block">
              <span className="chyron">PASSWORD</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-label="Password"
                aria-describedby="password-hint"
                className="w-full mt-1 ink-border bg-transparent font-editorial text-lg px-4 py-3"
                style={{ background: 'var(--bone)', minHeight: 56 }}
              />
              <span
                id="password-hint"
                className="ticker text-[11px] tracking-widest opacity-60 block mt-1"
              >
                USE 8+ CHARACTERS
              </span>
            </label>
            <label className="block">
              <span className="chyron">CONFIRM PASSWORD</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-label="Confirm password"
                className="w-full mt-1 ink-border bg-transparent font-editorial text-lg px-4 py-3"
                style={{ background: 'var(--bone)', minHeight: 56 }}
              />
            </label>
            <label className="block">
              <span className="chyron">INVITE CODE</span>
              <input
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.slice(0, 80))}
                aria-label="Invite code"
                aria-describedby="invite-hint"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="w-full mt-1 ink-border bg-transparent font-editorial text-lg px-4 py-3"
                style={{ background: 'var(--bone)', minHeight: 56 }}
              />
              <span
                id="invite-hint"
                className="ticker text-[11px] tracking-widest opacity-60 block mt-1"
              >
                BETA ACCESS CODE — REQUIRED
              </span>
            </label>

            <div role="alert" aria-live="polite">
              {err.kind === 'duplicate' && (
                <div
                  className="ink-border px-4 py-3 ticker text-[12px] tracking-widest"
                  style={{ background: 'var(--vermilion)', color: 'var(--bone)' }}
                >
                  AN ACCOUNT EXISTS WITH THAT EMAIL.{' '}
                  <Link href="/signin" className="underline">
                    SIGN IN
                  </Link>
                </div>
              )}
              {err.kind === 'invite' && (
                <div
                  className="ink-border px-4 py-3 ticker text-[12px] tracking-widest"
                  style={{ background: 'var(--vermilion)', color: 'var(--bone)' }}
                >
                  ⚠ INVITE CODE NOT RECOGNIZED.
                </div>
              )}
              {err.kind === 'message' && (
                <div
                  className="ink-border px-4 py-3 ticker text-[12px] tracking-widest"
                  style={{ background: 'var(--vermilion)', color: 'var(--bone)' }}
                >
                  ⚠ {err.text}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={pending}
              className="w-full ink-border stamp-lg ticker tracking-widest text-[14px] py-4"
              style={{
                background: 'var(--ink)',
                color: 'var(--bone)',
                minHeight: 56,
              }}
            >
              {pending ? 'CREATING…' : '▶  CREATE ACCOUNT'}
            </button>
          </form>

          <p className="mt-6 ticker text-[12px] tracking-widest opacity-80">
            ALREADY HAVE AN ACCOUNT?{' '}
            <Link href="/signin" className="underline">
              SIGN IN
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
