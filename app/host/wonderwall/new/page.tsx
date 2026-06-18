'use client';

// WonderWall session creation form (MID-398). Mirrors app/host/wordcloud/new
// and app/host/q-and-a/new: broadcast-styled host builder that POSTs to
// /api/wonderwall and lands on the control room for the allocated PIN. It only
// collects title + optional description/instructions — participants submit
// LinkedIn URLs later from /play/[pin]/wonderwall, and every link starts
// PENDING until the host approves it.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import AccountMenu from '@/components/AccountMenu';
import { Chyron, Clock, FrameCounter, SmpteBars } from '@/components/Broadcast';
import {
  WONDERWALL_DESCRIPTION_MAX as DESCRIPTION_MAX,
  WONDERWALL_INSTRUCTIONS_MAX as INSTRUCTIONS_MAX,
  WONDERWALL_TITLE_MAX as TITLE_MAX,
} from '@/lib/wonderwall-limits';

const TITLE_PLACEHOLDERS = [
  'Wall of LinkedIn wins',
  'Posts from the room',
  'This week in our network',
  'Share the post that moved you',
  'Voices from the conference floor',
];

export default function WonderWallNew() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % TITLE_PLACEHOLDERS.length);
    }, 3500);
    return () => clearInterval(id);
  }, []);

  const placeholder = useMemo(() => TITLE_PLACEHOLDERS[placeholderIdx], [placeholderIdx]);
  const titleCharsLeft = TITLE_MAX - title.length;
  const trimmedTitle = title.trim();
  const valid = trimmedTitle.length >= 1 && trimmedTitle.length <= TITLE_MAX;

  async function start() {
    if (!valid || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/wonderwall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmedTitle,
          description: description.trim() || null,
          instructions: instructions.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as { pin: string; sessionId: string };
      router.push(`/host/wonderwall/${data.pin}/control`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network_error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative min-h-screen pb-24">
      <header className="px-8 pt-6 flex items-center justify-between">
        <Chyron label="DIRECTOR · NEW WONDERWALL" number="WW" />
        <div className="flex items-center gap-6">
          <FrameCounter index={0} />
          <Clock />
          <AccountMenu />
        </div>
      </header>
      <SmpteBars className="h-2 mt-4" />

      <section className="px-6 sm:px-8 pt-10 max-w-[920px] mx-auto">
        <p className="chyron mb-3" style={{ color: 'var(--vermilion)' }}>
          ACTIVITY · WONDERWALL · LINKEDIN POSTS
        </p>
        <h1 className="display-num leading-[0.9]" style={{ fontSize: 'clamp(48px, 7vw, 96px)' }}>
          THE ROOM
          <br />
          HAS LINKS.
        </h1>
        <p className="font-editorial italic mt-4 max-w-[680px] opacity-80 text-lg">
          Collect LinkedIn posts from the audience, approve the good ones, and let them rain down
          the projector wall. Links wait for your review before they go on air.
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
              <label htmlFor="ww-title" className="chyron">
                WALL TITLE · ≤ {TITLE_MAX} CHARS
              </label>
              <span
                className="ticker text-[11px] tracking-widest"
                style={{
                  color: titleCharsLeft < 20 ? 'var(--vermilion)' : 'var(--ink)',
                  opacity: titleCharsLeft < 20 ? 1 : 0.6,
                }}
              >
                {title.length}/{TITLE_MAX}
              </span>
            </div>
            <input
              id="ww-title"
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={placeholder}
              className="mt-2 w-full font-editorial text-2xl md:text-3xl leading-snug bg-transparent outline-none border-b-2 pb-2"
              style={{ borderColor: 'var(--ink)' }}
            />
          </div>

          <div className="mt-8">
            <div className="flex items-center justify-between">
              <label htmlFor="ww-description" className="chyron">
                DESCRIPTION · OPTIONAL · ≤ {DESCRIPTION_MAX} CHARS
              </label>
              <span className="ticker text-[11px] tracking-widest opacity-60">
                {description.length}/{DESCRIPTION_MAX}
              </span>
            </div>
            <textarea
              id="ww-description"
              value={description}
              maxLength={DESCRIPTION_MAX}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Posts the audience wants up on the big screen"
              className="mt-2 w-full font-editorial text-lg leading-snug bg-transparent outline-none border-b-2 pb-2"
              style={{ borderColor: 'var(--ink)' }}
            />
          </div>

          <div className="mt-8">
            <div className="flex items-center justify-between">
              <label htmlFor="ww-instructions" className="chyron">
                PARTICIPANT INSTRUCTIONS · OPTIONAL · ≤ {INSTRUCTIONS_MAX} CHARS
              </label>
              <span className="ticker text-[11px] tracking-widest opacity-60">
                {instructions.length}/{INSTRUCTIONS_MAX}
              </span>
            </div>
            <textarea
              id="ww-instructions"
              value={instructions}
              maxLength={INSTRUCTIONS_MAX}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
              placeholder="Paste a public LinkedIn post URL you want to share with the room"
              className="mt-2 w-full font-editorial text-lg leading-snug bg-transparent outline-none border-b-2 pb-2"
              style={{ borderColor: 'var(--ink)' }}
            />
            <p className="font-editorial italic text-[13px] mt-2 opacity-70">
              Shown to participants when they submit. Tell them what kind of LinkedIn posts you
              want.
            </p>
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
