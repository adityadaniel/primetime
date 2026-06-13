'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import AccountMenu from '@/components/AccountMenu';
import { Chyron, Clock, FrameCounter, SmpteBars } from '@/components/Broadcast';

const PROMPT_MAX = 140;

const PLACEHOLDERS = [
  'One word for how you’re feeling right now',
  'Best book you read this year',
  'Name a tool you can’t live without',
  'One word that captures today’s topic',
  'A concept that finally clicked for you',
];

export default function WordCloudNew() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [wordsPerPlayer, setWordsPerPlayer] = useState(3);
  const [profanityFilter, setProfanityFilter] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length);
    }, 3500);
    return () => clearInterval(id);
  }, []);

  const placeholder = useMemo(() => PLACEHOLDERS[placeholderIdx], [placeholderIdx]);
  const charsLeft = PROMPT_MAX - prompt.length;
  const trimmed = prompt.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= PROMPT_MAX;

  async function start() {
    if (!valid || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/wordcloud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: trimmed,
          wordsPerPlayer,
          profanityFilter,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as { pin: string; sessionId: string };
      const params = new URLSearchParams({
        sid: data.sessionId,
        prompt: trimmed,
        wpp: String(wordsPerPlayer),
        pf: profanityFilter ? '1' : '0',
      });
      router.push(`/host/wordcloud/${data.pin}/control?${params.toString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network_error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative min-h-screen pb-24">
      <header className="px-8 pt-6 flex items-center justify-between">
        <Chyron label="DIRECTOR · NEW WORD CLOUD" number="WC" />
        <div className="flex items-center gap-6">
          <FrameCounter index={0} />
          <Clock />
          <AccountMenu />
        </div>
      </header>
      <SmpteBars className="h-2 mt-4" />

      <section className="px-6 sm:px-8 pt-10 max-w-[920px] mx-auto">
        <p className="chyron mb-3" style={{ color: 'var(--vermilion)' }}>
          ACTIVITY · WORD CLOUD · LIVE PROMPT
        </p>
        <h1 className="display-num leading-[0.9]" style={{ fontSize: 'clamp(48px, 7vw, 96px)' }}>
          ONE PROMPT.
          <br />
          MANY VOICES.
        </h1>
        <p className="font-editorial italic mt-4 max-w-[680px] opacity-80 text-lg">
          Ask the room a question, watch their answers pile up by frequency. Tap start, then put the
          projector up.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
          className="mt-10 ink-border p-6 sm:p-8"
          style={{ background: 'var(--bone)' }}
        >
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="wc-prompt" className="chyron">
                PROMPT · ≤ {PROMPT_MAX} CHARS
              </label>
              <span
                className="ticker text-[11px] tracking-widest"
                style={{
                  color: charsLeft < 20 ? 'var(--vermilion)' : 'var(--ink)',
                  opacity: charsLeft < 20 ? 1 : 0.6,
                }}
              >
                {prompt.length}/{PROMPT_MAX}
              </span>
            </div>
            <textarea
              id="wc-prompt"
              value={prompt}
              maxLength={PROMPT_MAX}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder={placeholder}
              className="mt-2 w-full font-editorial text-2xl md:text-3xl leading-snug bg-transparent outline-none border-b-2 pb-2"
              style={{ borderColor: 'var(--ink)' }}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-10">
            <div>
              <div className="flex items-center justify-between">
                <span className="chyron">WORDS PER PLAYER</span>
                <span className="display-num text-4xl">
                  {String(wordsPerPlayer).padStart(2, '0')}
                </span>
              </div>
              <input
                aria-label="Words per player"
                type="range"
                min={1}
                max={5}
                step={1}
                value={wordsPerPlayer}
                onChange={(e) => setWordsPerPlayer(Number(e.target.value))}
                className="mt-3 w-full accent-[var(--vermilion)]"
                style={{ minHeight: 56 }}
              />
              <div
                className="mt-1 flex justify-between ticker text-[10px] tracking-widest opacity-60"
                aria-hidden
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <span key={n}>{n}</span>
                ))}
              </div>
            </div>

            <div className="flex flex-col">
              <span className="chyron">PROFANITY FILTER</span>
              <button
                type="button"
                onClick={() => setProfanityFilter((v) => !v)}
                aria-pressed={profanityFilter}
                className="mt-2 w-full ink-border ticker text-[12px] tracking-widest flex items-center justify-between px-4"
                style={{
                  minHeight: 56,
                  background: profanityFilter ? 'var(--ivy)' : 'var(--bone)',
                  color: profanityFilter ? 'var(--bone)' : 'var(--ink)',
                }}
              >
                <span>{profanityFilter ? 'ON · BLOCKING' : 'OFF · OPEN MIC'}</span>
                <span aria-hidden>{profanityFilter ? '●' : '○'}</span>
              </button>
              <p className="font-editorial italic text-[13px] mt-2 opacity-70">
                {profanityFilter
                  ? 'Words flagged by the filter are rejected at submit.'
                  : 'No filter. You can still trash any word from the control panel.'}
              </p>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-8 ink-border px-4 py-3 ticker text-[11px] tracking-widest"
              style={{ background: 'var(--vermilion)', color: 'var(--bone)' }}
            >
              ERROR · {error}
            </div>
          )}

          <div className="mt-10 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
            <Link href="/host" className="ticker text-[11px] tracking-widest opacity-70">
              ← back to studio master
            </Link>
            <button
              type="submit"
              disabled={!valid || submitting}
              className="ink-border stamp px-6 ticker tracking-widest text-[13px]"
              style={{
                minHeight: 56,
                background: valid && !submitting ? 'var(--vermilion)' : 'var(--ash)',
                color: 'var(--bone)',
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? 'ALLOCATING PIN…' : '▶  START ACTIVITY'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
