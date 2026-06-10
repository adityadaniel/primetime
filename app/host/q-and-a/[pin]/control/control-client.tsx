'use client';

// Q&A host control room (MID-337): session header (PIN, join link, QR,
// counts), live question board, and sort/filter/search. The board renders the
// host projection (`qa:host:state` — LIVE + IN_REVIEW + DISMISSED questions
// plus counts), which only ever arrives on this socket, never the mixed
// qa:${pin} room. Vote bursts arrive as coalesced `qa:scores` deltas and are
// patched in place; sort/search run client-side so live updates never block
// on the server. Moderation queue (MID-338): in-review rows get approve/
// dismiss plus multi-select bulk actions, and dismissed questions live in a
// host-only spike pile with restore. Highlight/answered/archive, labels CRUD,
// and session controls ship with MID-339+.

import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AccountMenu from '@/components/AccountMenu';
import { Chyron, Clock, CornerMarks, FrameCounter, OnAir, SmpteBars } from '@/components/Broadcast';
import { publicUrl } from '@/lib/public-origin';
import { useSocket } from '@/lib/socket';
import type {
  QAHostQuestion,
  QAHostState,
  QAQuestionScore,
  QAQuestionStatus,
  QASessionStatus,
} from '@/lib/types';

type AttachAck = { pin: string; sessionId: string; hostState: QAHostState } | { error: string };

type ModerationAck =
  | { ok: true; questionId: string; status: QAQuestionStatus }
  | { ok: true; questionIds: string[]; failed: { questionId: string; error: string }[] }
  | { error: string };

type SortMode = 'popular' | 'recent' | 'oldest';

// Same popular comparator as the server projection (score desc, oldest
// first), with the id as a final tie-break so the order is stable while
// qa:scores deltas land mid-render.
const COMPARATORS: Record<SortMode, (a: QAHostQuestion, b: QAHostQuestion) => number> = {
  popular: (a, b) => b.score - a.score || a.submittedAt - b.submittedAt || a.id.localeCompare(b.id),
  recent: (a, b) => b.submittedAt - a.submittedAt || a.id.localeCompare(b.id),
  oldest: (a, b) => a.submittedAt - b.submittedAt || a.id.localeCompare(b.id),
};

const SORT_LABELS: Record<SortMode, string> = {
  popular: 'POPULAR',
  recent: 'RECENT',
  oldest: 'OLDEST',
};

function attachErrorMessage(error: string): string {
  switch (error) {
    case 'forbidden':
      return 'This control room belongs to another host.';
    case 'not_found':
      return "That session isn't on the air.";
    case 'session_mismatch':
      return 'Session credentials are stale — reopen from the studio.';
    default:
      return "Couldn't take the control room — try reloading.";
  }
}

function moderationErrorMessage(error: string): string {
  switch (error) {
    case 'invalid_transition':
      return 'That question already moved on.';
    case 'unknown_question':
      return "That question isn't in this session.";
    case 'persistence_failed':
      return "Couldn't save — try again.";
    case 'forbidden':
      return 'This control room belongs to another host.';
    default:
      return "Couldn't update the question — try again.";
  }
}

export default function QAndAControlClient({ pin, sessionId }: { pin: string; sessionId: string }) {
  const socket = useSocket();
  const [host, setHost] = useState<QAHostState | null>(null);
  const [attached, setAttached] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>('popular');
  const [labelFilter, setLabelFilter] = useState<string>('');
  const [query, setQuery] = useState('');
  const [joinUrl, setJoinUrl] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  // Multi-select for bulk approve/dismiss — in-review question ids only.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [showDismissed, setShowDismissed] = useState(false);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setJoinUrl(publicUrl(`/join?pin=${pin}`, window.location.origin));
  }, [pin]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(
    () => () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!socket) return;
    let disposed = false;

    function attach() {
      socket?.emit('qa:host:attach', { pin, sessionId }, (res: AttachAck) => {
        if (disposed) return;
        if ('error' in res) {
          setAttached(false);
          setAttachError(res.error);
          return;
        }
        setAttachError(null);
        setAttached(true);
        setHost(res.hostState);
      });
    }

    const onHostState = (s: QAHostState) => {
      if (s.pin === pin) setHost(s);
    };
    // Coalesced vote deltas: patch counts in place; the render path re-sorts.
    const onScores = (delta: { pin: string; scores: QAQuestionScore[] }) => {
      if (delta.pin !== pin) return;
      setHost((prev) => {
        if (!prev) return prev;
        const byId = new Map(delta.scores.map((s) => [s.questionId, s]));
        return {
          ...prev,
          questions: prev.questions.map((q) => {
            const s = byId.get(q.id);
            return s ? { ...q, score: s.score, upvotes: s.upvotes, downvotes: s.downvotes } : q;
          }),
        };
      });
    };
    const onConnect = () => attach();
    const onDisconnect = () => setAttached(false);

    socket.on('qa:host:state', onHostState);
    socket.on('qa:scores', onScores);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) attach();

    return () => {
      disposed = true;
      socket.off('qa:host:state', onHostState);
      socket.off('qa:scores', onScores);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket, pin, sessionId]);

  const labelNames = useMemo(
    () => new Map((host?.labels ?? []).map((l) => [l.id, l.name])),
    [host?.labels],
  );

  // Sort + filter + search are all client-side: no server round-trips, and
  // deterministic tie-breaks keep the order stable during live updates.
  // DISMISSED rows stay off the live board — they live in the spike pile.
  const board = useMemo(() => {
    let rows = (host?.questions ?? []).filter((q) => q.status !== 'DISMISSED');
    if (labelFilter) rows = rows.filter((q) => q.labelIds.includes(labelFilter));
    const needle = query.trim().toLowerCase();
    if (needle) {
      rows = rows.filter(
        (q) =>
          q.text.toLowerCase().includes(needle) ||
          (q.authorDisplayName ?? '').toLowerCase().includes(needle),
      );
    }
    return [...rows].sort(COMPARATORS[sort]);
  }, [host?.questions, labelFilter, query, sort]);

  const dismissed = useMemo(
    () =>
      (host?.questions ?? [])
        .filter((q) => q.status === 'DISMISSED')
        .sort((a, b) => b.submittedAt - a.submittedAt || a.id.localeCompare(b.id)),
    [host?.questions],
  );

  // Selection only ever holds in-review ids: approve/dismiss/withdraw from
  // another surface prunes the row here too.
  useEffect(() => {
    setSelected((prev) => {
      const inReview = new Set(
        (host?.questions ?? []).filter((q) => q.status === 'IN_REVIEW').map((q) => q.id),
      );
      const next = new Set([...prev].filter((id) => inReview.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [host?.questions]);

  function toggleSelected(questionId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  }

  function moderate(action: 'approve' | 'dismiss' | 'restore', questionId: string) {
    if (!socket) return;
    socket.emit(`qa:host:${action}`, { pin, questionId }, (res: ModerationAck) => {
      if ('error' in res) {
        showToast(moderationErrorMessage(res.error));
        return;
      }
      showToast(
        action === 'approve'
          ? 'Approved — on the wire.'
          : action === 'dismiss'
            ? 'Dismissed — spiked.'
            : 'Restored to review.',
      );
    });
  }

  function moderateBulk(action: 'approve' | 'dismiss') {
    if (!socket || selected.size === 0) return;
    const questionIds = [...selected];
    socket.emit(`qa:host:${action}`, { pin, questionIds }, (res: ModerationAck) => {
      if ('error' in res) {
        showToast(moderationErrorMessage(res.error));
        return;
      }
      setSelected(new Set());
      const okCount = 'questionIds' in res ? res.questionIds.length : 0;
      const failedCount = 'failed' in res ? res.failed.length : 0;
      const verb = action === 'approve' ? 'approved' : 'dismissed';
      showToast(
        failedCount === 0 ? `${okCount} ${verb}.` : `${okCount} ${verb} · ${failedCount} failed.`,
      );
    });
  }

  function copyText(value: string, label: string) {
    if (!value || typeof navigator === 'undefined') return;
    navigator.clipboard?.writeText(value).then(
      () => showToast(`${label} copied`),
      () => showToast('Copy failed — select it manually.'),
    );
  }

  function openDisplay() {
    window.open(
      publicUrl(`/host/q-and-a/${pin}/display`, window.location.origin),
      '_blank',
      'noopener,noreferrer',
    );
  }

  if (attachError) {
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <div className="max-w-md text-center">
          <p className="chyron mb-3" style={{ color: 'var(--vermilion)' }}>
            SIGNAL REFUSED
          </p>
          <p className="font-editorial text-xl mb-4">{attachErrorMessage(attachError)}</p>
          <Link
            href="/host"
            className="ink-border stamp ticker text-[12px] tracking-widest px-4 py-3 inline-block"
            style={{ background: 'var(--vermilion)', color: 'var(--bone)' }}
          >
            ↩ STUDIO MASTER
          </Link>
        </div>
      </main>
    );
  }

  const status: QASessionStatus = host?.status ?? 'OPEN';
  const counts = host?.counts ?? { live: 0, inReview: 0, answered: 0, archived: 0, dismissed: 0 };
  // The empty/filtered messages care about boardable rows (LIVE + IN_REVIEW)
  // only — dismissed questions live in the spike pile below.
  const hasQuestions = counts.live + counts.inReview > 0;
  const filtered = hasQuestions && board.length === 0;
  const inReviewBoard = board.filter((q) => q.status === 'IN_REVIEW');
  const allInReviewSelected =
    inReviewBoard.length > 0 && inReviewBoard.every((q) => selected.has(q.id));

  return (
    <main className="relative min-h-screen pb-24">
      <CornerMarks />
      {toast && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 ink-border stamp ticker text-[11px] tracking-widest px-3 py-2"
          style={{ background: 'var(--ivy)', color: 'var(--bone)' }}
          role="status"
          aria-live="polite"
        >
          ✓ {toast}
        </div>
      )}

      <header className="px-6 pt-4 flex items-center justify-between">
        <Chyron label="CONTROL ROOM · AUDIENCE Q&A" number="QA" />
        <div className="flex items-center gap-6">
          <FrameCounter index={Math.min(999, counts.live)} />
          <Clock />
          <OnAir live={status === 'OPEN'} />
          <AccountMenu />
        </div>
      </header>
      <SmpteBars className="h-1.5 mt-3" />

      <section className="px-4 sm:px-6 pt-6 max-w-[1500px] mx-auto grid grid-cols-12 gap-5">
        {/* Session header */}
        <div
          className="col-span-12 lg:col-span-5 ink-border p-5 sm:p-6"
          style={{ background: 'var(--bone)' }}
        >
          <div className="flex flex-col-reverse md:flex-row md:items-start md:justify-between gap-4">
            <div className="flex-1 min-w-0">
              <span className="chyron" style={{ color: 'var(--vermilion)' }}>
                ON THE DESK
              </span>
              <p
                className="font-editorial leading-tight mt-2"
                style={{ fontSize: 'clamp(26px, 3.4vw, 42px)' }}
              >
                {host?.title ?? '—'}
              </p>
              {host?.description && (
                <p className="font-editorial italic text-[14px] mt-2 opacity-75">
                  {host.description}
                </p>
              )}
            </div>
            <PhaseBadge status={status} attached={attached} />
          </div>

          <div className="mt-5 grid grid-cols-12 gap-3">
            <button
              type="button"
              onClick={() => copyText(pin, 'PIN')}
              className="col-span-12 ink-border text-left p-4 transition-colors hover:bg-[var(--ink)] hover:text-[var(--bone)] focus:bg-[var(--ink)] focus:text-[var(--bone)] outline-none"
              style={{ background: 'var(--bone)', minHeight: 56 }}
              aria-label="Copy PIN to clipboard"
            >
              <span className="chyron opacity-70">GAME PIN · TAP TO COPY</span>
              <p
                className="display-num ticker mt-1 tabular-nums"
                style={{ fontSize: 'clamp(48px, 7vw, 96px)', letterSpacing: '0.08em' }}
              >
                {pin}
              </p>
            </button>
            <PanelStat
              cols="col-span-6 sm:col-span-4"
              label="AUDIENCE"
              value={String(host?.participantCount ?? 0).padStart(2, '0')}
            />
            <PanelStat
              cols="col-span-6 sm:col-span-2"
              label="LIVE"
              value={String(counts.live).padStart(2, '0')}
            />
            <PanelStat
              cols="col-span-4 sm:col-span-2"
              label="REVIEW"
              value={String(counts.inReview).padStart(2, '0')}
            />
            <PanelStat
              cols="col-span-4 sm:col-span-2"
              label="ANSWERED"
              value={String(counts.answered).padStart(2, '0')}
            />
            <PanelStat
              cols="col-span-4 sm:col-span-2"
              label="ARCHIVED"
              value={String(counts.archived).padStart(2, '0')}
            />
          </div>

          <div className="mt-5 flex flex-col sm:flex-row gap-4 items-start">
            <div className="flex-1 min-w-0 w-full">
              <span className="chyron opacity-70">JOIN LINK</span>
              <button
                type="button"
                onClick={() => copyText(joinUrl, 'Join link')}
                className="mt-1 w-full ink-border text-left px-3 py-3 transition-colors hover:bg-[var(--ink)] hover:text-[var(--bone)] outline-none"
                style={{ background: 'var(--bone)', minHeight: 56 }}
                aria-label="Copy join link to clipboard"
              >
                <span className="ticker text-[12px] tracking-wide break-all">{joinUrl || '…'}</span>
                <span className="block ticker text-[10px] tracking-widest opacity-60 mt-1">
                  TAP TO COPY
                </span>
              </button>
              <button
                type="button"
                onClick={openDisplay}
                className="mt-3 ink-border ticker text-[11px] tracking-widest px-3"
                style={{ minHeight: 56, background: 'var(--bone)', color: 'var(--ink)' }}
              >
                ⤴ OPEN DISPLAY
              </button>
            </div>
            <div className="flex flex-col items-center gap-2 shrink-0">
              <div
                className="ink-border p-3 grid place-items-center"
                style={{ background: 'var(--bone)' }}
              >
                {joinUrl ? (
                  <QRCodeSVG
                    value={joinUrl}
                    size={132}
                    bgColor="transparent"
                    fgColor="var(--ink)"
                    level="M"
                    marginSize={0}
                  />
                ) : (
                  <div style={{ width: 132, height: 132 }} aria-hidden />
                )}
              </div>
              <span className="ticker text-[10px] tracking-widest opacity-70">SCAN TO JOIN</span>
            </div>
          </div>

          <div
            className="mt-5 pt-4 border-t-2 flex items-center justify-between"
            style={{ borderColor: 'var(--ink)' }}
          >
            <Link href="/host" className="ticker text-[11px] tracking-widest opacity-70">
              ← studio master
            </Link>
            <span className="ticker text-[10px] tracking-widest opacity-50">
              SESSION CONTROLS ARRIVE WITH A LATER BROADCAST UPGRADE
            </span>
          </div>
        </div>

        {/* Live question board */}
        <aside
          className="col-span-12 lg:col-span-7 ink-border p-5 flex flex-col"
          style={{ background: 'var(--bone)' }}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="chyron">QUESTION BOARD · LIVE WIRE</span>
            <span className="ticker text-[11px] tracking-widest opacity-60">
              {String(counts.live).padStart(2, '0')} LIVE ·{' '}
              {String(counts.inReview).padStart(2, '0')} IN REVIEW
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <fieldset className="ink-border inline-flex" aria-label="Sort questions">
              {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSort(mode)}
                  aria-pressed={sort === mode}
                  className="ticker text-[11px] tracking-widest px-3"
                  style={{
                    minHeight: 44,
                    background: sort === mode ? 'var(--ink)' : 'var(--bone)',
                    color: sort === mode ? 'var(--bone)' : 'var(--ink)',
                  }}
                >
                  {SORT_LABELS[mode]}
                </button>
              ))}
            </fieldset>
            {(host?.labels.length ?? 0) > 0 ? (
              <select
                value={labelFilter}
                onChange={(e) => setLabelFilter(e.target.value)}
                aria-label="Filter by label"
                className="ink-border ticker text-[11px] tracking-widest px-2 bg-transparent"
                style={{ minHeight: 44, background: 'var(--bone)' }}
              >
                <option value="">ALL LABELS</option>
                {(host?.labels ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name.toUpperCase()}
                  </option>
                ))}
              </select>
            ) : (
              <span
                className="ink-border ticker text-[11px] tracking-widest px-3 inline-flex items-center opacity-50"
                style={{ minHeight: 44 }}
                title="Labels arrive with a later broadcast upgrade (MID-340)"
              >
                LABELS · SOON
              </span>
            )}
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="SEARCH THE WIRE…"
              aria-label="Search questions"
              className="ink-border ticker text-[12px] tracking-wide px-3 flex-1 min-w-[160px] bg-transparent outline-none"
              style={{ minHeight: 44, background: 'var(--bone)' }}
            />
          </div>

          {/* Review desk (MID-338): bulk approve/dismiss for selected
              in-review questions. Only rendered when moderation is on. */}
          {host?.moderationEnabled && counts.inReview > 0 && (
            <div
              className="mt-3 ink-border px-3 py-2 flex flex-wrap items-center gap-2"
              style={{ background: 'var(--marigold)' }}
            >
              <span className="ticker text-[11px] tracking-widest">
                REVIEW DESK · {String(selected.size).padStart(2, '0')} SELECTED
              </span>
              <div className="flex flex-wrap items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() =>
                    setSelected(
                      allInReviewSelected ? new Set() : new Set(inReviewBoard.map((q) => q.id)),
                    )
                  }
                  className="ink-border ticker text-[10px] tracking-widest px-3"
                  style={{ minHeight: 40, background: 'var(--bone)', color: 'var(--ink)' }}
                >
                  {allInReviewSelected ? 'CLEAR ALL' : 'SELECT ALL'}
                </button>
                <button
                  type="button"
                  onClick={() => moderateBulk('approve')}
                  disabled={selected.size === 0}
                  className="ink-border stamp ticker text-[10px] tracking-widest px-3 disabled:opacity-40"
                  style={{ minHeight: 40, background: 'var(--ivy)', color: 'var(--bone)' }}
                >
                  ✓ APPROVE ({selected.size})
                </button>
                <button
                  type="button"
                  onClick={() => moderateBulk('dismiss')}
                  disabled={selected.size === 0}
                  className="ink-border stamp ticker text-[10px] tracking-widest px-3 disabled:opacity-40"
                  style={{ minHeight: 40, background: 'var(--ink)', color: 'var(--bone)' }}
                >
                  ✕ DISMISS ({selected.size})
                </button>
              </div>
            </div>
          )}

          <ol
            className="mt-3 overflow-y-auto pr-1 flex-1"
            style={{ maxHeight: 640 }}
            aria-live="polite"
          >
            {!hasQuestions && (
              <li className="font-editorial italic opacity-60 py-4">
                Nothing on the wire yet — share PIN {pin} (or the QR) and the board fills as
                questions arrive.
              </li>
            )}
            {filtered && (
              <li className="font-editorial italic opacity-60 py-4">
                No questions match — clear the search{labelFilter ? ' or label filter' : ''} to see
                the full board.
              </li>
            )}
            {board.map((q, i) => (
              <li
                key={q.id}
                className="py-3 border-b last:border-b-0"
                style={{
                  borderColor: 'rgba(15,15,15,.18)',
                  opacity: q.status === 'IN_REVIEW' ? 0.85 : 1,
                }}
              >
                <div className="flex items-start gap-3">
                  {q.status === 'IN_REVIEW' ? (
                    <input
                      type="checkbox"
                      checked={selected.has(q.id)}
                      onChange={() => toggleSelected(q.id)}
                      aria-label={`Select question for bulk action: ${q.text}`}
                      className="mt-1 size-5 shrink-0 accent-[var(--ink)]"
                      style={{ minWidth: 36 }}
                    />
                  ) : (
                    <span className="display-num text-2xl tabular-nums" style={{ minWidth: 36 }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="ticker text-[10px] tracking-widest px-2 py-[2px] ink-border"
                        style={
                          q.status === 'IN_REVIEW'
                            ? { background: 'var(--marigold)', color: 'var(--ink)' }
                            : { background: 'var(--vermilion)', color: 'var(--bone)' }
                        }
                      >
                        {q.status === 'IN_REVIEW' ? 'IN REVIEW' : 'LIVE'}
                      </span>
                      {q.highlighted && (
                        <span
                          className="ticker text-[10px] tracking-widest px-2 py-[2px] ink-border"
                          style={{ background: 'var(--ink)', color: 'var(--bone)' }}
                        >
                          ★ ON AIR
                        </span>
                      )}
                      {q.labelIds.map((id) => (
                        <span
                          key={id}
                          className="ticker text-[10px] tracking-widest px-2 py-[2px] ink-border opacity-80"
                        >
                          {(labelNames.get(id) ?? 'LABEL').toUpperCase()}
                        </span>
                      ))}
                    </div>
                    <p
                      className="font-editorial text-lg leading-snug mt-1"
                      style={{ wordBreak: 'break-word' }}
                    >
                      {q.text}
                    </p>
                    <p className="ticker text-[10px] tracking-widest opacity-60 mt-1">
                      {q.isAnonymous ? 'ANONYMOUS' : (q.authorDisplayName ?? 'ANONYMOUS')} ·{' '}
                      {new Date(q.submittedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {' · '}↩ {q.replyCount}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span
                      className="display-num ticker tabular-nums text-2xl"
                      title={
                        host?.downvotesEnabled
                          ? `▲ ${q.upvotes} · ▼ ${q.downvotes}`
                          : `${q.upvotes} upvotes`
                      }
                    >
                      ▲{q.score}
                    </span>
                    {q.status === 'IN_REVIEW' ? (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => moderate('approve', q.id)}
                          className="ink-border stamp ticker text-[9px] tracking-widest px-2"
                          style={{ minHeight: 36, background: 'var(--ivy)', color: 'var(--bone)' }}
                        >
                          ✓ APPROVE
                        </button>
                        <button
                          type="button"
                          onClick={() => moderate('dismiss', q.id)}
                          className="ink-border stamp ticker text-[9px] tracking-widest px-2"
                          style={{ minHeight: 36, background: 'var(--ink)', color: 'var(--bone)' }}
                        >
                          ✕ DISMISS
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        {['HIGHLIGHT', 'ANSWERED', 'ARCHIVE'].map((action) => (
                          <button
                            key={action}
                            type="button"
                            disabled
                            className="ink-border ticker text-[9px] tracking-widest px-2 opacity-40"
                            style={{ minHeight: 32, background: 'var(--ash)', color: 'var(--ink)' }}
                            title="Arrives with a later broadcast upgrade (MID-339)"
                          >
                            {action}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>

          {/* Spike pile (MID-338): dismissed questions, host-only, restorable.
              Never part of the public projection — this list only exists in
              qa:host:state. */}
          {dismissed.length > 0 && (
            <div className="mt-4 pt-3 border-t-2" style={{ borderColor: 'var(--ink)' }}>
              <button
                type="button"
                onClick={() => setShowDismissed((v) => !v)}
                aria-expanded={showDismissed}
                className="ticker text-[11px] tracking-widest flex items-center gap-2"
                style={{ minHeight: 44 }}
              >
                <span aria-hidden>{showDismissed ? '▾' : '▸'}</span>
                THE SPIKE · {String(dismissed.length).padStart(2, '0')} DISMISSED
              </button>
              {showDismissed && (
                <ul className="mt-2">
                  {dismissed.map((q) => (
                    <li
                      key={q.id}
                      className="py-2 border-b last:border-b-0 flex items-start gap-3"
                      style={{ borderColor: 'rgba(15,15,15,.18)', opacity: 0.75 }}
                    >
                      <div className="flex-1 min-w-0">
                        <p
                          className="font-editorial text-base leading-snug line-through"
                          style={{ wordBreak: 'break-word' }}
                        >
                          {q.text}
                        </p>
                        <p className="ticker text-[10px] tracking-widest opacity-60 mt-1">
                          {q.isAnonymous ? 'ANONYMOUS' : (q.authorDisplayName ?? 'ANONYMOUS')} ·{' '}
                          {new Date(q.submittedAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => moderate('restore', q.id)}
                        className="ink-border stamp ticker text-[9px] tracking-widest px-2 shrink-0"
                        style={{ minHeight: 36, background: 'var(--bone)', color: 'var(--ink)' }}
                      >
                        ↩ RESTORE
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function PhaseBadge({ status, attached }: { status: QASessionStatus; attached: boolean }) {
  if (!attached) {
    return (
      <span
        className="ticker tracking-widest text-[12px] px-3 py-1 ink-border self-start"
        style={{ background: 'var(--ash)', color: 'var(--ink)' }}
      >
        TUNING IN…
      </span>
    );
  }
  const map: Record<QASessionStatus, { label: string; bg: string; fg: string }> = {
    OPEN: { label: 'ON AIR · COLLECTING', bg: 'var(--vermilion)', fg: 'var(--bone)' },
    CLOSED: { label: 'CLOSED · HOLD', bg: 'var(--marigold)', fg: 'var(--ink)' },
    ENDED: { label: 'FADE OUT · ENDED', bg: 'var(--ink)', fg: 'var(--bone)' },
  };
  const s = map[status];
  return (
    <span
      className="ticker tracking-widest text-[12px] px-3 py-1 ink-border self-start"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

function PanelStat({ cols, label, value }: { cols: string; label: string; value: string }) {
  return (
    <div className={`${cols} ink-border p-3 flex flex-col`} style={{ background: 'var(--bone)' }}>
      <span className="chyron opacity-70">{label}</span>
      <span className="display-num text-3xl mt-1 ticker">{value}</span>
    </div>
  );
}
