'use client';

// Q&A participant surface (MID-335). Mobile-first: submit a question with a
// live character count, toggle anonymous/named when the privacy mode allows,
// and manage your own questions (status badges, withdraw, edit). Public board
// state arrives over `qa:state`; personal state only ever arrives in acks
// targeted at this socket (never broadcast to the room).
//
// Labels (MID-340): participants only ever see participant-selectable labels
// — host-only labels stay off this surface entirely (selector, chips, and
// filter all filter on the flag).

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, FrameCounter, SmpteBars } from '@/components/Broadcast';
import { validateQuestionInput } from '@/lib/qa-input';
import { useSocket } from '@/lib/socket';
import type {
  QAPersonalQuestion,
  QAPersonalState,
  QAPrivacyMode,
  QAPublicReply,
  QAQuestionScore,
  QAQuestionStatus,
  QAVoteType,
} from '@/lib/types';

type PublicQuestion = {
  id: string;
  text: string;
  isAnonymous: boolean;
  authorDisplayName: string | null;
  score: number;
  upvotes: number;
  downvotes: number;
  labelIds: string[];
  replyCount: number;
  replies: QAPublicReply[];
  highlighted: boolean;
  submittedAt: number;
};

type PublicLabel = {
  id: string;
  name: string;
  participantSelectable: boolean;
};

type PublicSnapshot = {
  pin: string;
  title: string;
  description: string | null;
  privacyMode: QAPrivacyMode;
  status: 'OPEN' | 'CLOSED' | 'ENDED';
  submissionsOpen: boolean;
  votingOpen: boolean;
  downvotesEnabled: boolean;
  participantRepliesEnabled: boolean;
  questionCharLimit: number;
  questionCount: number;
  participantCount: number;
  labels: PublicLabel[];
  questions: PublicQuestion[];
};

type JoinAck =
  | {
      participantId: string;
      reconnected: boolean;
      state: PublicSnapshot;
      personal: QAPersonalState;
    }
  | { error: string };

type ActionAck =
  | { questionId: string; status: QAQuestionStatus; personal: QAPersonalState }
  | { error: string };

type VoteAck =
  | {
      questionId: string;
      vote: QAVoteType | null;
      score: number;
      upvotes: number;
      downvotes: number;
    }
  | { error: string };

type ReplyAck = { ok: true; questionId: string; reply: QAPublicReply } | { error: string };

// Mirrors QA_SUBMIT_RATE_LIMIT_MS in server.ts so the button re-enables right
// as the server window reopens.
const COOLDOWN_MS = 1000;

function ackErrorMessage(error: string | undefined, charLimit: number): string {
  switch (error) {
    case 'rate_limited':
      return 'Easy — give it a second between questions.';
    case 'submissions_closed':
      return 'Questions are closed.';
    case 'empty_text':
      return 'Type a question first.';
    case 'text_too_long':
      return `Keep it under ${charLimit} characters.`;
    case 'name_required':
      return 'This room needs a name to post as yourself.';
    case 'session_ended':
      return 'This Q&A has ended.';
    case 'not_owner':
      return "That question isn't yours.";
    case 'invalid_transition':
    case 'invalid_status':
      return 'That question can no longer be changed.';
    case 'voting_closed':
      return 'Voting is closed.';
    case 'not_live':
    case 'unknown_question':
      return "That question isn't on the board anymore.";
    case 'downvotes_disabled':
      return 'Downvotes are off in this room.';
    case 'unknown_label':
    case 'label_not_selectable':
      return "That label isn't available — refresh and pick again.";
    case 'replies_disabled':
      return 'Replies are off in this room.';
    default:
      return "Couldn't send — try again.";
  }
}

// Popular order (PRD §4.7 default): score first, earliest submission breaks
// ties — same comparator as the server's publicState projection, so the board
// can re-sort locally from qa:scores deltas without a full snapshot.
function byPopular(a: PublicQuestion, b: PublicQuestion): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.submittedAt - b.submittedAt;
}

const STATUS_BADGES: Record<QAQuestionStatus, { label: string; bg: string; fg: string }> = {
  IN_REVIEW: {
    label: 'WAITING FOR REVIEW',
    bg: 'var(--marigold)',
    fg: 'var(--ink)',
  },
  LIVE: { label: 'LIVE', bg: 'var(--vermilion)', fg: 'var(--bone)' },
  ANSWERED: { label: 'ANSWERED', bg: 'var(--ivy)', fg: 'var(--bone)' },
  ARCHIVED: { label: 'ARCHIVED', bg: 'var(--ash)', fg: 'var(--ink)' },
  DISMISSED: { label: 'DISMISSED', bg: 'var(--ink)', fg: 'var(--bone)' },
  WITHDRAWN: { label: 'WITHDRAWN', bg: 'var(--ash)', fg: 'var(--ink)' },
};

export default function QAndAPlayerPage({ params }: { params: Promise<{ pin: string }> }) {
  const socket = useSocket();
  const [pin, setPin] = useState('');
  const [phase, setPhase] = useState<'connecting' | 'name' | 'in' | 'gone'>('connecting');
  const [goneMessage, setGoneMessage] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [pub, setPub] = useState<PublicSnapshot | null>(null);
  const [personal, setPersonal] = useState<QAPersonalState | null>(null);
  const [draft, setDraft] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  // Labels (MID-340): chips picked for the next submission, and the board
  // filter. Both only ever hold participant-selectable label ids.
  const [draftLabelIds, setDraftLabelIds] = useState<string[]>([]);
  const [labelFilter, setLabelFilter] = useState<string>('');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const [confirmWithdrawId, setConfirmWithdrawId] = useState<string | null>(null);
  // Reply threads (MID-341): one open thread at a time with a local draft, so
  // live board re-sorts never clobber what the participant is typing.
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');

  const participantIdRef = useRef<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const confirmTimerRef = useRef<number | null>(null);
  const anonymousInitRef = useRef(false);

  useEffect(() => {
    params.then((p) => setPin(p.pin));
  }, [params]);

  useEffect(() => {
    if (!pin) return;
    participantIdRef.current = sessionStorage.getItem(`bc:qa:participant:${pin}`);
    setNameDraft(sessionStorage.getItem(`bc:nick:${pin}`) ?? '');
  }, [pin]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(
    () => () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
    },
    [],
  );

  // Tick while a cooldown is active so the submit button re-enables on time.
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, [cooldownUntil]);

  // Default the anonymous toggle from the session's privacy mode, once.
  useEffect(() => {
    if (!pub || anonymousInitRef.current) return;
    anonymousInitRef.current = true;
    setAnonymous(pub.privacyMode !== 'NAMED_BY_DEFAULT' && pub.privacyMode !== 'NAME_REQUIRED');
  }, [pub]);

  // Drop stale label picks/filters if a label vanished or stopped being
  // participant-selectable while we were composing.
  useEffect(() => {
    if (!pub) return;
    const selectable = new Set(pub.labels.filter((l) => l.participantSelectable).map((l) => l.id));
    setDraftLabelIds((prev) => {
      const next = prev.filter((id) => selectable.has(id));
      return next.length === prev.length ? prev : next;
    });
    setLabelFilter((prev) => (prev && !selectable.has(prev) ? '' : prev));
  }, [pub]);

  const join = useCallback(
    (displayName?: string) => {
      if (!socket || !pin) return;
      const storedNick =
        displayName ?? sessionStorage.getItem(`bc:nick:${pin}`)?.trim() ?? undefined;
      socket.emit(
        'qa:participant:join',
        {
          pin,
          displayName: storedNick || undefined,
          participantId: participantIdRef.current ?? undefined,
        },
        (res: JoinAck) => {
          if ('error' in res) {
            if (res.error === 'name_required') {
              setPhase('name');
              return;
            }
            if (res.error === 'session_ended') {
              setGoneMessage('This Q&A has ended. Thanks for tuning in.');
            } else if (res.error === 'not_found') {
              setGoneMessage("That session isn't on the air.");
            } else {
              setGoneMessage("Couldn't join — try again from /join.");
            }
            setPhase('gone');
            return;
          }
          participantIdRef.current = res.participantId;
          sessionStorage.setItem(`bc:qa:participant:${pin}`, res.participantId);
          setPub(res.state);
          setPersonal(res.personal);
          setPhase('in');
        },
      );
    },
    [socket, pin],
  );

  useEffect(() => {
    if (!socket || !pin) return;
    const onState = (s: PublicSnapshot) => {
      if (s.pin !== pin) return;
      setPub(s);
    };
    // Coalesced vote deltas: patch the affected questions' counts in place;
    // the render path re-sorts by popularity, so the order updates live.
    const onScores = (delta: { pin: string; scores: QAQuestionScore[] }) => {
      if (delta.pin !== pin) return;
      setPub((prev) => {
        if (!prev) return prev;
        const byId = new Map(delta.scores.map((s) => [s.questionId, s]));
        return {
          ...prev,
          questions: prev.questions.map((q) => {
            const s = byId.get(q.id);
            return s
              ? {
                  ...q,
                  score: s.score,
                  upvotes: s.upvotes,
                  downvotes: s.downvotes,
                }
              : q;
          }),
        };
      });
    };
    // Targeted personal push (MID-338): host moderation (approve/dismiss/
    // restore) refreshes this participant's own-questions panel without a
    // round-trip. Only ever emitted at this socket — never the room.
    const onPersonal = (p: QAPersonalState) => {
      if (p.participantId === participantIdRef.current) setPersonal(p);
    };
    const onConnect = () => join();
    socket.on('qa:state', onState);
    socket.on('qa:scores', onScores);
    socket.on('qa:personal', onPersonal);
    socket.on('connect', onConnect);
    if (socket.connected) join();
    return () => {
      socket.off('qa:state', onState);
      socket.off('qa:scores', onScores);
      socket.off('qa:personal', onPersonal);
      socket.off('connect', onConnect);
    };
  }, [socket, pin, join]);

  const charLimit = pub?.questionCharLimit ?? 280;
  const cooldownRemaining = Math.max(0, cooldownUntil - now);
  const remaining = charLimit - draft.trim().length;
  const canSubmit =
    !!socket && !!pub && pub.submissionsOpen && cooldownRemaining === 0 && phase === 'in';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setInlineError(null);
    if (!socket || !pin || !canSubmit) return;
    const result = validateQuestionInput(draft, charLimit);
    if (!result.ok) {
      setInlineError(
        result.reason === 'text_too_long'
          ? `Keep it under ${charLimit} characters.`
          : 'Type a question first.',
      );
      return;
    }
    setCooldownUntil(Date.now() + COOLDOWN_MS);
    setNow(Date.now());
    // Send the effective identity: forced modes and missing names override
    // the toggle (the server enforces the same rules; this avoids a
    // guaranteed name_required rejection).
    const forced = pub?.privacyMode === 'ALWAYS_ANONYMOUS' || !personal?.displayName;
    const isAnonymous = pub?.privacyMode === 'NAME_REQUIRED' ? false : forced || anonymous;
    socket.emit(
      'qa:participant:submit',
      {
        pin,
        text: result.value,
        isAnonymous,
        ...(draftLabelIds.length > 0 ? { labelIds: draftLabelIds } : {}),
      },
      (res: ActionAck) => {
        if ('error' in res) {
          showToast(ackErrorMessage(res.error, charLimit));
          return;
        }
        setPersonal(res.personal);
        setDraft('');
        setDraftLabelIds([]);
        showToast(res.status === 'IN_REVIEW' ? 'Sent — waiting for review.' : "It's live.");
      },
    );
  }

  function handleWithdraw(questionId: string) {
    if (!socket || !pin) return;
    // Withdraw is terminal — two-tap confirm instead of a modal.
    if (confirmWithdrawId !== questionId) {
      setConfirmWithdrawId(questionId);
      if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = window.setTimeout(() => setConfirmWithdrawId(null), 3000);
      return;
    }
    setConfirmWithdrawId(null);
    socket.emit('qa:participant:withdraw', { pin, questionId }, (res: ActionAck) => {
      if ('error' in res) {
        showToast(ackErrorMessage(res.error, charLimit));
        return;
      }
      setPersonal(res.personal);
      showToast('Question withdrawn.');
    });
  }

  function handleEditSave() {
    if (!socket || !pin || !editing) return;
    const result = validateQuestionInput(editing.draft, charLimit);
    if (!result.ok) {
      showToast(
        result.reason === 'text_too_long'
          ? `Keep it under ${charLimit} characters.`
          : 'Type a question first.',
      );
      return;
    }
    socket.emit(
      'qa:participant:edit',
      { pin, questionId: editing.id, text: result.value },
      (res: ActionAck) => {
        if ('error' in res) {
          showToast(ackErrorMessage(res.error, charLimit));
          return;
        }
        setPersonal(res.personal);
        setEditing(null);
        showToast(res.status === 'IN_REVIEW' ? 'Updated — back in review.' : 'Question updated.');
      },
    );
  }

  // Reply to a live question (MID-341, PRD §4.8). Replies share the server's
  // submit throttle, so posting one arms the same local cooldown as a
  // question. The qa:state broadcast brings the new reply back to the board.
  function handleReply(questionId: string) {
    if (!socket || !pin || !pub) return;
    const result = validateQuestionInput(replyDraft, charLimit);
    if (!result.ok) {
      showToast(
        result.reason === 'text_too_long'
          ? `Keep it under ${charLimit} characters.`
          : 'Type a reply first.',
      );
      return;
    }
    setCooldownUntil(Date.now() + COOLDOWN_MS);
    setNow(Date.now());
    socket.emit(
      'qa:participant:reply',
      { pin, questionId, text: result.value },
      (res: ReplyAck) => {
        if ('error' in res) {
          showToast(ackErrorMessage(res.error, charLimit));
          return;
        }
        setReplyDraft('');
        showToast('Reply posted.');
      },
    );
  }

  // Local vote flip for optimistic feedback (and rollback on rejection). The
  // server ack and qa:scores deltas remain the source of truth.
  const applyLocalVote = useCallback(
    (questionId: string, from: QAVoteType | null, to: QAVoteType | null) => {
      if (from === to) return;
      setPersonal((prev) => {
        if (!prev) return prev;
        const votes = { ...prev.votes };
        if (to === null) delete votes[questionId];
        else votes[questionId] = to;
        return { ...prev, votes };
      });
      setPub((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          questions: prev.questions.map((q) => {
            if (q.id !== questionId) return q;
            let { upvotes, downvotes } = q;
            if (from === 'UP') upvotes -= 1;
            if (from === 'DOWN') downvotes -= 1;
            if (to === 'UP') upvotes += 1;
            if (to === 'DOWN') downvotes += 1;
            return { ...q, upvotes, downvotes, score: upvotes - downvotes };
          }),
        };
      });
    },
    [],
  );

  function handleVote(questionId: string, control: QAVoteType) {
    if (!socket || !pin || !pub) return;
    if (!pub.votingOpen || pub.status === 'ENDED') {
      showToast('Voting is closed.');
      return;
    }
    const current = personal?.votes[questionId] ?? null;
    // Tapping the active control removes the vote; the other one switches it.
    const next = current === control ? null : control;
    applyLocalVote(questionId, current, next);
    socket.emit('qa:participant:vote', { pin, questionId, type: next }, (res: VoteAck) => {
      if ('error' in res) {
        applyLocalVote(questionId, next, current);
        showToast(ackErrorMessage(res.error, charLimit));
        return;
      }
      // Reconcile with the server-derived truth (counts may include other
      // participants' votes that landed since the optimistic flip).
      setPersonal((prev) => {
        if (!prev) return prev;
        const votes = { ...prev.votes };
        if (res.vote === null) delete votes[res.questionId];
        else votes[res.questionId] = res.vote;
        return { ...prev, votes };
      });
      setPub((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          questions: prev.questions.map((q) =>
            q.id === res.questionId
              ? {
                  ...q,
                  score: res.score,
                  upvotes: res.upvotes,
                  downvotes: res.downvotes,
                }
              : q,
          ),
        };
      });
    });
  }

  if (phase === 'gone') {
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <div className="max-w-md text-center">
          <p className="chyron mb-3" style={{ color: 'var(--vermilion)' }}>
            SIGNAL LOST
          </p>
          <p className="font-editorial text-xl mb-4">{goneMessage}</p>
          <Link
            href="/join"
            className="ink-border stamp ticker text-[12px] tracking-widest px-4 py-3 inline-block"
            style={{ background: 'var(--vermilion)', color: 'var(--bone)' }}
          >
            ↩ HEAD TO /JOIN
          </Link>
        </div>
      </main>
    );
  }

  if (phase === 'name') {
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <form
          className="max-w-md w-full"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = nameDraft.trim();
            if (!trimmed) return;
            sessionStorage.setItem(`bc:nick:${pin}`, trimmed);
            setPhase('connecting');
            join(trimmed);
          }}
        >
          <p className="chyron mb-2" style={{ color: 'var(--vermilion)' }}>
            CREDENTIAL REQUIRED
          </p>
          <p className="font-editorial text-xl mb-4">
            This Q&A needs a name before you can take the mic.
          </p>
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value.slice(0, 20))}
            placeholder="Your name"
            aria-label="Your name"
            className="w-full ink-border bg-transparent font-editorial text-xl px-4 py-3"
            style={{ background: 'var(--bone)', minHeight: 56 }}
          />
          <button
            type="submit"
            className="w-full mt-3 ink-border stamp ticker tracking-widest text-[13px] py-4"
            style={{
              background: 'var(--vermilion)',
              color: 'var(--bone)',
              minHeight: 56,
            }}
          >
            ▶ CHECK IN
          </button>
        </form>
      </main>
    );
  }

  if (phase === 'connecting' || !pub || !personal) {
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <p className="ticker text-[12px] tracking-widest opacity-70">TUNING IN…</p>
      </main>
    );
  }

  const ended = pub.status === 'ENDED';
  const myQuestions = [...personal.questions].sort((a, b) => b.submittedAt - a.submittedAt);
  // Participants only ever see participant-selectable labels — host-only
  // labels never render on this surface (PRD §4.1 / §4.7).
  const selectableLabels = pub.labels.filter((l) => l.participantSelectable);
  const labelNames = new Map(selectableLabels.map((l) => [l.id, l.name]));
  const boardQuestions = (
    labelFilter ? pub.questions.filter((q) => q.labelIds.includes(labelFilter)) : pub.questions
  )
    .slice()
    .sort(byPopular);
  const votingEnabled = pub.votingOpen && !ended;
  const canToggleIdentity =
    !!personal.displayName &&
    (pub.privacyMode === 'ANONYMOUS_BY_DEFAULT' || pub.privacyMode === 'NAMED_BY_DEFAULT');
  const forcedAnonymous = pub.privacyMode === 'ALWAYS_ANONYMOUS' || !personal.displayName;
  const effectiveAnonymous = forcedAnonymous || (pub.privacyMode !== 'NAME_REQUIRED' && anonymous);

  return (
    <main className="relative min-h-[100dvh] pb-10 flex flex-col">
      {toast && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 ink-border stamp ticker text-[11px] tracking-widest px-3 py-2"
          style={{ background: 'var(--ink)', color: 'var(--bone)' }}
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      )}

      <header className="px-5 pt-4 flex items-center justify-between gap-3">
        <span className="chyron" style={{ color: 'var(--vermilion)' }}>
          AUDIENCE Q&A
        </span>
        <div className="flex items-center gap-4">
          <FrameCounter index={pub.questionCount} />
          <Clock />
        </div>
      </header>
      <SmpteBars className="h-1.5 mt-3" />

      <div className="px-5 pt-4 max-w-[680px] mx-auto w-full flex-1 flex flex-col">
        <div
          className="flex items-center justify-between border-b-2 pb-2"
          style={{ borderColor: 'var(--ink)' }}
        >
          <span className="font-editorial text-lg">
            <span className="opacity-60">ID·</span>
            <span className="ml-1">{personal.displayName ?? 'ANONYMOUS'}</span>
          </span>
          <span className="ticker text-[11px] tracking-widest opacity-70">PIN {pin}</span>
        </div>

        <section className="pt-5">
          <p className="chyron" style={{ color: 'var(--vermilion)' }}>
            ON THE DESK
          </p>
          <h1
            className="font-editorial leading-tight mt-2"
            style={{ fontSize: 'clamp(28px, 7vw, 44px)' }}
          >
            {pub.title}
          </h1>
          {pub.description && (
            <p className="font-editorial italic text-[15px] mt-2 opacity-80">{pub.description}</p>
          )}
        </section>

        {ended ? (
          <EndedState />
        ) : pub.submissionsOpen ? (
          <form onSubmit={handleSubmit} className="pt-6 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span
                className="ticker text-[11px] tracking-widest px-2 py-[2px] ink-border"
                style={{ background: 'var(--vermilion)', color: 'var(--bone)' }}
              >
                CUE · YOUR QUESTION
              </span>
              <span
                className="ticker tabular-nums text-[11px] tracking-widest"
                style={{
                  opacity: remaining < 0 ? 1 : 0.7,
                  color: remaining < 0 ? 'var(--vermilion)' : undefined,
                }}
              >
                {remaining} LEFT
              </span>
            </div>

            <label className="block">
              <span className="sr-only">Your question</span>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type your question"
                aria-label="Your question"
                rows={3}
                className="w-full mt-1 ink-border bg-transparent font-editorial px-4 py-3 resize-none"
                style={{
                  // 16px+ avoids the iOS Safari focus-zoom.
                  fontSize: '18px',
                  background: 'var(--bone)',
                  minHeight: 96,
                }}
              />
            </label>

            {inlineError && (
              <p
                className="ticker text-[11px] tracking-widest"
                role="alert"
                style={{ color: 'var(--vermilion)' }}
              >
                ⚠ {inlineError}
              </p>
            )}

            <IdentityRow
              canToggle={canToggleIdentity}
              anonymous={effectiveAnonymous}
              displayName={personal.displayName}
              privacyMode={pub.privacyMode}
              onToggle={() => setAnonymous((a) => !a)}
            />

            {/* Label selector (MID-340): participant-selectable labels only.
                Multi-select chips; shape (filled/hollow) marks selection, not
                color alone. */}
            {selectableLabels.length > 0 && (
              <div>
                <span className="ticker text-[11px] tracking-widest opacity-60">
                  TAG IT · OPTIONAL
                </span>
                <div className="flex flex-wrap gap-2 mt-1">
                  {selectableLabels.map((label) => {
                    const active = draftLabelIds.includes(label.id);
                    return (
                      <button
                        key={label.id}
                        type="button"
                        onClick={() =>
                          setDraftLabelIds((prev) =>
                            active ? prev.filter((id) => id !== label.id) : [...prev, label.id],
                          )
                        }
                        aria-pressed={active}
                        className="ink-border ticker text-[11px] tracking-widest px-3"
                        style={{
                          minHeight: 44,
                          background: active ? 'var(--ink)' : 'var(--bone)',
                          color: active ? 'var(--bone)' : 'var(--ink)',
                        }}
                      >
                        {active ? '◼' : '◻'} {label.name.toUpperCase()}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="ink-border stamp ticker text-[14px] tracking-widest"
              style={{
                background: canSubmit ? 'var(--vermilion)' : 'var(--ash)',
                color: canSubmit ? 'var(--bone)' : 'var(--ink)',
                minHeight: 64,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              {cooldownRemaining > 0 ? 'HOLD…' : '▶  ASK IT'}
            </button>
          </form>
        ) : (
          <div className="mt-6 ink-border px-4 py-5" style={{ background: 'var(--bone)' }}>
            <p className="ticker text-[11px] tracking-widest opacity-80">
              {pub.votingOpen
                ? 'QUESTIONS CLOSED · THE HOST IS WORKING THE BOARD'
                : 'QUESTIONS AND VOTING CLOSED · THE HOST IS WORKING THE BOARD'}
            </p>
          </div>
        )}

        <section className="pt-8">
          <div className="flex items-center justify-between">
            <p className="chyron opacity-70">ON THE BOARD</p>
            <span className="ticker text-[11px] tracking-widest opacity-60">
              {votingEnabled ? 'POPULAR' : 'VOTING CLOSED'}
            </span>
          </div>
          {/* Label filter (PRD §4.7): participant-selectable labels only. */}
          {selectableLabels.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                type="button"
                onClick={() => setLabelFilter('')}
                aria-pressed={labelFilter === ''}
                className="ink-border ticker text-[11px] tracking-widest px-3"
                style={{
                  minHeight: 44,
                  background: labelFilter === '' ? 'var(--ink)' : 'var(--bone)',
                  color: labelFilter === '' ? 'var(--bone)' : 'var(--ink)',
                }}
              >
                ALL
              </button>
              {selectableLabels.map((label) => {
                const active = labelFilter === label.id;
                return (
                  <button
                    key={label.id}
                    type="button"
                    onClick={() => setLabelFilter(active ? '' : label.id)}
                    aria-pressed={active}
                    className="ink-border ticker text-[11px] tracking-widest px-3"
                    style={{
                      minHeight: 44,
                      background: active ? 'var(--ink)' : 'var(--bone)',
                      color: active ? 'var(--bone)' : 'var(--ink)',
                    }}
                  >
                    {label.name.toUpperCase()}
                  </button>
                );
              })}
            </div>
          )}
          {boardQuestions.length === 0 ? (
            <p className="font-editorial italic text-[15px] mt-3 opacity-70">
              {labelFilter
                ? 'Nothing on the board with that label — tap ALL to see everything.'
                : "The board is empty — questions land here once they're live."}
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {boardQuestions.map((q) => (
                <BoardQuestionCard
                  key={q.id}
                  question={q}
                  labelNames={labelNames}
                  myVote={personal.votes[q.id] ?? null}
                  votingEnabled={votingEnabled}
                  downvotesEnabled={pub.downvotesEnabled}
                  onVote={(control) => handleVote(q.id, control)}
                  threadOpen={openThreadId === q.id}
                  canReply={pub.participantRepliesEnabled && pub.submissionsOpen && !ended}
                  replyDraft={openThreadId === q.id ? replyDraft : ''}
                  charLimit={charLimit}
                  replyCoolingDown={cooldownRemaining > 0}
                  onToggleThread={() => {
                    setOpenThreadId((id) => (id === q.id ? null : q.id));
                    setReplyDraft('');
                  }}
                  onReplyDraftChange={setReplyDraft}
                  onReplySend={() => handleReply(q.id)}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="pt-8">
          <div className="flex items-center justify-between">
            <p className="chyron opacity-70">YOUR QUESTIONS</p>
            <span className="ticker tabular-nums text-[11px] tracking-widest opacity-60">
              {String(myQuestions.length).padStart(2, '0')} FILED
            </span>
          </div>
          {myQuestions.length === 0 ? (
            <p className="font-editorial italic text-[15px] mt-3 opacity-70">
              Nothing filed yet — ask the first one.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {myQuestions.map((q) => (
                <MyQuestionCard
                  key={q.id}
                  question={q}
                  ended={ended}
                  charLimit={charLimit}
                  editing={editing?.id === q.id ? editing : null}
                  confirmWithdraw={confirmWithdrawId === q.id}
                  onWithdraw={() => handleWithdraw(q.id)}
                  onEditStart={() => setEditing({ id: q.id, draft: q.text })}
                  onEditChange={(v) =>
                    setEditing((e) => (e && e.id === q.id ? { ...e, draft: v } : e))
                  }
                  onEditCancel={() => setEditing(null)}
                  onEditSave={handleEditSave}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function IdentityRow({
  canToggle,
  anonymous,
  displayName,
  privacyMode,
  onToggle,
}: {
  canToggle: boolean;
  anonymous: boolean;
  displayName: string | null;
  privacyMode: QAPrivacyMode;
  onToggle: () => void;
}) {
  if (canToggle) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="self-start ink-border ticker text-[11px] tracking-widest px-3 py-2"
        style={{ background: 'var(--bone)', minHeight: 44 }}
        aria-pressed={anonymous}
      >
        {anonymous ? '◼ ASKING ANONYMOUSLY' : `◻ ASKING AS ${displayName?.toUpperCase()}`}
        <span className="opacity-50 ml-2">· TAP TO SWITCH</span>
      </button>
    );
  }
  return (
    <p className="ticker text-[11px] tracking-widest opacity-60">
      {anonymous
        ? privacyMode === 'ALWAYS_ANONYMOUS'
          ? 'THIS ROOM IS ANONYMOUS · NO NAMES, EVER'
          : 'ASKING ANONYMOUSLY'
        : `ASKING AS ${displayName?.toUpperCase()}`}
    </p>
  );
}

// Public board card with the vote rail. Tap targets stay ≥44px for one-handed
// mobile use; the active vote is shown as a filled stamp (shape + fill, not
// color alone) and exposed via aria-pressed.
//
// Reply threads (MID-341, PRD §4.8): host replies on live questions are
// public to everyone, so the thread is readable whenever it has replies; the
// composer only appears when the host enabled participant replies (and
// submissions are open). Threads never render on projection displays.
function BoardQuestionCard({
  question,
  labelNames,
  myVote,
  votingEnabled,
  downvotesEnabled,
  onVote,
  threadOpen,
  canReply,
  replyDraft,
  charLimit,
  replyCoolingDown,
  onToggleThread,
  onReplyDraftChange,
  onReplySend,
}: {
  question: PublicQuestion;
  // Participant-selectable labels only — host-only label ids miss the map
  // and render nothing, so they never leak onto this surface.
  labelNames: ReadonlyMap<string, string>;
  myVote: QAVoteType | null;
  votingEnabled: boolean;
  downvotesEnabled: boolean;
  onVote: (control: QAVoteType) => void;
  threadOpen: boolean;
  canReply: boolean;
  replyDraft: string;
  charLimit: number;
  replyCoolingDown: boolean;
  onToggleThread: () => void;
  onReplyDraftChange: (v: string) => void;
  onReplySend: () => void;
}) {
  const author =
    question.isAnonymous || !question.authorDisplayName
      ? 'ANONYMOUS'
      : question.authorDisplayName.toUpperCase();
  const visibleLabels = question.labelIds.filter((id) => labelNames.has(id));
  const showThreadToggle = question.replyCount > 0 || canReply;
  return (
    <li
      className="ink-border px-4 py-3"
      style={{
        background: 'var(--bone)',
        borderLeft: question.highlighted ? '6px solid var(--vermilion)' : undefined,
      }}
    >
      <div className="flex items-stretch gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {question.highlighted && (
              <span
                className="ticker text-[10px] tracking-widest px-2 py-[2px] ink-border"
                style={{ background: 'var(--vermilion)', color: 'var(--bone)' }}
              >
                ON AIR
              </span>
            )}
            {visibleLabels.map((id) => (
              <span
                key={id}
                className="ticker text-[10px] tracking-widest px-2 py-[2px] ink-border opacity-80"
              >
                {labelNames.get(id)?.toUpperCase()}
              </span>
            ))}
            <span className="ticker text-[10px] tracking-widest opacity-50">{author}</span>
          </div>
          <p className="font-editorial text-[17px] leading-snug mt-2">{question.text}</p>
        </div>
        <div className="flex flex-col items-center justify-center gap-1 shrink-0">
          <VoteButton
            label="Upvote"
            glyph="▲"
            active={myVote === 'UP'}
            disabled={!votingEnabled}
            onClick={() => onVote('UP')}
          />
          <span className="ticker tabular-nums text-[13px] tracking-widest">
            <span className="sr-only">Score </span>
            {question.score}
          </span>
          {downvotesEnabled && (
            <VoteButton
              label="Downvote"
              glyph="▼"
              active={myVote === 'DOWN'}
              disabled={!votingEnabled}
              onClick={() => onVote('DOWN')}
            />
          )}
        </div>
      </div>
      {showThreadToggle && (
        <button
          type="button"
          onClick={onToggleThread}
          aria-expanded={threadOpen}
          className="mt-2 ink-border ticker text-[11px] tracking-widest px-3 py-2"
          style={{
            background: threadOpen ? 'var(--ink)' : 'var(--bone)',
            color: threadOpen ? 'var(--bone)' : 'var(--ink)',
            minHeight: 44,
          }}
        >
          {threadOpen
            ? '✕ CLOSE THREAD'
            : question.replyCount > 0
              ? `↩ ${question.replyCount} ${question.replyCount === 1 ? 'REPLY' : 'REPLIES'}`
              : '↩ REPLY'}
        </button>
      )}
      {threadOpen && (
        <div className="mt-2 ink-border px-3 py-2" style={{ background: 'var(--bone)' }}>
          {question.replies.length === 0 ? (
            <p className="font-editorial italic text-[14px] opacity-70">
              No replies yet — start the thread.
            </p>
          ) : (
            <ul>
              {question.replies.map((r) => (
                <li
                  key={r.id}
                  className="py-2 border-b last:border-b-0"
                  style={{ borderColor: 'rgba(15,15,15,.14)' }}
                >
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
                  </div>
                  <p
                    className="font-editorial text-[15px] leading-snug mt-1"
                    style={{ wordBreak: 'break-word' }}
                  >
                    {r.text}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {canReply && (
            <div className="mt-2">
              <textarea
                value={replyDraft}
                onChange={(e) => onReplyDraftChange(e.target.value)}
                placeholder="Add to the thread"
                aria-label="Your reply"
                rows={2}
                className="w-full ink-border bg-transparent font-editorial px-3 py-2 resize-none"
                style={{
                  fontSize: '16px',
                  background: 'var(--bone)',
                  minHeight: 64,
                }}
              />
              <div className="flex items-center justify-between mt-1">
                <span className="ticker tabular-nums text-[10px] tracking-widest opacity-60">
                  {charLimit - replyDraft.trim().length} LEFT
                </span>
                <button
                  type="button"
                  onClick={onReplySend}
                  disabled={replyCoolingDown}
                  className="ink-border stamp ticker text-[11px] tracking-widest px-3 py-2"
                  style={{
                    background: replyCoolingDown ? 'var(--ash)' : 'var(--ink)',
                    color: replyCoolingDown ? 'var(--ink)' : 'var(--bone)',
                    minHeight: 44,
                    cursor: replyCoolingDown ? 'not-allowed' : 'pointer',
                  }}
                >
                  {replyCoolingDown ? 'HOLD…' : '↩ REPLY'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function VoteButton({
  label,
  glyph,
  active,
  disabled,
  onClick,
}: {
  label: string;
  glyph: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      className={`ink-border ticker text-[14px] leading-none px-3 ${active ? 'stamp' : ''}`}
      style={{
        background: active ? 'var(--vermilion)' : 'var(--bone)',
        color: active ? 'var(--bone)' : 'var(--ink)',
        minHeight: 44,
        minWidth: 44,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {glyph}
    </button>
  );
}

function MyQuestionCard({
  question,
  ended,
  charLimit,
  editing,
  confirmWithdraw,
  onWithdraw,
  onEditStart,
  onEditChange,
  onEditCancel,
  onEditSave,
}: {
  question: QAPersonalQuestion;
  ended: boolean;
  charLimit: number;
  editing: { id: string; draft: string } | null;
  confirmWithdraw: boolean;
  onWithdraw: () => void;
  onEditStart: () => void;
  onEditChange: (v: string) => void;
  onEditCancel: () => void;
  onEditSave: () => void;
}) {
  const badge = STATUS_BADGES[question.status];
  // Server allows withdraw/edit only while pending or live (and not ENDED).
  const actionable = !ended && (question.status === 'IN_REVIEW' || question.status === 'LIVE');
  const settled = !actionable;
  return (
    <li
      className="ink-border px-4 py-3"
      style={{
        background: 'var(--bone)',
        opacity: settled && question.status !== 'ANSWERED' ? 0.65 : 1,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="ticker text-[10px] tracking-widest px-2 py-[2px] ink-border"
          style={{ background: badge.bg, color: badge.fg }}
        >
          {badge.label}
        </span>
        <span className="ticker text-[10px] tracking-widest opacity-50">
          {question.isAnonymous ? 'ANON' : 'NAMED'}
        </span>
      </div>

      {editing ? (
        <div className="mt-3">
          <textarea
            value={editing.draft}
            onChange={(e) => onEditChange(e.target.value)}
            rows={3}
            aria-label="Edit your question"
            className="w-full ink-border bg-transparent font-editorial px-3 py-2 resize-none"
            style={{ fontSize: '16px', background: 'var(--bone)' }}
          />
          <div className="flex items-center justify-between mt-2">
            <span className="ticker tabular-nums text-[10px] tracking-widest opacity-60">
              {charLimit - editing.draft.trim().length} LEFT
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onEditCancel}
                className="ink-border ticker text-[11px] tracking-widest px-3 py-2"
                style={{ background: 'var(--bone)', minHeight: 44 }}
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={onEditSave}
                className="ink-border stamp ticker text-[11px] tracking-widest px-3 py-2"
                style={{
                  background: 'var(--ink)',
                  color: 'var(--bone)',
                  minHeight: 44,
                }}
              >
                SAVE
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <p className="font-editorial text-[17px] leading-snug mt-2">{question.text}</p>
          {/* Replies on own questions (MID-341): private host replies arrive
              here while the question is in review — and stay readable even
              after a dismissal (PRD §4.3). */}
          {question.replies.length > 0 && (
            <div
              className="mt-2 pl-3 border-l-2"
              style={{
                borderColor: question.status === 'LIVE' ? 'var(--ink)' : 'var(--marigold)',
              }}
            >
              {question.status !== 'LIVE' && (
                <p className="ticker text-[10px] tracking-widest opacity-70">
                  ◆ PRIVATE · ONLY YOU SEE {question.replies.length === 1 ? 'THIS' : 'THESE'}
                </p>
              )}
              <ul>
                {question.replies.map((r) => (
                  <li key={r.id} className="py-1">
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
                    </div>
                    <p
                      className="font-editorial text-[15px] leading-snug mt-1"
                      style={{ wordBreak: 'break-word' }}
                    >
                      {r.text}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {actionable && (
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={onEditStart}
                className="ink-border ticker text-[11px] tracking-widest px-3 py-2"
                style={{ background: 'var(--bone)', minHeight: 44 }}
              >
                ✎ EDIT
              </button>
              <button
                type="button"
                onClick={onWithdraw}
                className="ink-border ticker text-[11px] tracking-widest px-3 py-2"
                style={{
                  background: confirmWithdraw ? 'var(--vermilion)' : 'var(--bone)',
                  color: confirmWithdraw ? 'var(--bone)' : 'var(--ink)',
                  minHeight: 44,
                }}
              >
                {confirmWithdraw ? 'TAP AGAIN TO WITHDRAW' : '✕ WITHDRAW'}
              </button>
            </div>
          )}
        </>
      )}
    </li>
  );
}

function EndedState() {
  return (
    <div className="pt-8">
      <p className="chyron mb-2" style={{ color: 'var(--vermilion)' }}>
        FADE OUT · TRANSMISSION ENDED
      </p>
      <p className="display-num" style={{ fontSize: 'clamp(40px, 11vw, 88px)', lineHeight: 0.9 }}>
        Q&A&nbsp;ENDED.
      </p>
      <p className="font-editorial italic text-lg mt-3 opacity-80">
        Thanks for the questions. The desk is closed.
      </p>
    </div>
  );
}
