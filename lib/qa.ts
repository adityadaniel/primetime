// In-memory state machine for the Q&A live activity (MID-332). Mirrors
// lib/wordcloud.ts: pure, server-authoritative transition helpers with no I/O,
// consumed by the socket layer (persist-before-broadcast) and rebuilt on
// restart by lib/qa-hydrate.ts.
//
// Privacy rule: anonymous questions never carry an author name, and the
// public projection never includes participant linkage. Personal projections
// are targeted at one participant and must never be broadcast.

import { QA_HOST_REPLY_CHAR_LIMIT, validateLabelName, validateQuestionInput } from './qa-input';
import type {
  QADisplaySettings,
  QAHostQuestion,
  QAHostState,
  QAPersonalQuestion,
  QAPersonalState,
  QAPrivacyMode,
  QAPublicQuestion,
  QAPublicReply,
  QAPublicState,
  QAQuestionStatus,
  QASessionStatus,
  QASettings,
  QAVoteType,
} from './types';

export const QA_DISPLAY_VISIBLE_COUNT_DEFAULT = 10;
export const QA_DISPLAY_VISIBLE_COUNT_MAX = 10;

export const DEFAULT_QA_DISPLAY_SETTINGS: QADisplaySettings = {
  sort: 'popular',
  labelFilter: null,
  visibleCount: QA_DISPLAY_VISIBLE_COUNT_DEFAULT,
  showTicker: true,
  highlightFullscreen: true,
};

export type QAParticipantEntry = {
  displayName: string | null;
};

export type QAReplyEntry = {
  id: string;
  // Null for host replies. Participant linkage is for personal state only.
  participantId: string | null;
  isHostReply: boolean;
  text: string;
  createdAt: number;
};

export type QAQuestionEntry = {
  id: string;
  // Owner linkage for withdraw/edit/personal views. Never projected publicly.
  participantId: string | null;
  text: string;
  // Preserved verbatim the first time the text is edited (audit/export).
  originalText: string | null;
  isAnonymous: boolean;
  authorDisplayName: string | null;
  status: QAQuestionStatus;
  submittedAt: number;
  approvedAt: number | null;
  answeredAt: number | null;
  archivedAt: number | null;
  dismissedAt: number | null;
  withdrawnAt: number | null;
  labelIds: Set<string>;
  // participantId -> vote type. Idempotency and up/down exclusivity fall out
  // of the map shape; score is always derived from this, never client-fed.
  votes: Map<string, QAVoteType>;
  replies: QAReplyEntry[];
};

export type QALabelEntry = {
  name: string;
  participantSelectable: boolean;
};

export type QAState = {
  pin: string;
  sessionId: string;
  settings: QASettings;
  status: QASessionStatus;
  hostUserId: string | null;
  hostSocketId?: string;
  displaySocketIds: Set<string>;
  participants: Map<string, QAParticipantEntry>;
  socketToParticipant: Map<string, string>;
  questions: Map<string, QAQuestionEntry>;
  labels: Map<string, QALabelEntry>;
  highlightedQuestionId: string | null;
  displaySettings: QADisplaySettings;
  // Synced with status: OPEN <-> true, CLOSED/ENDED -> false. Toggle via
  // setSubmissionsOpen/setSessionStatus only.
  submissionsOpen: boolean;
  votingOpen: boolean;
  createdAt: number;
};

export type QAErrorReason =
  | 'submissions_closed'
  | 'voting_closed'
  | 'empty_text'
  | 'text_too_long'
  | 'name_required'
  | 'unknown_participant'
  | 'unknown_question'
  | 'not_owner'
  | 'not_live'
  | 'invalid_transition'
  | 'invalid_status'
  | 'downvotes_disabled'
  | 'session_ended'
  | 'empty_label'
  | 'label_too_long'
  | 'duplicate_label'
  | 'unknown_label'
  | 'label_not_selectable'
  | 'replies_disabled'
  | 'unknown_reply'
  | 'not_host_reply';

export type QAError = { ok: false; reason: QAErrorReason };

const QUESTION_TRANSITIONS: Record<QAQuestionStatus, ReadonlySet<QAQuestionStatus>> = {
  // PRD §4.3: approve, dismiss, or let the owner withdraw a pending question.
  IN_REVIEW: new Set<QAQuestionStatus>(['LIVE', 'DISMISSED', 'WITHDRAWN']),
  // Answered/archived leave the live board; a moderated participant edit
  // sends a live question back to review; owners can withdraw.
  LIVE: new Set<QAQuestionStatus>(['ANSWERED', 'ARCHIVED', 'WITHDRAWN', 'IN_REVIEW']),
  ANSWERED: new Set<QAQuestionStatus>(['LIVE']),
  ARCHIVED: new Set<QAQuestionStatus>(['LIVE']),
  DISMISSED: new Set<QAQuestionStatus>(['IN_REVIEW']),
  // Withdrawn is terminal: the participant took it back.
  WITHDRAWN: new Set<QAQuestionStatus>(),
};

const SESSION_TRANSITIONS: Record<QASessionStatus, ReadonlySet<QASessionStatus>> = {
  OPEN: new Set<QASessionStatus>(['CLOSED', 'ENDED']),
  CLOSED: new Set<QASessionStatus>(['OPEN', 'ENDED']),
  // ENDED is terminal for live sockets — ARCHIVED is a DB-only concern.
  ENDED: new Set<QASessionStatus>(),
};

export function isValidQuestionTransition(from: QAQuestionStatus, to: QAQuestionStatus): boolean {
  return QUESTION_TRANSITIONS[from]?.has(to) ?? false;
}

export function isValidSessionTransition(from: QASessionStatus, to: QASessionStatus): boolean {
  return SESSION_TRANSITIONS[from]?.has(to) ?? false;
}

export function createQAState(args: {
  pin: string;
  sessionId: string;
  title: string;
  description?: string | null;
  privacyMode?: QAPrivacyMode;
  moderationEnabled?: boolean;
  participantRepliesEnabled?: boolean;
  downvotesEnabled?: boolean;
  questionCharLimit?: number;
  hostUserId?: string | null;
}): QAState {
  return {
    pin: args.pin,
    sessionId: args.sessionId,
    settings: {
      title: args.title,
      description: args.description ?? null,
      privacyMode: args.privacyMode ?? 'ANONYMOUS_BY_DEFAULT',
      moderationEnabled: args.moderationEnabled ?? false,
      participantRepliesEnabled: args.participantRepliesEnabled ?? false,
      downvotesEnabled: args.downvotesEnabled ?? false,
      questionCharLimit: args.questionCharLimit ?? 280,
    },
    status: 'OPEN',
    hostUserId: args.hostUserId ?? null,
    displaySocketIds: new Set(),
    participants: new Map(),
    socketToParticipant: new Map(),
    questions: new Map(),
    labels: new Map(),
    highlightedQuestionId: null,
    displaySettings: { ...DEFAULT_QA_DISPLAY_SETTINGS },
    submissionsOpen: true,
    votingOpen: true,
    createdAt: Date.now(),
  };
}

function genId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export type ResolveJoinIdentityResult = { ok: true; displayName: string | null } | QAError;

// Validates a join attempt against the session's privacy mode and returns the
// display name to store. Split out of addParticipant so the socket layer can
// validate BEFORE persisting the QAParticipant row (persist-before-accept).
export function resolveJoinIdentity(
  state: QAState,
  displayName?: string | null,
): ResolveJoinIdentityResult {
  if (state.status === 'ENDED') return { ok: false, reason: 'session_ended' };
  const trimmed = displayName?.trim() || null;
  if (state.settings.privacyMode === 'NAME_REQUIRED' && !trimmed) {
    return { ok: false, reason: 'name_required' };
  }
  // Always-anonymous sessions never store a name: anonymous means anonymous
  // to the host and export, not merely hidden.
  return {
    ok: true,
    displayName: state.settings.privacyMode === 'ALWAYS_ANONYMOUS' ? null : trimmed,
  };
}

export type AddParticipantResult = { ok: true; participantId: string } | QAError;

export function addParticipant(
  state: QAState,
  args: { displayName?: string | null; participantId?: string },
): AddParticipantResult {
  const identity = resolveJoinIdentity(state, args.displayName);
  if (!identity.ok) return identity;
  const participantId = args.participantId ?? genId('qap');
  state.participants.set(participantId, { displayName: identity.displayName });
  return { ok: true, participantId };
}

// Reconnect-safe socket binding: a participant returning on a new socket
// (page refresh, mobile sleep, HMR) rebinds without creating a duplicate
// participant. Stale socket entries for the same participant are dropped so
// personal state is never targeted at a dead socket id.
export function bindParticipantSocket(
  state: QAState,
  socketId: string,
  participantId: string,
): boolean {
  if (!state.participants.has(participantId)) return false;
  for (const [sid, pid] of state.socketToParticipant.entries()) {
    if (pid === participantId) state.socketToParticipant.delete(sid);
  }
  state.socketToParticipant.set(socketId, participantId);
  return true;
}

// Delegates to the shared lib/qa-input.ts validator so the participant page
// and the server enforce identical rules.
function validateText(state: QAState, raw: string): { ok: true; text: string } | QAError {
  const result = validateQuestionInput(raw, state.settings.questionCharLimit);
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, text: result.value };
}

function resolveAnonymity(mode: QAPrivacyMode, requested: boolean | undefined): boolean {
  switch (mode) {
    case 'ALWAYS_ANONYMOUS':
      return true;
    case 'NAME_REQUIRED':
      return false;
    case 'NAMED_BY_DEFAULT':
      return requested ?? false;
    default:
      return requested ?? true;
  }
}

export type SubmitQuestionResult = { ok: true; question: QAQuestionEntry } | QAError;

export function submitQuestion(
  state: QAState,
  args: {
    participantId: string;
    text: string;
    isAnonymous?: boolean;
    questionId?: string;
    labelIds?: string[];
  },
): SubmitQuestionResult {
  if (state.status === 'ENDED') return { ok: false, reason: 'session_ended' };
  if (!state.submissionsOpen) return { ok: false, reason: 'submissions_closed' };
  const participant = state.participants.get(args.participantId);
  if (!participant) return { ok: false, reason: 'unknown_participant' };

  const validated = validateText(state, args.text);
  if (!validated.ok) return validated;

  // Participants may only attach labels the host marked selectable (PRD
  // §4.1): unknown or host-only label ids are rejected, never silently
  // dropped, so the client can surface the mistake.
  const labelIds = new Set(args.labelIds ?? []);
  for (const labelId of labelIds) {
    const label = state.labels.get(labelId);
    if (!label) return { ok: false, reason: 'unknown_label' };
    if (!label.participantSelectable) return { ok: false, reason: 'label_not_selectable' };
  }

  const isAnonymous = resolveAnonymity(state.settings.privacyMode, args.isAnonymous);
  if (!isAnonymous && !participant.displayName) {
    return { ok: false, reason: 'name_required' };
  }

  const question: QAQuestionEntry = {
    id: args.questionId ?? genId('qaq'),
    participantId: args.participantId,
    text: validated.text,
    originalText: null,
    isAnonymous,
    authorDisplayName: isAnonymous ? null : participant.displayName,
    status: state.settings.moderationEnabled ? 'IN_REVIEW' : 'LIVE',
    submittedAt: Date.now(),
    approvedAt: null,
    answeredAt: null,
    archivedAt: null,
    dismissedAt: null,
    withdrawnAt: null,
    labelIds,
    votes: new Map(),
    replies: [],
  };
  state.questions.set(question.id, question);
  return { ok: true, question };
}

// --- Labels (MID-340, PRD §4.1 / §4.3) ---

export type CreateLabelResult = { ok: true; labelId: string; label: QALabelEntry } | QAError;

// Session-scoped label creation, usable at session creation and mid-session.
// Names are unique per session (mirrors the QALabel @@unique([sessionId,
// name]) constraint) so the in-memory check fails the same way the DB would.
export function createLabel(
  state: QAState,
  args: { name: string; participantSelectable?: boolean; labelId?: string },
): CreateLabelResult {
  if (state.status === 'ENDED') return { ok: false, reason: 'session_ended' };
  const validated = validateLabelName(args.name);
  if (!validated.ok) return { ok: false, reason: validated.reason };
  for (const label of state.labels.values()) {
    if (label.name === validated.value) return { ok: false, reason: 'duplicate_label' };
  }
  const labelId = args.labelId ?? genId('qal');
  const label: QALabelEntry = {
    name: validated.value,
    participantSelectable: args.participantSelectable ?? false,
  };
  state.labels.set(labelId, label);
  return { ok: true, labelId, label };
}

export type AssignLabelResult = { ok: true; assigned: boolean } | QAError;

// Idempotent: the labelIds set makes a repeat assign a no-op (`assigned:
// false`), matching the repo's upsert on the compound key.
export function assignLabel(
  state: QAState,
  args: { questionId: string; labelId: string },
): AssignLabelResult {
  if (!state.labels.has(args.labelId)) return { ok: false, reason: 'unknown_label' };
  const question = state.questions.get(args.questionId);
  if (!question) return { ok: false, reason: 'unknown_question' };
  if (question.labelIds.has(args.labelId)) return { ok: true, assigned: false };
  question.labelIds.add(args.labelId);
  return { ok: true, assigned: true };
}

export type UnassignLabelResult = { ok: true; removed: boolean } | QAError;

export function unassignLabel(
  state: QAState,
  args: { questionId: string; labelId: string },
): UnassignLabelResult {
  const question = state.questions.get(args.questionId);
  if (!question) return { ok: false, reason: 'unknown_question' };
  return { ok: true, removed: question.labelIds.delete(args.labelId) };
}

export type QuestionTransitionResult =
  | { ok: true; from: QAQuestionStatus; to: QAQuestionStatus }
  | QAError;

// Central transition gate: validates against the PRD §4.3 matrix, stamps the
// status timestamp, and keeps the single-highlight invariant by clearing the
// highlight whenever the highlighted question leaves LIVE.
function transitionQuestion(
  state: QAState,
  question: QAQuestionEntry,
  to: QAQuestionStatus,
): QuestionTransitionResult {
  const from = question.status;
  if (!isValidQuestionTransition(from, to)) {
    return { ok: false, reason: 'invalid_transition' };
  }
  question.status = to;
  const now = Date.now();
  if (to === 'LIVE') {
    if (question.approvedAt === null) question.approvedAt = now;
    // Returning to the live board (restore from ANSWERED/ARCHIVED) clears the
    // settled timestamps so exports never show a LIVE question that still
    // looks answered or archived (MID-339).
    question.answeredAt = null;
    question.archivedAt = null;
  }
  if (to === 'ANSWERED') question.answeredAt = now;
  if (to === 'ARCHIVED') question.archivedAt = now;
  if (to === 'DISMISSED') question.dismissedAt = now;
  if (to === 'WITHDRAWN') question.withdrawnAt = now;
  if (to !== 'LIVE' && state.highlightedQuestionId === question.id) {
    state.highlightedQuestionId = null;
  }
  return { ok: true, from, to };
}

function withQuestion(
  state: QAState,
  questionId: string,
  fn: (question: QAQuestionEntry) => QuestionTransitionResult,
): QuestionTransitionResult {
  const question = state.questions.get(questionId);
  if (!question) return { ok: false, reason: 'unknown_question' };
  return fn(question);
}

export function approveQuestion(
  state: QAState,
  args: { questionId: string },
): QuestionTransitionResult {
  return withQuestion(state, args.questionId, (q) => {
    if (q.status !== 'IN_REVIEW') return { ok: false, reason: 'invalid_transition' };
    return transitionQuestion(state, q, 'LIVE');
  });
}

export function dismissQuestion(
  state: QAState,
  args: { questionId: string },
): QuestionTransitionResult {
  return withQuestion(state, args.questionId, (q) => transitionQuestion(state, q, 'DISMISSED'));
}

// Restore is status-directed (PRD §4.3): DISMISSED returns to review,
// ANSWERED/ARCHIVED return to the live board.
export function restoreQuestion(
  state: QAState,
  args: { questionId: string },
): QuestionTransitionResult {
  return withQuestion(state, args.questionId, (q) => {
    if (q.status === 'DISMISSED') return transitionQuestion(state, q, 'IN_REVIEW');
    if (q.status === 'ANSWERED' || q.status === 'ARCHIVED') {
      return transitionQuestion(state, q, 'LIVE');
    }
    return { ok: false, reason: 'invalid_transition' };
  });
}

// Moderation-queue restore (MID-338): strictly DISMISSED -> IN_REVIEW. The
// broader status-directed restoreQuestion (ANSWERED/ARCHIVED -> LIVE) is
// reserved for the MID-339 host actions and must not be reachable from the
// moderation socket events.
export function restoreDismissedQuestion(
  state: QAState,
  args: { questionId: string },
): QuestionTransitionResult {
  return withQuestion(state, args.questionId, (q) => {
    if (q.status !== 'DISMISSED') return { ok: false, reason: 'invalid_transition' };
    return transitionQuestion(state, q, 'IN_REVIEW');
  });
}

export function markAnswered(
  state: QAState,
  args: { questionId: string },
): QuestionTransitionResult {
  return withQuestion(state, args.questionId, (q) => transitionQuestion(state, q, 'ANSWERED'));
}

export function archiveQuestion(
  state: QAState,
  args: { questionId: string },
): QuestionTransitionResult {
  return withQuestion(state, args.questionId, (q) => transitionQuestion(state, q, 'ARCHIVED'));
}

export function withdrawQuestion(
  state: QAState,
  args: { questionId: string; participantId: string },
): QuestionTransitionResult {
  // ENDED is view-only for participants (see lib/qa-hydrate.ts).
  if (state.status === 'ENDED') return { ok: false, reason: 'session_ended' };
  return withQuestion(state, args.questionId, (q) => {
    if (q.participantId !== args.participantId) return { ok: false, reason: 'not_owner' };
    return transitionQuestion(state, q, 'WITHDRAWN');
  });
}

export type QAEditor = { role: 'host' } | { role: 'participant'; participantId: string };

export type EditQuestionResult = { ok: true; question: QAQuestionEntry } | QAError;

export function editQuestion(
  state: QAState,
  args: { questionId: string; text: string; editor: QAEditor },
): EditQuestionResult {
  // ENDED is view-only for participants; hosts may still clean up text for
  // export/archive purposes.
  if (args.editor.role === 'participant' && state.status === 'ENDED') {
    return { ok: false, reason: 'session_ended' };
  }
  const question = state.questions.get(args.questionId);
  if (!question) return { ok: false, reason: 'unknown_question' };
  // Edits only make sense before or after approval (PRD §4.3); settled
  // questions (answered/archived/dismissed/withdrawn) are immutable.
  if (question.status !== 'IN_REVIEW' && question.status !== 'LIVE') {
    return { ok: false, reason: 'invalid_status' };
  }
  if (args.editor.role === 'participant' && question.participantId !== args.editor.participantId) {
    return { ok: false, reason: 'not_owner' };
  }

  const validated = validateText(state, args.text);
  if (!validated.ok) return validated;

  if (question.originalText === null) question.originalText = question.text;
  question.text = validated.text;

  // An edited approved question returns to review when moderation is on
  // (PRD §4.5). Host edits never demote the question.
  if (
    args.editor.role === 'participant' &&
    question.status === 'LIVE' &&
    state.settings.moderationEnabled
  ) {
    transitionQuestion(state, question, 'IN_REVIEW');
  }
  return { ok: true, question };
}

// --- Replies (MID-341, PRD §4.3 / §4.8) ---
//
// Reply privacy falls out of the projection rules, not per-reply flags: a
// reply on an IN_REVIEW question is private because IN_REVIEW questions never
// enter publicState (only hostState and the owner's personalState see them);
// once the question is approved to LIVE the same reply projects publicly.
// Dismissing a question keeps prior replies visible to the owner via
// personalState, which includes own questions in every status.

export type AddReplyResult = { ok: true; reply: QAReplyEntry; question: QAQuestionEntry } | QAError;

// Host reply (PRD §4.3): up to QA_HOST_REPLY_CHAR_LIMIT characters, on LIVE
// (public) or IN_REVIEW (private to submitter until approved) questions only.
// Settled questions (answered/archived/dismissed/withdrawn) are immutable.
export function addHostReply(
  state: QAState,
  args: { questionId: string; text: string; replyId?: string },
): AddReplyResult {
  if (state.status === 'ENDED') return { ok: false, reason: 'session_ended' };
  const question = state.questions.get(args.questionId);
  if (!question) return { ok: false, reason: 'unknown_question' };
  if (question.status !== 'LIVE' && question.status !== 'IN_REVIEW') {
    return { ok: false, reason: 'invalid_status' };
  }
  const validated = validateQuestionInput(args.text, QA_HOST_REPLY_CHAR_LIMIT);
  if (!validated.ok) return { ok: false, reason: validated.reason };
  const reply: QAReplyEntry = {
    id: args.replyId ?? genId('qar'),
    participantId: null,
    isHostReply: true,
    text: validated.value,
    createdAt: Date.now(),
  };
  question.replies.push(reply);
  return { ok: true, reply, question };
}

// Participant reply (PRD §4.8): only when the host enabled replies, only on
// LIVE questions, same character limit as questions. Closing submissions
// (PRD §4.10) closes reply threads too — closed means no new participant
// content, while voting stays on its own switch. Replies publish immediately
// even when question moderation is enabled (v1 decision — see DECISIONS.md).
export function addParticipantReply(
  state: QAState,
  args: { questionId: string; participantId: string; text: string; replyId?: string },
): AddReplyResult {
  if (state.status === 'ENDED') return { ok: false, reason: 'session_ended' };
  if (!state.settings.participantRepliesEnabled) return { ok: false, reason: 'replies_disabled' };
  if (!state.submissionsOpen) return { ok: false, reason: 'submissions_closed' };
  if (!state.participants.has(args.participantId)) {
    return { ok: false, reason: 'unknown_participant' };
  }
  const question = state.questions.get(args.questionId);
  if (!question) return { ok: false, reason: 'unknown_question' };
  if (question.status !== 'LIVE') return { ok: false, reason: 'not_live' };
  const validated = validateText(state, args.text);
  if (!validated.ok) return validated;
  const reply: QAReplyEntry = {
    id: args.replyId ?? genId('qar'),
    // Linkage is for ownership/audit only — projections never expose it, so
    // replies stay anonymous to the host and the room alike.
    participantId: args.participantId,
    isHostReply: false,
    text: validated.text,
    createdAt: Date.now(),
  };
  question.replies.push(reply);
  return { ok: true, reply, question };
}

// Host edits their own replies (PRD §4.3). Routing on broadcast follows the
// question's CURRENT status, so an edit made while the question is still
// IN_REVIEW stays private and an edit on a LIVE thread propagates publicly.
export function editHostReply(
  state: QAState,
  args: { questionId: string; replyId: string; text: string },
): AddReplyResult {
  const question = state.questions.get(args.questionId);
  if (!question) return { ok: false, reason: 'unknown_question' };
  if (question.status !== 'LIVE' && question.status !== 'IN_REVIEW') {
    return { ok: false, reason: 'invalid_status' };
  }
  const reply = question.replies.find((r) => r.id === args.replyId);
  if (!reply) return { ok: false, reason: 'unknown_reply' };
  if (!reply.isHostReply) return { ok: false, reason: 'not_host_reply' };
  const validated = validateQuestionInput(args.text, QA_HOST_REPLY_CHAR_LIMIT);
  if (!validated.ok) return { ok: false, reason: validated.reason };
  reply.text = validated.value;
  return { ok: true, reply, question };
}

export type HighlightResult = { ok: true; previousQuestionId: string | null } | QAError;

export function highlightQuestion(
  state: QAState,
  args: { questionId: string | null },
): HighlightResult {
  const previousQuestionId = state.highlightedQuestionId;
  if (args.questionId === null) {
    state.highlightedQuestionId = null;
    return { ok: true, previousQuestionId };
  }
  const question = state.questions.get(args.questionId);
  if (!question) return { ok: false, reason: 'unknown_question' };
  if (question.status !== 'LIVE') return { ok: false, reason: 'not_live' };
  // A single field holds the invariant: highlighting a second question
  // implicitly un-highlights the first.
  state.highlightedQuestionId = args.questionId;
  return { ok: true, previousQuestionId };
}

export function questionVoteCounts(question: QAQuestionEntry): {
  score: number;
  upvotes: number;
  downvotes: number;
} {
  let upvotes = 0;
  let downvotes = 0;
  for (const type of question.votes.values()) {
    if (type === 'UP') upvotes += 1;
    else downvotes += 1;
  }
  return { score: upvotes - downvotes, upvotes, downvotes };
}

export type VoteResult = { ok: true; score: number; upvotes: number; downvotes: number } | QAError;

// Idempotent per participant: the votes map keys on participantId, so a
// repeat vote is a no-op and an opposite vote switches type (up/down are
// mutually exclusive). Participants may vote on their own questions — same
// call as Slido; revisit if it skews incentives.
export function applyVote(
  state: QAState,
  args: { questionId: string; participantId: string; type?: QAVoteType },
): VoteResult {
  if (state.status === 'ENDED') return { ok: false, reason: 'session_ended' };
  if (!state.votingOpen) return { ok: false, reason: 'voting_closed' };
  if (!state.participants.has(args.participantId)) {
    return { ok: false, reason: 'unknown_participant' };
  }
  const question = state.questions.get(args.questionId);
  if (!question) return { ok: false, reason: 'unknown_question' };
  if (question.status !== 'LIVE') return { ok: false, reason: 'not_live' };
  const type = args.type ?? 'UP';
  if (type === 'DOWN' && !state.settings.downvotesEnabled) {
    return { ok: false, reason: 'downvotes_disabled' };
  }
  question.votes.set(args.participantId, type);
  return { ok: true, ...questionVoteCounts(question) };
}

export type RemoveVoteResult =
  | { ok: true; removed: boolean; score: number; upvotes: number; downvotes: number }
  | QAError;

export function removeVote(
  state: QAState,
  args: { questionId: string; participantId: string },
): RemoveVoteResult {
  if (state.status === 'ENDED') return { ok: false, reason: 'session_ended' };
  if (!state.votingOpen) return { ok: false, reason: 'voting_closed' };
  const question = state.questions.get(args.questionId);
  if (!question) return { ok: false, reason: 'unknown_question' };
  const removed = question.votes.delete(args.participantId);
  return { ok: true, removed, ...questionVoteCounts(question) };
}

export type SetSessionStatusResult =
  | { ok: true; from: QASessionStatus; to: QASessionStatus }
  | { ok: false; reason: 'invalid_transition'; from: QASessionStatus; to: QASessionStatus };

export function setSessionStatus(state: QAState, status: QASessionStatus): SetSessionStatusResult {
  const from = state.status;
  if (!isValidSessionTransition(from, status)) {
    return { ok: false, reason: 'invalid_transition', from, to: status };
  }
  state.status = status;
  state.submissionsOpen = status === 'OPEN';
  if (status === 'ENDED') state.votingOpen = false;
  return { ok: true, from, to: status };
}

// Sugar over the session status machine: closing submissions is the CLOSED
// state, reopening them is OPEN (PRD §4.10). Idempotent.
export function setSubmissionsOpen(state: QAState, open: boolean): SetSessionStatusResult {
  if (state.submissionsOpen === open && state.status !== 'ENDED') {
    return { ok: true, from: state.status, to: state.status };
  }
  return setSessionStatus(state, open ? 'OPEN' : 'CLOSED');
}

export type SetVotingOpenResult = { ok: true; votingOpen: boolean } | QAError;

export function setVotingOpen(state: QAState, open: boolean): SetVotingOpenResult {
  if (state.status === 'ENDED') return { ok: false, reason: 'session_ended' };
  state.votingOpen = open;
  return { ok: true, votingOpen: open };
}

function toPublicReply(reply: QAReplyEntry): QAPublicReply {
  return {
    id: reply.id,
    isHostReply: reply.isHostReply,
    text: reply.text,
    createdAt: reply.createdAt,
  };
}

/**
 * Serialize a single question entry to the public/participant-safe shape.
 * Filters labelIds to participant-selectable labels only, matching publicState's
 * privacy rules. Used by the coalesced qa:questions delta so server.ts can
 * emit a single-question delta without recomputing a full public snapshot.
 */
export function toPublicQuestion(state: QAState, q: QAQuestionEntry): QAPublicQuestion {
  const publicLabelIds = new Set(
    [...state.labels.entries()]
      .filter(([, label]) => label.participantSelectable)
      .map(([id]) => id),
  );
  return {
    id: q.id,
    text: q.text,
    isAnonymous: q.isAnonymous,
    authorDisplayName: q.isAnonymous ? null : q.authorDisplayName,
    ...questionVoteCounts(q),
    labelIds: [...q.labelIds].filter((labelId) => publicLabelIds.has(labelId)),
    replyCount: q.replies.length,
    replies: q.replies.map(toPublicReply),
    highlighted: state.highlightedQuestionId === q.id,
    submittedAt: q.submittedAt,
  };
}

/**
 * Serialize a single question entry to the host-safe shape (includes status).
 * Does NOT filter labels — the host board sees all label assignments.
 * Used by the coalesced qa:host:questions delta.
 */
export function toHostQuestion(state: QAState, q: QAQuestionEntry): QAHostQuestion {
  return {
    id: q.id,
    text: q.text,
    isAnonymous: q.isAnonymous,
    authorDisplayName: q.isAnonymous ? null : q.authorDisplayName,
    status: q.status,
    ...questionVoteCounts(q),
    labelIds: [...q.labelIds],
    replyCount: q.replies.length,
    replies: q.replies.map(toPublicReply),
    highlighted: state.highlightedQuestionId === q.id,
    submittedAt: q.submittedAt,
  };
}

// Display/participant-safe projection. Only LIVE questions are included, so
// in-review and dismissed questions — and any private replies attached to
// them — never reach displays or other participants.
export function publicState(state: QAState): QAPublicState {
  // Participant/display projection only exposes labels the host explicitly made
  // audience-selectable. Host-only labels stay in hostState() so their names
  // and ids never cross the mixed qa:${pin} room boundary.
  const publicLabels = [...state.labels.entries()]
    .filter(([, label]) => label.participantSelectable)
    .map(([id, label]) => ({
      id,
      name: label.name,
      participantSelectable: label.participantSelectable,
    }));
  const publicLabelIds = new Set(publicLabels.map((label) => label.id));

  const questions: QAPublicQuestion[] = [];
  for (const q of state.questions.values()) {
    if (q.status !== 'LIVE') continue;
    questions.push({
      id: q.id,
      text: q.text,
      isAnonymous: q.isAnonymous,
      authorDisplayName: q.isAnonymous ? null : q.authorDisplayName,
      ...questionVoteCounts(q),
      labelIds: [...q.labelIds].filter((labelId) => publicLabelIds.has(labelId)),
      replyCount: q.replies.length,
      replies: q.replies.map(toPublicReply),
      highlighted: state.highlightedQuestionId === q.id,
      submittedAt: q.submittedAt,
    });
  }
  questions.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.submittedAt - b.submittedAt;
  });
  return {
    pin: state.pin,
    title: state.settings.title,
    description: state.settings.description,
    privacyMode: state.settings.privacyMode,
    status: state.status,
    submissionsOpen: state.submissionsOpen,
    votingOpen: state.votingOpen,
    downvotesEnabled: state.settings.downvotesEnabled,
    participantRepliesEnabled: state.settings.participantRepliesEnabled,
    questionCharLimit: state.settings.questionCharLimit,
    participantCount: state.participants.size,
    questionCount: questions.length,
    highlightedQuestionId: state.highlightedQuestionId,
    labels: publicLabels,
    displaySettings: { ...state.displaySettings },
    questions,
  };
}

// Host control projection (MID-337): the public board plus IN_REVIEW and
// DISMISSED questions and counts by state. Targeted at the host socket only —
// IN_REVIEW and DISMISSED questions must never reach the mixed qa:${pin}
// room. DISMISSED rows ride along so the host can restore them (MID-338);
// ANSWERED/ARCHIVED rows ride along so the host can restore them to the live
// board (MID-339). Only WITHDRAWN stays off — the participant took it back.
// Anonymous means anonymous to the host too: no participant linkage, null
// author.
export function hostState(state: QAState): QAHostState {
  const counts = { live: 0, inReview: 0, answered: 0, archived: 0, dismissed: 0 };
  const questions: QAHostQuestion[] = [];
  for (const q of state.questions.values()) {
    if (q.status === 'LIVE') counts.live += 1;
    else if (q.status === 'IN_REVIEW') counts.inReview += 1;
    else if (q.status === 'ANSWERED') counts.answered += 1;
    else if (q.status === 'ARCHIVED') counts.archived += 1;
    else if (q.status === 'DISMISSED') counts.dismissed += 1;
    if (q.status === 'WITHDRAWN') continue;
    questions.push({
      id: q.id,
      text: q.text,
      isAnonymous: q.isAnonymous,
      authorDisplayName: q.isAnonymous ? null : q.authorDisplayName,
      status: q.status,
      ...questionVoteCounts(q),
      labelIds: [...q.labelIds],
      replyCount: q.replies.length,
      replies: q.replies.map(toPublicReply),
      highlighted: state.highlightedQuestionId === q.id,
      submittedAt: q.submittedAt,
    });
  }
  questions.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.submittedAt - b.submittedAt;
  });
  return {
    pin: state.pin,
    title: state.settings.title,
    description: state.settings.description,
    privacyMode: state.settings.privacyMode,
    moderationEnabled: state.settings.moderationEnabled,
    status: state.status,
    submissionsOpen: state.submissionsOpen,
    votingOpen: state.votingOpen,
    downvotesEnabled: state.settings.downvotesEnabled,
    participantRepliesEnabled: state.settings.participantRepliesEnabled,
    questionCharLimit: state.settings.questionCharLimit,
    participantCount: state.participants.size,
    counts,
    highlightedQuestionId: state.highlightedQuestionId,
    labels: [...state.labels.entries()].map(([id, l]) => ({
      id,
      name: l.name,
      participantSelectable: l.participantSelectable,
    })),
    displaySettings: { ...state.displaySettings },
    questions,
  };
}

// Targeted projection for one participant: their own questions in every
// status (pending review, withdrawn, dismissed, …) with all replies,
// including private host replies, plus their current votes.
export function personalState(state: QAState, participantId: string): QAPersonalState | null {
  const participant = state.participants.get(participantId);
  if (!participant) return null;
  const questions: QAPersonalQuestion[] = [];
  const votes: Record<string, QAVoteType> = {};
  for (const q of state.questions.values()) {
    if (q.participantId === participantId) {
      questions.push({
        id: q.id,
        text: q.text,
        status: q.status,
        isAnonymous: q.isAnonymous,
        submittedAt: q.submittedAt,
        replies: q.replies.map(toPublicReply),
      });
    }
    const vote = q.votes.get(participantId);
    if (vote) votes[q.id] = vote;
  }
  questions.sort((a, b) => a.submittedAt - b.submittedAt);
  return {
    participantId,
    displayName: participant.displayName,
    questions,
    votes,
  };
}
