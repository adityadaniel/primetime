'use client';

// Q&A host control room (MID-337): session header (PIN, join link, QR,
// counts), live question board, and sort/filter/search. The board renders the
// host projection (`qa:host:state` — every non-WITHDRAWN question plus
// counts), which only ever arrives on this socket, never the mixed
// qa:${pin} room. Vote bursts arrive as coalesced `qa:scores` deltas and are
// patched in place; sort/search run client-side so live updates never block
// on the server. Moderation queue (MID-338): in-review rows get approve/
// dismiss plus multi-select bulk actions, and dismissed questions live in a
// host-only spike pile with restore. Live-board actions (MID-339): live rows
// get highlight (one on air at a time), edit (original text preserved
// server-side), mark answered, and archive with undo; answered/archived
// questions land in a filed pile with restore. Labels (MID-340): the host
// can mint session-scoped labels mid-broadcast (with a per-label audience
// toggle), pin them on questions from a per-row picker, and filter the board
// by label. Session controls (MID-342): close/reopen question intake,
// close/reopen voting, and end the session from the host control room.

import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AccountMenu from '@/components/AccountMenu';
import { Chyron, Clock, CornerMarks, FrameCounter, OnAir, SmpteBars } from '@/components/Broadcast';
import { publicUrl } from '@/lib/public-origin';
import { QA_HOST_REPLY_CHAR_LIMIT, QA_LABEL_NAME_LIMIT, validateLabelName } from '@/lib/qa-input';
import { useSocket } from '@/lib/socket';
import type {
  QAHostQuestion,
  QAHostState,
  QAPublicLabel,
  QAPublicReply,
  QAQuestionScore,
  QAQuestionStatus,
  QASessionStatus,
} from '@/lib/types';

type AttachAck = { pin: string; sessionId: string; hostState: QAHostState } | { error: string };

type ModerationAck =
  | { ok: true; questionId: string; status: QAQuestionStatus }
  | { ok: true; questionIds: string[]; failed: { questionId: string; error: string }[] }
  | { error: string };

type HighlightAck = { ok: true; highlightedQuestionId: string | null } | { error: string };

type EditAck = { ok: true; questionId: string; text: string } | { error: string };

type LabelCreateAck = { ok: true; label: QAPublicLabel } | { error: string };

type LabelAssignAck = { ok: true; questionId: string; labelIds: string[] } | { error: string };

type ReplyAck = { ok: true; questionId: string; reply: QAPublicReply } | { error: string };

type SessionControlAck =
  | { ok: true; status: QASessionStatus; submissionsOpen: boolean; votingOpen: boolean }
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

function highlightErrorMessage(error: string): string {
  return error === 'not_live'
    ? 'Only live questions can go on air.'
    : moderationErrorMessage(error);
}

function editErrorMessage(error: string): string {
  switch (error) {
    case 'empty_text':
      return 'A question needs some words.';
    case 'text_too_long':
      return 'Too long — trim the copy.';
    case 'invalid_status':
      return 'That question already settled.';
    default:
      return moderationErrorMessage(error);
  }
}

function replyErrorMessage(error: string): string {
  switch (error) {
    case 'empty_text':
      return 'A reply needs some words.';
    case 'text_too_long':
      return `Keep replies under ${QA_HOST_REPLY_CHAR_LIMIT} characters.`;
    case 'invalid_status':
      return 'That question already settled — restore it to reply.';
    case 'unknown_reply':
      return 'That reply is gone — refresh the thread.';
    case 'not_host_reply':
      return 'Only your own replies can be rewritten.';
    case 'session_ended':
      return 'The session has ended.';
    default:
      return moderationErrorMessage(error);
  }
}

function labelErrorMessage(error: string): string {
  switch (error) {
    case 'empty_label':
      return 'A label needs a name.';
    case 'label_too_long':
      return `Keep labels under ${QA_LABEL_NAME_LIMIT} characters.`;
    case 'duplicate_label':
      return 'That label already exists.';
    case 'unknown_label':
      return "That label isn't in this session.";
    case 'session_ended':
      return 'The session has ended.';
    default:
      return moderationErrorMessage(error);
  }
}

function controlErrorMessage(error: string): string {
  switch (error) {
    case 'invalid_transition':
      return 'That session move is not allowed.';
    case 'session_ended':
      return 'The session has already ended.';
    default:
      return moderationErrorMessage(error);
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
  // Toasts can carry an undo callback (MID-339): archive-class actions are
  // confirmed with easy undo instead of a blocking dialog (PRD §7).
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  // Multi-select for bulk approve/dismiss — in-review question ids only.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [showDismissed, setShowDismissed] = useState(false);
  const [showFiled, setShowFiled] = useState(false);
  // Inline host edit (MID-339): one question at a time, draft kept locally
  // until SAVE so live re-sorts never clobber the host's typing.
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  // Mid-session label minting (MID-340): inline form with a per-label
  // audience toggle, plus a per-row picker for assigning/unassigning.
  const [labelFormOpen, setLabelFormOpen] = useState(false);
  const [labelDraft, setLabelDraft] = useState('');
  const [labelSelectable, setLabelSelectable] = useState(false);
  const [labelPickerId, setLabelPickerId] = useState<string | null>(null);
  // Reply desk (MID-341): one open thread at a time; the composer draft and
  // any in-flight reply rewrite are kept locally so live re-sorts never
  // clobber the host's typing.
  const [replyThreadId, setReplyThreadId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [replyEditing, setReplyEditing] = useState<{
    questionId: string;
    replyId: string;
    text: string;
  } | null>(null);
  const [controlPending, setControlPending] = useState<'submissions' | 'voting' | 'end' | null>(
    null,
  );
  const [confirmEnd, setConfirmEnd] = useState(false);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setJoinUrl(publicUrl(`/join?pin=${pin}`, window.location.origin));
  }, [pin]);

  const showToast = useCallback((msg: string, undo?: () => void) => {
    setToast({ msg, undo });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    // Undo-able toasts linger longer so the host can actually catch them.
    toastTimerRef.current = window.setTimeout(() => setToast(null), undo ? 6000 : 2400);
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
  // Only LIVE + IN_REVIEW rows board — DISMISSED live in the spike pile,
  // ANSWERED/ARCHIVED in the filed pile.
  const board = useMemo(() => {
    let rows = (host?.questions ?? []).filter(
      (q) => q.status === 'LIVE' || q.status === 'IN_REVIEW',
    );
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

  // Filed pile (MID-339): answered + archived questions, restorable to the
  // live board. Host-only — these never reach public projections.
  const filed = useMemo(
    () =>
      (host?.questions ?? [])
        .filter((q) => q.status === 'ANSWERED' || q.status === 'ARCHIVED')
        .sort((a, b) => b.submittedAt - a.submittedAt || a.id.localeCompare(b.id)),
    [host?.questions],
  );

  // Drop a stale edit draft if the question settled or vanished while the
  // host was typing (withdrawn, answered from another surface, …).
  useEffect(() => {
    setEditing((prev) => {
      if (!prev) return prev;
      const q = (host?.questions ?? []).find((row) => row.id === prev.id);
      return q && (q.status === 'LIVE' || q.status === 'IN_REVIEW') ? prev : null;
    });
    // Same staleness rule for an in-flight reply rewrite (MID-341): replies
    // are only editable while their question is still boardable.
    setReplyEditing((prev) => {
      if (!prev) return prev;
      const q = (host?.questions ?? []).find((row) => row.id === prev.questionId);
      return q && (q.status === 'LIVE' || q.status === 'IN_REVIEW') ? prev : null;
    });
  }, [host?.questions]);

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

  function moderate(
    action: 'approve' | 'dismiss' | 'restore' | 'answered' | 'archive',
    questionId: string,
  ) {
    if (!socket) return;
    socket.emit(`qa:host:${action}`, { pin, questionId }, (res: ModerationAck) => {
      if ('error' in res) {
        showToast(moderationErrorMessage(res.error));
        return;
      }
      const status = 'status' in res ? res.status : undefined;
      switch (action) {
        case 'approve':
          showToast('Approved — on the wire.');
          break;
        case 'dismiss':
          showToast('Dismissed — spiked.');
          break;
        case 'restore':
          // Status-directed restore: DISMISSED returns to review,
          // ANSWERED/ARCHIVED return to the live board.
          showToast(status === 'IN_REVIEW' ? 'Restored to review.' : 'Back on the wire.');
          break;
        case 'answered':
          showToast('Answered — filed.', () => moderate('restore', questionId));
          break;
        case 'archive':
          showToast('Archived — filed.', () => moderate('restore', questionId));
          break;
      }
    });
  }

  // One question on air at a time: highlighting replaces the previous
  // highlight server-side; clicking the on-air row's button un-highlights.
  function toggleHighlight(q: QAHostQuestion) {
    if (!socket) return;
    const questionId = q.highlighted ? null : q.id;
    socket.emit('qa:host:highlight', { pin, questionId }, (res: HighlightAck) => {
      if ('error' in res) {
        showToast(highlightErrorMessage(res.error));
        return;
      }
      showToast(res.highlightedQuestionId ? 'On air — highlighted.' : 'Highlight cleared.');
    });
  }

  function saveEdit() {
    if (!socket || !editing) return;
    const text = editing.text.trim();
    if (!text) {
      showToast(editErrorMessage('empty_text'));
      return;
    }
    socket.emit('qa:host:edit', { pin, questionId: editing.id, text }, (res: EditAck) => {
      if ('error' in res) {
        showToast(editErrorMessage(res.error));
        return;
      }
      setEditing(null);
      showToast('Rewritten — original kept on file.');
    });
  }

  // Reply desk (MID-341): replies to LIVE questions go out to the room;
  // replies to IN_REVIEW questions stay private to the submitter until the
  // question is approved (server routes the fanout — see qa:host:reply).
  function sendReply(q: QAHostQuestion) {
    if (!socket) return;
    const text = replyDraft.trim();
    if (!text) {
      showToast(replyErrorMessage('empty_text'));
      return;
    }
    socket.emit('qa:host:reply', { pin, questionId: q.id, text }, (res: ReplyAck) => {
      if ('error' in res) {
        showToast(replyErrorMessage(res.error));
        return;
      }
      setReplyDraft('');
      showToast(
        q.status === 'IN_REVIEW' ? 'Replied — private until approved.' : 'Reply on the wire.',
      );
    });
  }

  function saveReplyEdit() {
    if (!socket || !replyEditing) return;
    const text = replyEditing.text.trim();
    if (!text) {
      showToast(replyErrorMessage('empty_text'));
      return;
    }
    socket.emit(
      'qa:host:reply:edit',
      { pin, questionId: replyEditing.questionId, replyId: replyEditing.replyId, text },
      (res: ReplyAck) => {
        if ('error' in res) {
          showToast(replyErrorMessage(res.error));
          return;
        }
        setReplyEditing(null);
        showToast('Reply rewritten.');
      },
    );
  }

  function createLabel() {
    if (!socket) return;
    const validated = validateLabelName(labelDraft);
    if (!validated.ok) {
      showToast(labelErrorMessage(validated.reason));
      return;
    }
    socket.emit(
      'qa:host:label:create',
      { pin, name: validated.value, participantSelectable: labelSelectable },
      (res: LabelCreateAck) => {
        if ('error' in res) {
          showToast(labelErrorMessage(res.error));
          return;
        }
        setLabelDraft('');
        setLabelSelectable(false);
        showToast(
          res.label.participantSelectable
            ? `Label "${res.label.name}" on the rack — audience can pick it.`
            : `Label "${res.label.name}" on the rack.`,
        );
      },
    );
  }

  // Chip toggle: assigned -> unassign, unassigned -> assign. The fresh
  // qa:host:state broadcast re-renders the chips, so no local patching.
  function toggleLabelAssignment(q: QAHostQuestion, labelId: string) {
    if (!socket) return;
    const action = q.labelIds.includes(labelId) ? 'unassign' : 'assign';
    socket.emit(
      `qa:host:label:${action}`,
      { pin, questionId: q.id, labelId },
      (res: LabelAssignAck) => {
        if ('error' in res) showToast(labelErrorMessage(res.error));
      },
    );
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

  function setSessionControl(kind: 'submissions' | 'voting', open: boolean) {
    if (!socket || controlPending) return;
    setControlPending(kind);
    const event =
      kind === 'submissions' ? 'qa:host:set-submissions-open' : 'qa:host:set-voting-open';
    socket.emit(event, { pin, open }, (res: SessionControlAck) => {
      setControlPending(null);
      if ('error' in res) {
        showToast(controlErrorMessage(res.error));
        return;
      }
      showToast(
        kind === 'submissions'
          ? open
            ? 'Questions reopened.'
            : 'Questions closed.'
          : open
            ? 'Voting reopened.'
            : 'Voting closed.',
      );
    });
  }

  function endSession() {
    if (!socket || controlPending) return;
    if (!confirmEnd) {
      setConfirmEnd(true);
      showToast('Tap END Q&A again to confirm.');
      return;
    }
    setControlPending('end');
    socket.emit('qa:host:end', { pin }, (res: SessionControlAck) => {
      setControlPending(null);
      setConfirmEnd(false);
      if ('error' in res) {
        showToast(controlErrorMessage(res.error));
        return;
      }
      showToast('Q&A ended.');
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
  const sessionEnded = status === 'ENDED';
  const controlsDisabled = !attached || sessionEnded || controlPending !== null;
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
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 ink-border stamp ticker text-[11px] tracking-widest px-3 py-2 flex items-center gap-3"
          style={{ background: 'var(--ivy)', color: 'var(--bone)' }}
          role="status"
          aria-live="polite"
        >
          <span>✓ {toast.msg}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
              className="ink-border ticker text-[10px] tracking-widest px-2 py-1"
              style={{ background: 'var(--bone)', color: 'var(--ink)' }}
            >
              ↩ UNDO
            </button>
          )}
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

          <div className="mt-5 pt-4 border-t-2" style={{ borderColor: 'var(--ink)' }}>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSessionControl('submissions', !(host?.submissionsOpen ?? true))}
                disabled={controlsDisabled}
                aria-pressed={!(host?.submissionsOpen ?? true)}
                className="ink-border stamp ticker text-[10px] tracking-widest px-3 disabled:opacity-40"
                style={{
                  minHeight: 44,
                  background: host?.submissionsOpen ? 'var(--bone)' : 'var(--vermilion)',
                  color: host?.submissionsOpen ? 'var(--ink)' : 'var(--bone)',
                }}
              >
                {controlPending === 'submissions'
                  ? 'SAVING…'
                  : host?.submissionsOpen
                    ? 'CLOSE QUESTIONS'
                    : 'REOPEN QUESTIONS'}
              </button>
              <button
                type="button"
                onClick={() => setSessionControl('voting', !(host?.votingOpen ?? true))}
                disabled={controlsDisabled}
                aria-pressed={!(host?.votingOpen ?? true)}
                className="ink-border stamp ticker text-[10px] tracking-widest px-3 disabled:opacity-40"
                style={{
                  minHeight: 44,
                  background: host?.votingOpen ? 'var(--bone)' : 'var(--vermilion)',
                  color: host?.votingOpen ? 'var(--ink)' : 'var(--bone)',
                }}
              >
                {controlPending === 'voting'
                  ? 'SAVING…'
                  : host?.votingOpen
                    ? 'CLOSE VOTING'
                    : 'REOPEN VOTING'}
              </button>
              <button
                type="button"
                onClick={endSession}
                disabled={!attached || sessionEnded || controlPending !== null}
                className="ink-border stamp ticker text-[10px] tracking-widest px-3 disabled:opacity-40"
                style={{
                  minHeight: 44,
                  background: confirmEnd ? 'var(--vermilion)' : 'var(--ink)',
                  color: 'var(--bone)',
                }}
              >
                {controlPending === 'end' ? 'ENDING…' : confirmEnd ? 'CONFIRM END Q&A' : 'END Q&A'}
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <Link href="/host" className="ticker text-[11px] tracking-widest opacity-70">
                ← studio master
              </Link>
              <span className="ticker text-[10px] tracking-widest opacity-60 text-right">
                {sessionEnded
                  ? 'SESSION ENDED · BOARD IS VIEW ONLY'
                  : `${host?.submissionsOpen ? 'QUESTIONS OPEN' : 'QUESTIONS CLOSED'} · ${
                      host?.votingOpen ? 'VOTING OPEN' : 'VOTING CLOSED'
                    }`}
              </span>
            </div>
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
            {(host?.labels.length ?? 0) > 0 && (
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
            )}
            <button
              type="button"
              onClick={() => setLabelFormOpen((v) => !v)}
              aria-expanded={labelFormOpen}
              className="ink-border ticker text-[11px] tracking-widest px-3"
              style={{
                minHeight: 44,
                background: labelFormOpen ? 'var(--ink)' : 'var(--bone)',
                color: labelFormOpen ? 'var(--bone)' : 'var(--ink)',
              }}
            >
              {labelFormOpen ? '✕ LABELS' : '+ LABEL'}
            </button>
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

          {/* Label rack (MID-340): mint a session-scoped label mid-broadcast.
              The audience toggle decides whether participants can pick it at
              submission (and see it in their filter). */}
          {labelFormOpen && (
            <div
              className="mt-3 ink-border px-3 py-2 flex flex-wrap items-center gap-2"
              style={{ background: 'var(--bone)' }}
            >
              <input
                value={labelDraft}
                maxLength={QA_LABEL_NAME_LIMIT}
                onChange={(e) => setLabelDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    createLabel();
                  }
                }}
                placeholder="NEW LABEL · LOGISTICS, KEYNOTE…"
                aria-label="New label name"
                className="ink-border ticker text-[12px] tracking-wide px-3 flex-1 min-w-[160px] bg-transparent outline-none"
                style={{ minHeight: 44, background: 'var(--bone)' }}
              />
              <button
                type="button"
                onClick={() => setLabelSelectable((v) => !v)}
                aria-pressed={labelSelectable}
                aria-label="Toggle whether the audience can pick this label"
                className="ink-border ticker text-[10px] tracking-widest px-3"
                style={{
                  minHeight: 44,
                  background: labelSelectable ? 'var(--ivy)' : 'var(--bone)',
                  color: labelSelectable ? 'var(--bone)' : 'var(--ink)',
                }}
              >
                {labelSelectable ? '● AUDIENCE PICKS' : '○ HOST ONLY'}
              </button>
              <button
                type="button"
                onClick={createLabel}
                className="ink-border stamp ticker text-[10px] tracking-widest px-3"
                style={{ minHeight: 44, background: 'var(--ink)', color: 'var(--bone)' }}
              >
                + MINT LABEL
              </button>
            </div>
          )}

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
                        <button
                          key={id}
                          type="button"
                          onClick={() => toggleLabelAssignment(q, id)}
                          aria-label={`Remove label ${labelNames.get(id) ?? 'label'} from question`}
                          title="Tap to remove this label"
                          className="ticker text-[10px] tracking-widest px-2 py-[2px] ink-border opacity-80 hover:opacity-100"
                        >
                          {(labelNames.get(id) ?? 'LABEL').toUpperCase()} ✕
                        </button>
                      ))}
                      {(host?.labels.length ?? 0) > 0 && (
                        <button
                          type="button"
                          onClick={() => setLabelPickerId((id) => (id === q.id ? null : q.id))}
                          aria-expanded={labelPickerId === q.id}
                          aria-label={`Pick labels for question: ${q.text}`}
                          className="ticker text-[10px] tracking-widest px-2 py-[2px] ink-border opacity-60 hover:opacity-100"
                        >
                          {labelPickerId === q.id ? '✕' : '⊕ LABEL'}
                        </button>
                      )}
                    </div>
                    {/* Label picker (MID-340): every session label as a chip
                        toggle — filled = assigned, hollow = tap to assign. */}
                    {labelPickerId === q.id && (
                      <div
                        className="mt-2 ink-border px-2 py-2 flex flex-wrap gap-1"
                        style={{ background: 'var(--bone)' }}
                      >
                        {(host?.labels ?? []).map((label) => {
                          const assigned = q.labelIds.includes(label.id);
                          return (
                            <button
                              key={label.id}
                              type="button"
                              onClick={() => toggleLabelAssignment(q, label.id)}
                              aria-pressed={assigned}
                              className="ticker text-[10px] tracking-widest px-2 py-[2px] ink-border"
                              style={{
                                minHeight: 32,
                                background: assigned ? 'var(--ink)' : 'var(--bone)',
                                color: assigned ? 'var(--bone)' : 'var(--ink)',
                              }}
                            >
                              {assigned ? '◼' : '◻'} {label.name.toUpperCase()}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {editing?.id === q.id ? (
                      <div className="mt-1">
                        <textarea
                          value={editing.text}
                          onChange={(e) =>
                            setEditing((prev) => (prev ? { ...prev, text: e.target.value } : prev))
                          }
                          maxLength={host?.questionCharLimit ?? 280}
                          rows={3}
                          aria-label="Edit question text"
                          className="w-full ink-border font-editorial text-lg leading-snug p-2 bg-transparent outline-none resize-y"
                          style={{ background: 'var(--bone)' }}
                        />
                        <div className="mt-1 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={saveEdit}
                            className="ink-border stamp ticker text-[9px] tracking-widest px-2"
                            style={{
                              minHeight: 36,
                              background: 'var(--ivy)',
                              color: 'var(--bone)',
                            }}
                          >
                            ✓ SAVE REWRITE
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(null)}
                            className="ink-border ticker text-[9px] tracking-widest px-2"
                            style={{
                              minHeight: 36,
                              background: 'var(--bone)',
                              color: 'var(--ink)',
                            }}
                          >
                            ✕ CANCEL
                          </button>
                          <span className="ticker text-[10px] tracking-widest opacity-60 ml-auto tabular-nums">
                            {editing.text.trim().length}/{host?.questionCharLimit ?? 280}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p
                        className="font-editorial text-lg leading-snug mt-1"
                        style={{ wordBreak: 'break-word' }}
                      >
                        {q.text}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <p className="ticker text-[10px] tracking-widest opacity-60">
                        {q.isAnonymous ? 'ANONYMOUS' : (q.authorDisplayName ?? 'ANONYMOUS')} ·{' '}
                        {new Date(q.submittedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setReplyThreadId((id) => (id === q.id ? null : q.id));
                          setReplyDraft('');
                          setReplyEditing(null);
                        }}
                        aria-expanded={replyThreadId === q.id}
                        aria-label={`${replyThreadId === q.id ? 'Close' : 'Open'} reply thread: ${q.text}`}
                        className="ticker text-[10px] tracking-widest px-2 py-[2px] ink-border opacity-70 hover:opacity-100"
                      >
                        {replyThreadId === q.id
                          ? '✕ THREAD'
                          : `↩ REPLY${q.replyCount > 0 ? ` (${q.replyCount})` : ''}`}
                      </button>
                    </div>
                    {/* Reply desk (MID-341): thread + composer. Replies to an
                        in-review question are a private desk note to the
                        submitter; approval makes the whole thread public. */}
                    {replyThreadId === q.id && (
                      <div
                        className="mt-2 ink-border px-3 py-2"
                        style={{ background: 'var(--bone)' }}
                      >
                        {q.status === 'IN_REVIEW' && (
                          <p
                            className="ticker text-[10px] tracking-widest px-2 py-[2px] ink-border inline-block"
                            style={{ background: 'var(--marigold)', color: 'var(--ink)' }}
                          >
                            ◆ PRIVATE NOTE · ONLY THE SUBMITTER SEES THIS UNTIL APPROVAL
                          </p>
                        )}
                        {q.replies.length > 0 && (
                          <ul className="mt-2">
                            {q.replies.map((r) => (
                              <li
                                key={r.id}
                                className="py-2 border-b last:border-b-0"
                                style={{ borderColor: 'rgba(15,15,15,.14)' }}
                              >
                                {replyEditing?.replyId === r.id ? (
                                  <div>
                                    <textarea
                                      value={replyEditing.text}
                                      onChange={(e) =>
                                        setReplyEditing((prev) =>
                                          prev ? { ...prev, text: e.target.value } : prev,
                                        )
                                      }
                                      maxLength={QA_HOST_REPLY_CHAR_LIMIT}
                                      rows={2}
                                      aria-label="Edit reply text"
                                      className="w-full ink-border font-editorial text-[15px] leading-snug p-2 bg-transparent outline-none resize-y"
                                      style={{ background: 'var(--bone)' }}
                                    />
                                    <div className="mt-1 flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={saveReplyEdit}
                                        className="ink-border stamp ticker text-[9px] tracking-widest px-2"
                                        style={{
                                          minHeight: 36,
                                          background: 'var(--ivy)',
                                          color: 'var(--bone)',
                                        }}
                                      >
                                        ✓ SAVE REPLY
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setReplyEditing(null)}
                                        className="ink-border ticker text-[9px] tracking-widest px-2"
                                        style={{
                                          minHeight: 36,
                                          background: 'var(--bone)',
                                          color: 'var(--ink)',
                                        }}
                                      >
                                        ✕ CANCEL
                                      </button>
                                      <span className="ticker text-[10px] tracking-widest opacity-60 ml-auto tabular-nums">
                                        {replyEditing.text.trim().length}/{QA_HOST_REPLY_CHAR_LIMIT}
                                      </span>
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span
                                        className="ticker text-[9px] tracking-widest px-2 py-[2px] ink-border"
                                        style={
                                          r.isHostReply
                                            ? { background: 'var(--ink)', color: 'var(--bone)' }
                                            : { background: 'var(--bone)', color: 'var(--ink)' }
                                        }
                                      >
                                        {r.isHostReply ? '◼ THE DESK' : '◻ AUDIENCE'}
                                      </span>
                                      <span className="ticker text-[10px] tracking-widest opacity-50">
                                        {new Date(r.createdAt).toLocaleTimeString([], {
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })}
                                      </span>
                                      {r.isHostReply && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setReplyEditing({
                                              questionId: q.id,
                                              replyId: r.id,
                                              text: r.text,
                                            })
                                          }
                                          aria-label={`Edit reply: ${r.text}`}
                                          className="ticker text-[10px] tracking-widest px-2 py-[2px] ink-border opacity-60 hover:opacity-100 ml-auto"
                                        >
                                          ✎ EDIT
                                        </button>
                                      )}
                                    </div>
                                    <p
                                      className="font-editorial text-[15px] leading-snug mt-1"
                                      style={{ wordBreak: 'break-word' }}
                                    >
                                      {r.text}
                                    </p>
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="mt-2">
                          <textarea
                            value={replyDraft}
                            onChange={(e) => setReplyDraft(e.target.value)}
                            maxLength={QA_HOST_REPLY_CHAR_LIMIT}
                            rows={2}
                            placeholder={
                              q.status === 'IN_REVIEW'
                                ? 'Write a private reply to the submitter…'
                                : 'Write a reply for the room…'
                            }
                            aria-label="Write a reply"
                            className="w-full ink-border font-editorial text-[15px] leading-snug p-2 bg-transparent outline-none resize-y"
                            style={{ background: 'var(--bone)' }}
                          />
                          <div className="mt-1 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => sendReply(q)}
                              className="ink-border stamp ticker text-[9px] tracking-widest px-2"
                              style={{
                                minHeight: 36,
                                background: 'var(--vermilion)',
                                color: 'var(--bone)',
                              }}
                            >
                              ↩ SEND REPLY
                            </button>
                            <span className="ticker text-[10px] tracking-widest opacity-60 ml-auto tabular-nums">
                              {replyDraft.trim().length}/{QA_HOST_REPLY_CHAR_LIMIT}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
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
                      <div className="flex gap-1 flex-wrap justify-end">
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
                        <button
                          type="button"
                          onClick={() => setEditing({ id: q.id, text: q.text })}
                          aria-label={`Edit question: ${q.text}`}
                          className="ink-border ticker text-[9px] tracking-widest px-2"
                          style={{ minHeight: 36, background: 'var(--bone)', color: 'var(--ink)' }}
                        >
                          ✎ EDIT
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-1 flex-wrap justify-end">
                        <button
                          type="button"
                          onClick={() => toggleHighlight(q)}
                          aria-pressed={q.highlighted}
                          aria-label={
                            q.highlighted
                              ? `Take question off air: ${q.text}`
                              : `Put question on air: ${q.text}`
                          }
                          className="ink-border stamp ticker text-[9px] tracking-widest px-2"
                          style={{
                            minHeight: 36,
                            background: q.highlighted ? 'var(--ink)' : 'var(--vermilion)',
                            color: 'var(--bone)',
                          }}
                        >
                          {q.highlighted ? '★ OFF AIR' : '★ ON AIR'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing({ id: q.id, text: q.text })}
                          aria-label={`Edit question: ${q.text}`}
                          className="ink-border ticker text-[9px] tracking-widest px-2"
                          style={{ minHeight: 36, background: 'var(--bone)', color: 'var(--ink)' }}
                        >
                          ✎ EDIT
                        </button>
                        <button
                          type="button"
                          onClick={() => moderate('answered', q.id)}
                          aria-label={`Mark question answered: ${q.text}`}
                          className="ink-border stamp ticker text-[9px] tracking-widest px-2"
                          style={{ minHeight: 36, background: 'var(--ivy)', color: 'var(--bone)' }}
                        >
                          ✓ ANSWERED
                        </button>
                        <button
                          type="button"
                          onClick={() => moderate('archive', q.id)}
                          aria-label={`Archive question: ${q.text}`}
                          className="ink-border ticker text-[9px] tracking-widest px-2"
                          style={{ minHeight: 36, background: 'var(--bone)', color: 'var(--ink)' }}
                        >
                          ▣ ARCHIVE
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>

          {/* Filed pile (MID-339): answered + archived questions, host-only,
              restorable to the live board. Never part of the public
              projection — this list only exists in qa:host:state. */}
          {filed.length > 0 && (
            <div className="mt-4 pt-3 border-t-2" style={{ borderColor: 'var(--ink)' }}>
              <button
                type="button"
                onClick={() => setShowFiled((v) => !v)}
                aria-expanded={showFiled}
                className="ticker text-[11px] tracking-widest flex items-center gap-2"
                style={{ minHeight: 44 }}
              >
                <span aria-hidden>{showFiled ? '▾' : '▸'}</span>
                THE ARCHIVE · {String(filed.length).padStart(2, '0')} FILED
              </button>
              {showFiled && (
                <ul className="mt-2">
                  {filed.map((q) => (
                    <li
                      key={q.id}
                      className="py-2 border-b last:border-b-0 flex items-start gap-3"
                      style={{ borderColor: 'rgba(15,15,15,.18)', opacity: 0.85 }}
                    >
                      <div className="flex-1 min-w-0">
                        <span
                          className="ticker text-[10px] tracking-widest px-2 py-[2px] ink-border"
                          style={
                            q.status === 'ANSWERED'
                              ? { background: 'var(--ivy)', color: 'var(--bone)' }
                              : { background: 'var(--ash)', color: 'var(--ink)' }
                          }
                        >
                          {q.status === 'ANSWERED' ? '✓ ANSWERED' : '▣ ARCHIVED'}
                        </span>
                        <p
                          className="font-editorial text-base leading-snug mt-1"
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
                          {' · '}▲ {q.score}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => moderate('restore', q.id)}
                        aria-label={`Restore question to the live board: ${q.text}`}
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
