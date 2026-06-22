'use client';

// Q&A session creation form (MID-333). Mirrors app/host/wordcloud/new/page.tsx:
// broadcast-styled host builder that POSTs to /api/q-and-a and lands on the
// control room for the allocated PIN.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import AccountMenu from '@/components/AccountMenu';
import { Chyron, Clock, FrameCounter, SmpteBars } from '@/components/Broadcast';
import { QA_LABEL_NAME_LIMIT, validateLabelName } from '@/lib/qa-input';

const TITLE_MAX = 100;
const DESCRIPTION_MAX = 200;
const LABELS_MAX = 20;

const TITLE_PLACEHOLDERS = [
  'Ask us anything',
  'Questions for the panel',
  'End-of-workshop Q&A',
  'Town hall — open floor',
  'What should we cover next?',
];

const CHAR_LIMITS = [140, 280, 500] as const;

export default function QAndANew() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [privacyMode, setPrivacyMode] = useState<'ANONYMOUS_BY_DEFAULT' | 'NAME_REQUIRED'>(
    'ANONYMOUS_BY_DEFAULT',
  );
  const [moderationEnabled, setModerationEnabled] = useState(false);
  const [participantRepliesEnabled, setParticipantRepliesEnabled] = useState(false);
  const [downvotesEnabled, setDownvotesEnabled] = useState(false);
  // Default OFF: rooms are created CLOSED so a host can prepare ahead of time and
  // open questions from the control room when the event starts.
  const [openImmediately, setOpenImmediately] = useState(false);
  const [questionCharLimit, setQuestionCharLimit] = useState<(typeof CHAR_LIMITS)[number]>(280);
  // Optional session-scoped labels (MID-340) with a per-label toggle deciding
  // whether participants may pick it at submission.
  const [labels, setLabels] = useState<{ name: string; participantSelectable: boolean }[]>([]);
  const [labelDraft, setLabelDraft] = useState('');
  const [labelError, setLabelError] = useState<string | null>(null);
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

  function addLabel() {
    setLabelError(null);
    const validated = validateLabelName(labelDraft);
    if (!validated.ok) {
      setLabelError(
        validated.reason === 'label_too_long'
          ? `Keep labels under ${QA_LABEL_NAME_LIMIT} characters.`
          : 'Type a label name first.',
      );
      return;
    }
    if (labels.some((l) => l.name === validated.value)) {
      setLabelError('That label is already on the list.');
      return;
    }
    if (labels.length >= LABELS_MAX) {
      setLabelError(`Up to ${LABELS_MAX} labels per session.`);
      return;
    }
    setLabels((prev) => [...prev, { name: validated.value, participantSelectable: false }]);
    setLabelDraft('');
  }

  async function start() {
    if (!valid || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/q-and-a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmedTitle,
          description: description.trim() || null,
          privacyMode,
          moderationEnabled,
          participantRepliesEnabled,
          downvotesEnabled,
          questionCharLimit,
          labels,
          openImmediately,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as { pin: string; sessionId: string };
      router.push(`/host/q-and-a/${data.pin}/control`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network_error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative min-h-screen pb-24">
      <header className="px-8 pt-6 flex items-center justify-between">
        <Chyron label="DIRECTOR · NEW AUDIENCE Q&A" number="QA" />
        <div className="flex items-center gap-6">
          <FrameCounter index={0} />
          <Clock />
          <AccountMenu />
        </div>
      </header>
      <SmpteBars className="h-2 mt-4" />

      <section className="px-6 sm:px-8 pt-10 max-w-[920px] mx-auto">
        <p className="chyron mb-3" style={{ color: 'var(--vermilion)' }}>
          ACTIVITY · AUDIENCE Q&A · OPEN FLOOR
        </p>
        <h1 className="display-num leading-[0.9]" style={{ fontSize: 'clamp(48px, 7vw, 96px)' }}>
          THE ROOM
          <br />
          HAS QUESTIONS.
        </h1>
        <p className="font-editorial italic mt-4 max-w-[680px] opacity-80 text-lg">
          Collect questions from the audience, let upvotes surface the best ones, answer on air.
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
              <label htmlFor="qa-title" className="chyron">
                SESSION TITLE · ≤ {TITLE_MAX} CHARS
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
              id="qa-title"
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
              <label htmlFor="qa-description" className="chyron">
                DESCRIPTION · OPTIONAL · ≤ {DESCRIPTION_MAX} CHARS
              </label>
              <span className="ticker text-[11px] tracking-widest opacity-60">
                {description.length}/{DESCRIPTION_MAX}
              </span>
            </div>
            <textarea
              id="qa-description"
              value={description}
              maxLength={DESCRIPTION_MAX}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Questions for the end of the workshop"
              className="mt-2 w-full font-editorial text-lg leading-snug bg-transparent outline-none border-b-2 pb-2"
              style={{ borderColor: 'var(--ink)' }}
            />
          </div>

          <div className="mt-10 space-y-6">
            <ToggleControl
              label="NAME REQUIRED"
              on={privacyMode === 'NAME_REQUIRED'}
              onToggle={() =>
                setPrivacyMode((prev) =>
                  prev === 'NAME_REQUIRED' ? 'ANONYMOUS_BY_DEFAULT' : 'NAME_REQUIRED',
                )
              }
              onText="ON · NAMES ON AIR"
              offText="OFF · OPTIONAL"
              hint={
                privacyMode === 'NAME_REQUIRED'
                  ? 'Every question carries the sender’s name.'
                  : 'Senders can ask anonymously or add their name.'
              }
            />
            <ToggleControl
              label="MODERATION"
              on={moderationEnabled}
              onToggle={() => setModerationEnabled((v) => !v)}
              onText="ON · REVIEW FIRST"
              offText="OFF · STRAIGHT TO AIR"
              hint={
                moderationEnabled
                  ? 'Every question waits for your approval before going public.'
                  : 'Questions appear live the moment they are sent.'
              }
            />
            <ToggleControl
              label="AUDIENCE REPLIES"
              on={participantRepliesEnabled}
              onToggle={() => setParticipantRepliesEnabled((v) => !v)}
              onText="ON · THREADS"
              offText="OFF · QUESTIONS ONLY"
              hint={
                participantRepliesEnabled
                  ? 'Participants can reply in a thread under live questions.'
                  : 'Only you can reply to questions.'
              }
            />
            <ToggleControl
              label="DOWNVOTES"
              on={downvotesEnabled}
              onToggle={() => setDownvotesEnabled((v) => !v)}
              onText="ON · UP MINUS DOWN"
              offText="OFF · UPVOTES ONLY"
              hint={
                downvotesEnabled ? 'Score = upvotes minus downvotes.' : 'Ranking by upvotes alone.'
              }
            />

            <ToggleControl
              label="QUESTIONS"
              on={openImmediately}
              onToggle={() => setOpenImmediately((v) => !v)}
              onText="OPEN ON CREATE"
              offText="CLOSED · PREPARE AHEAD"
              hint={
                openImmediately
                  ? 'Questions open the moment the room is created.'
                  : 'Room starts closed — open questions from the control room when your event starts.'
              }
            />
          </div>

          <fieldset className="mt-10">
            <legend className="sr-only">Question character limit</legend>
            <div className="flex items-start justify-between gap-6 flex-wrap">
              <div className="max-w-[520px]">
                <span className="chyron block">QUESTION CHARACTER LIMIT</span>
                <p className="font-editorial italic text-[13px] mt-1 opacity-70">
                  Maximum length of a single question.
                </p>
              </div>
              <div className="flex flex-wrap">
                {CHAR_LIMITS.map((limit) => {
                  const active = questionCharLimit === limit;
                  return (
                    <button
                      key={limit}
                      type="button"
                      onClick={() => setQuestionCharLimit(limit)}
                      aria-pressed={active}
                      className="ink-border ticker text-[11px] tracking-widest px-4"
                      style={{
                        minHeight: 44,
                        background: active ? 'var(--vermilion)' : 'var(--bone)',
                        color: active ? 'var(--bone)' : 'var(--ink)',
                      }}
                    >
                      {limit}
                    </button>
                  );
                })}
              </div>
            </div>
          </fieldset>

          <fieldset className="mt-10">
            <legend className="chyron">LABELS · OPTIONAL</legend>
            <p className="font-editorial italic text-[13px] mt-1 opacity-70">
              Tag questions by topic or segment. Flip a label to AUDIENCE to let senders pick it
              when they ask. You can add more mid-broadcast.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                value={labelDraft}
                maxLength={QA_LABEL_NAME_LIMIT}
                onChange={(e) => setLabelDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addLabel();
                  }
                }}
                placeholder="Logistics, Keynote, Spicy…"
                aria-label="New label name"
                className="ink-border flex-1 min-w-0 font-editorial text-lg bg-transparent outline-none px-3"
                style={{ minHeight: 56, background: 'var(--bone)' }}
              />
              <button
                type="button"
                onClick={addLabel}
                className="ink-border stamp ticker text-[12px] tracking-widest px-4"
                style={{ minHeight: 56, background: 'var(--ink)', color: 'var(--bone)' }}
              >
                + ADD
              </button>
            </div>
            {labelError && (
              <p
                role="alert"
                className="ticker text-[11px] tracking-widest mt-2"
                style={{ color: 'var(--vermilion)' }}
              >
                ⚠ {labelError}
              </p>
            )}
            {labels.length > 0 && (
              <ul className="mt-3 space-y-2">
                {labels.map((label) => (
                  <li
                    key={label.name}
                    className="ink-border flex items-center gap-3 px-3 py-2"
                    style={{ background: 'var(--bone)' }}
                  >
                    <span className="font-editorial text-lg flex-1 min-w-0 break-words">
                      {label.name}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setLabels((prev) =>
                          prev.map((l) =>
                            l.name === label.name
                              ? { ...l, participantSelectable: !l.participantSelectable }
                              : l,
                          ),
                        )
                      }
                      aria-pressed={label.participantSelectable}
                      aria-label={`Toggle audience selection for label ${label.name}`}
                      className="ink-border ticker text-[10px] tracking-widest px-3"
                      style={{
                        minHeight: 44,
                        background: label.participantSelectable ? 'var(--ivy)' : 'var(--bone)',
                        color: label.participantSelectable ? 'var(--bone)' : 'var(--ink)',
                      }}
                    >
                      {label.participantSelectable ? '● AUDIENCE PICKS' : '○ HOST ONLY'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setLabels((prev) => prev.filter((l) => l.name !== label.name))}
                      aria-label={`Remove label ${label.name}`}
                      className="ink-border ticker text-[10px] tracking-widest px-3"
                      style={{ minHeight: 44, background: 'var(--bone)', color: 'var(--ink)' }}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

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

function ToggleControl({
  label,
  on,
  onToggle,
  onText,
  offText,
  hint,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
  onText: string;
  offText: string;
  hint: string;
}) {
  return (
    <div className="flex items-start justify-between gap-6 flex-wrap">
      <div className="max-w-[520px]">
        <span className="chyron">{label}</span>
        <p className="font-editorial italic text-[13px] mt-1 opacity-70">{hint}</p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={on}
        className="ink-border ticker text-[11px] tracking-widest flex items-center justify-between gap-3 px-3 min-w-[220px]"
        style={{
          minHeight: 44,
          background: on ? 'var(--ivy)' : 'var(--bone)',
          color: on ? 'var(--bone)' : 'var(--ink)',
        }}
      >
        <span aria-hidden>{on ? '●' : '○'}</span>
        <span>{on ? onText : offText}</span>
      </button>
    </div>
  );
}
