'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { Clock, CornerMarks, DateStamp, OnAir, SmpteBars } from '@/components/Broadcast';
import { config } from '@/lib/config';

export default function SignInClient({ enableApple }: { enableApple: boolean }) {
  const router = useRouter();
  const search = useSearchParams();
  const callbackUrl = search.get('callbackUrl') || '/host';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [oauthPending, setOauthPending] = useState<'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setPending(true);
    const res = await signIn('credentials', {
      email: email.trim().toLowerCase(),
      password,
      redirect: false,
    });
    setPending(false);
    if (!res || res.error) {
      setError("We couldn't sign you in. Check your email and password.");
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  function oauth(provider: 'apple') {
    setOauthPending(provider);
    signIn(provider, { callbackUrl });
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
            style={{ fontSize: 'clamp(56px, 12vw, 120px)', lineHeight: 0.9 }}
          >
            SIGN IN
          </h1>
          <p className="font-editorial italic text-base mt-1 opacity-80">Step into the studio.</p>

          {enableApple && (
            <>
              <div className="mt-6 space-y-3">
                <button
                  type="button"
                  onClick={() => oauth('apple')}
                  disabled={!!oauthPending}
                  className="w-full ink-border ticker tracking-widest text-[12px] py-4"
                  style={{ background: 'var(--ink)', color: 'var(--bone)', minHeight: 56 }}
                >
                  {oauthPending === 'apple' ? 'REDIRECTING…' : 'CONTINUE WITH APPLE'}
                </button>
              </div>

              <div className="flex items-center gap-3 my-6">
                <div className="flex-1 border-t-2" style={{ borderColor: 'var(--ink)' }} />
                <span className="ticker text-[11px] tracking-widest opacity-70">OR</span>
                <div className="flex-1 border-t-2" style={{ borderColor: 'var(--ink)' }} />
              </div>
            </>
          )}

          <form
            onSubmit={submit}
            className={enableApple ? 'space-y-3' : 'mt-6 space-y-3'}
            noValidate
          >
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
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-label="Password"
                className="w-full mt-1 ink-border bg-transparent font-editorial text-lg px-4 py-3"
                style={{ background: 'var(--bone)', minHeight: 56 }}
              />
            </label>

            {config.emailEnabled ? (
              <div className="flex justify-end">
                <Link href="/reset" className="ticker text-[11px] tracking-widest underline">
                  FORGOT PASSWORD?
                </Link>
              </div>
            ) : null}

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
              style={{
                background: 'var(--ink)',
                color: 'var(--bone)',
                minHeight: 56,
              }}
            >
              {pending ? 'SIGNING IN…' : '▶  SIGN IN'}
            </button>
          </form>

          <p className="mt-6 ticker text-[12px] tracking-widest opacity-80">
            DON&apos;T HAVE AN ACCOUNT?{' '}
            <Link href="/signup" className="underline">
              SIGN UP
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
