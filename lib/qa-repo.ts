// Persistence layer for the Q&A live activity (MID-331). Mirrors
// lib/wordcloud-repo.ts: thin validated wrappers around Prisma so the
// socket/state layer can persist before broadcasting.
//
// Privacy rule: anonymous questions must never expose a resolvable author
// identity in host-visible or export DTOs. Participant linkage exists in the
// DB for personal state (withdraw/edit/own-question views) only — use
// toHostVisibleQuestion() before handing questions to host/export surfaces.

import type {
  Prisma,
  QALabel,
  QAModerationEvent,
  QAParticipant,
  QAPrivacyMode,
  QAQuestion,
  QAQuestionLabel,
  QAQuestionStatus,
  QAReply,
  QASession,
  QASessionStatus,
  QAVote,
  QAVoteType,
} from '@prisma/client';
import { prisma } from './db';

export const QA_TITLE_MAX = 100;
export const QA_DESCRIPTION_MAX = 200;
export const QA_QUESTION_TEXT_MAX = 500;
export const QA_REPLY_TEXT_MAX = 1000;
export const QA_LABEL_NAME_MAX = 50;

export type QAQuestionWithRelations = QAQuestion & {
  votes: QAVote[];
  labels: QAQuestionLabel[];
  replies: QAReply[];
};

export type QASessionWithRelations = QASession & {
  participants: QAParticipant[];
  labels: QALabel[];
  questions: QAQuestionWithRelations[];
};

// Host/export-safe projection of a question: no participant linkage ever, and
// no author identity when the question is anonymous.
export type HostVisibleQuestion = Omit<QAQuestion, 'participantId'>;

export class DuplicateLabelError extends Error {
  constructor(name: string) {
    super(`Label "${name}" already exists in this session`);
    this.name = 'DuplicateLabelError';
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2002'
  );
}

export async function createSession(args: {
  pin: string;
  title: string;
  description?: string | null;
  privacyMode?: QAPrivacyMode;
  moderationEnabled?: boolean;
  participantRepliesEnabled?: boolean;
  downvotesEnabled?: boolean;
  questionCharLimit?: number;
  hostUserId: string | null;
  // Session-scoped labels defined at creation (MID-340). Nested create keeps
  // the session and its labels atomic — no session row without its labels.
  labels?: { name: string; participantSelectable?: boolean }[];
}): Promise<QASession> {
  if (!args.pin.trim()) throw new Error('PIN required');
  const title = args.title.trim();
  if (!title) throw new Error('Title required');
  if (title.length > QA_TITLE_MAX) throw new Error('Title too long');
  const description = args.description?.trim() || null;
  if (description && description.length > QA_DESCRIPTION_MAX) {
    throw new Error('Description too long');
  }
  const questionCharLimit = args.questionCharLimit ?? 280;
  if (questionCharLimit < 1 || questionCharLimit > QA_QUESTION_TEXT_MAX) {
    throw new Error(`questionCharLimit must be between 1 and ${QA_QUESTION_TEXT_MAX}`);
  }
  const labels = (args.labels ?? []).map((label) => {
    const name = label.name.trim();
    if (!name) throw new Error('Label name required');
    if (name.length > QA_LABEL_NAME_MAX) throw new Error('Label name too long');
    return { name, participantSelectable: label.participantSelectable ?? false };
  });
  const seen = new Set<string>();
  for (const label of labels) {
    if (seen.has(label.name)) throw new DuplicateLabelError(label.name);
    seen.add(label.name);
  }
  return prisma.qASession.create({
    data: {
      pin: args.pin,
      title,
      description,
      privacyMode: args.privacyMode ?? 'ANONYMOUS_BY_DEFAULT',
      moderationEnabled: args.moderationEnabled ?? false,
      participantRepliesEnabled: args.participantRepliesEnabled ?? false,
      downvotesEnabled: args.downvotesEnabled ?? false,
      questionCharLimit,
      hostUserId: args.hostUserId,
      ...(labels.length > 0 ? { labels: { create: labels } } : {}),
    },
  });
}

export async function allocatePin(): Promise<string> {
  const { allocatePin: shared } = await import('./pin-allocator');
  return shared();
}

export async function setSessionStatus(args: {
  sessionId: string;
  status: QASessionStatus;
}): Promise<QASession> {
  const data: { status: QASessionStatus; endedAt?: Date; votingOpen?: boolean } = {
    status: args.status,
  };
  if (args.status === 'ENDED') {
    data.endedAt = new Date();
    data.votingOpen = false;
  }
  return prisma.qASession.update({
    where: { id: args.sessionId },
    data,
  });
}

// Persisted live presentation state so restart hydration (lib/qa-hydrate.ts)
// can restore voting/highlight exactly. submissionsOpen has no column — it is
// derived from session status (OPEN <-> open).
export async function setVotingOpen(args: {
  sessionId: string;
  votingOpen: boolean;
}): Promise<QASession> {
  return prisma.qASession.update({
    where: { id: args.sessionId },
    data: { votingOpen: args.votingOpen },
  });
}

export async function setHighlightedQuestion(args: {
  sessionId: string;
  questionId: string | null;
}): Promise<QASession> {
  if (args.questionId === null) {
    return prisma.qASession.update({
      where: { id: args.sessionId },
      data: { highlightedQuestionId: null },
    });
  }

  const result = await prisma.qASession.updateMany({
    where: {
      id: args.sessionId,
      questions: { some: { id: args.questionId, status: 'LIVE' } },
    },
    data: { highlightedQuestionId: args.questionId },
  });
  if (result.count !== 1) {
    throw new Error('Highlighted question must be LIVE in this session');
  }
  const session = await prisma.qASession.findUnique({ where: { id: args.sessionId } });
  if (!session) throw new Error('Q&A session not found');
  return session;
}

export async function addParticipant(args: {
  sessionId: string;
  displayName?: string | null;
}): Promise<QAParticipant> {
  const displayName = args.displayName?.trim() || null;
  return prisma.qAParticipant.create({
    data: { sessionId: args.sessionId, displayName },
  });
}

export async function addQuestion(args: {
  sessionId: string;
  participantId: string | null;
  text: string;
  isAnonymous?: boolean;
  authorDisplayName?: string | null;
  status?: QAQuestionStatus;
  // Participant-selected labels (MID-340). Nested create keeps the question
  // and its label assignments atomic — never a labelless half-write.
  labelIds?: string[];
}): Promise<QAQuestion> {
  const text = args.text.trim();
  if (!text) throw new Error('Question text required');
  if (text.length > QA_QUESTION_TEXT_MAX) throw new Error('Question text too long');
  const status = args.status ?? 'LIVE';
  if (status !== 'LIVE' && status !== 'IN_REVIEW') {
    throw new Error('New questions must have status LIVE or IN_REVIEW');
  }
  const isAnonymous = args.isAnonymous ?? true;
  // Never persist an author identity for anonymous questions.
  const authorDisplayName = isAnonymous ? null : args.authorDisplayName?.trim() || null;
  const labelIds = [...new Set(args.labelIds ?? [])];
  return prisma.qAQuestion.create({
    data: {
      sessionId: args.sessionId,
      participantId: args.participantId,
      text,
      isAnonymous,
      authorDisplayName,
      status,
      ...(labelIds.length > 0
        ? { labels: { create: labelIds.map((labelId) => ({ labelId })) } }
        : {}),
    },
  });
}

async function applyQuestionStatus(
  tx: Prisma.TransactionClient,
  args: { questionId: string; status: QAQuestionStatus },
): Promise<QAQuestion> {
  const data: {
    status: QAQuestionStatus;
    approvedAt?: Date;
    answeredAt?: Date | null;
    archivedAt?: Date | null;
    dismissedAt?: Date;
    withdrawnAt?: Date;
  } = { status: args.status };
  if (args.status === 'LIVE') {
    const existing = await tx.qAQuestion.findUnique({
      where: { id: args.questionId },
      select: { approvedAt: true },
    });
    if (existing && existing.approvedAt === null) data.approvedAt = new Date();
    // Returning to the live board clears the settled timestamps (MID-339):
    // exports must never show a LIVE question with answeredAt/archivedAt.
    data.answeredAt = null;
    data.archivedAt = null;
  }
  if (args.status === 'ANSWERED') data.answeredAt = new Date();
  if (args.status === 'ARCHIVED') data.archivedAt = new Date();
  if (args.status === 'DISMISSED') data.dismissedAt = new Date();
  if (args.status === 'WITHDRAWN') data.withdrawnAt = new Date();
  const question = await tx.qAQuestion.update({
    where: { id: args.questionId },
    data,
  });
  // Keep the persisted highlight pointer in lockstep with memory. Any status
  // write for this question also clears a stale session pointer targeting it:
  // - leaving LIVE clears the active highlight;
  // - restoring to LIVE clears legacy/racy stale pointers so hydration cannot
  //   resurrect an old highlight after the host intentionally restored only.
  // Conditional updateMany makes this a no-op when another question is on air.
  const txWithQASession = tx as unknown as {
    qASession: {
      updateMany(args: {
        where: { id: string; highlightedQuestionId: string };
        data: { highlightedQuestionId: null };
      }): Promise<unknown>;
    };
  };
  await txWithQASession.qASession.updateMany({
    where: { id: question.sessionId, highlightedQuestionId: args.questionId },
    data: { highlightedQuestionId: null },
  });
  return question;
}

export async function setQuestionStatus(args: {
  questionId: string;
  status: QAQuestionStatus;
}): Promise<QAQuestion> {
  // Transactional so the status write and the highlight-pointer clear can
  // never persist independently.
  return prisma.$transaction((tx) => applyQuestionStatus(tx, args));
}

// Moderation actions (MID-338) require an audit trail: the status update and
// its QAModerationEvent commit in ONE transaction so a moderation action can
// never persist without the event that explains it (and vice versa). Callers
// treat any failure as persistence_failed and roll back in-memory state.
export async function setQuestionStatusWithModerationEvent(args: {
  questionId: string;
  status: QAQuestionStatus;
  sessionId: string;
  hostUserId?: string | null;
  action: string;
  reason?: string | null;
}): Promise<{ question: QAQuestion; event: QAModerationEvent }> {
  const action = args.action.trim();
  if (!action) throw new Error('Action required');
  return prisma.$transaction(async (tx) => {
    const question = await applyQuestionStatus(tx, {
      questionId: args.questionId,
      status: args.status,
    });
    const event = await tx.qAModerationEvent.create({
      data: {
        sessionId: args.sessionId,
        questionId: args.questionId,
        hostUserId: args.hostUserId ?? null,
        action,
        reason: args.reason ?? null,
      },
    });
    return { question, event };
  });
}

// Host edit of a question. Preserves the submitted text in originalText the
// first time, so export/audit can show what the participant actually wrote.
export async function editQuestionText(args: {
  questionId: string;
  text: string;
}): Promise<QAQuestion> {
  const text = args.text.trim();
  if (!text) throw new Error('Question text required');
  if (text.length > QA_QUESTION_TEXT_MAX) throw new Error('Question text too long');
  const existing = await prisma.qAQuestion.findUnique({
    where: { id: args.questionId },
    select: { text: true, originalText: true },
  });
  if (!existing) throw new Error('Question not found');
  const data: { text: string; originalText?: string } = { text };
  if (existing.originalText === null) data.originalText = existing.text;
  return prisma.qAQuestion.update({
    where: { id: args.questionId },
    data,
  });
}

// One vote per participant per question; re-voting switches the type instead
// of creating a second row (enforced by @@unique([questionId, participantId])).
export async function recordVote(args: {
  questionId: string;
  participantId: string;
  type?: QAVoteType;
}): Promise<QAVote> {
  const type = args.type ?? 'UP';
  return prisma.qAVote.upsert({
    where: {
      questionId_participantId: {
        questionId: args.questionId,
        participantId: args.participantId,
      },
    },
    create: { questionId: args.questionId, participantId: args.participantId, type },
    update: { type },
  });
}

export async function removeVote(args: {
  questionId: string;
  participantId: string;
}): Promise<number> {
  const result = await prisma.qAVote.deleteMany({
    where: { questionId: args.questionId, participantId: args.participantId },
  });
  return result.count;
}

export async function addReply(args: {
  questionId: string;
  participantId?: string | null;
  isHostReply: boolean;
  text: string;
}): Promise<QAReply> {
  const text = args.text.trim();
  if (!text) throw new Error('Reply text required');
  if (text.length > QA_REPLY_TEXT_MAX) throw new Error('Reply text too long');
  const participantId = args.participantId ?? null;
  if (!args.isHostReply && !participantId) {
    throw new Error('participantId required for participant replies');
  }
  return prisma.qAReply.create({
    data: {
      questionId: args.questionId,
      participantId: args.isHostReply ? null : participantId,
      isHostReply: args.isHostReply,
      text,
    },
  });
}

// Host reply edit (MID-341, PRD §4.3). Text-only update; authorship flags and
// linkage are immutable after creation.
export async function updateReplyText(args: { replyId: string; text: string }): Promise<QAReply> {
  const text = args.text.trim();
  if (!text) throw new Error('Reply text required');
  if (text.length > QA_REPLY_TEXT_MAX) throw new Error('Reply text too long');
  return prisma.qAReply.update({
    where: { id: args.replyId },
    data: { text },
  });
}

export async function createLabel(args: {
  sessionId: string;
  name: string;
  participantSelectable?: boolean;
}): Promise<QALabel> {
  const name = args.name.trim();
  if (!name) throw new Error('Label name required');
  if (name.length > QA_LABEL_NAME_MAX) throw new Error('Label name too long');
  try {
    return await prisma.qALabel.create({
      data: {
        sessionId: args.sessionId,
        name,
        participantSelectable: args.participantSelectable ?? false,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateLabelError(name);
    throw err;
  }
}

export async function updateLabel(args: {
  labelId: string;
  name?: string;
  participantSelectable?: boolean;
}): Promise<QALabel> {
  const data: { name?: string; participantSelectable?: boolean } = {};
  if (args.name !== undefined) {
    const name = args.name.trim();
    if (!name) throw new Error('Label name required');
    if (name.length > QA_LABEL_NAME_MAX) throw new Error('Label name too long');
    data.name = name;
  }
  if (args.participantSelectable !== undefined) {
    data.participantSelectable = args.participantSelectable;
  }
  try {
    return await prisma.qALabel.update({
      where: { id: args.labelId },
      data,
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateLabelError(data.name ?? '');
    throw err;
  }
}

export async function deleteLabel(labelId: string): Promise<QALabel> {
  return prisma.qALabel.delete({ where: { id: labelId } });
}

export async function listLabels(sessionId: string): Promise<QALabel[]> {
  return prisma.qALabel.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function assignLabel(args: {
  questionId: string;
  labelId: string;
}): Promise<QAQuestionLabel> {
  return prisma.qAQuestionLabel.upsert({
    where: {
      questionId_labelId: { questionId: args.questionId, labelId: args.labelId },
    },
    create: { questionId: args.questionId, labelId: args.labelId },
    update: {},
  });
}

export async function unassignLabel(args: {
  questionId: string;
  labelId: string;
}): Promise<number> {
  const result = await prisma.qAQuestionLabel.deleteMany({
    where: { questionId: args.questionId, labelId: args.labelId },
  });
  return result.count;
}

export async function logModerationEvent(args: {
  sessionId: string;
  questionId?: string | null;
  hostUserId?: string | null;
  action: string;
  reason?: string | null;
}): Promise<QAModerationEvent> {
  const action = args.action.trim();
  if (!action) throw new Error('Action required');
  return prisma.qAModerationEvent.create({
    data: {
      sessionId: args.sessionId,
      questionId: args.questionId ?? null,
      hostUserId: args.hostUserId ?? null,
      action,
      reason: args.reason ?? null,
    },
  });
}

// Full session graph for rebuilding in-memory state after a server restart
// (consumed by MID-332's hydration module). Internal use only: contains
// participant linkage, so never hand this to host/export surfaces directly —
// project questions through toHostVisibleQuestion() first.
export async function loadSessionForHydration(pin: string): Promise<QASessionWithRelations | null> {
  return prisma.qASession.findUnique({
    where: { pin },
    include: {
      participants: { orderBy: { joinedAt: 'asc' } },
      labels: { orderBy: { createdAt: 'asc' } },
      questions: {
        orderBy: { submittedAt: 'asc' },
        include: {
          votes: true,
          labels: true,
          replies: { orderBy: { createdAt: 'asc' } },
        },
      },
    },
  });
}

// Strip participant linkage from a question, and the author identity when the
// question is anonymous. Use this for every host-visible or export DTO.
export function toHostVisibleQuestion(question: QAQuestion): HostVisibleQuestion {
  const { participantId: _participantId, ...rest } = question;
  if (rest.isAnonymous) rest.authorDisplayName = null;
  return rest;
}

export async function listSessionsForUser(
  userId: string,
  opts: { status?: QASessionStatus; limit?: number; offset?: number } = {},
): Promise<QASession[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  return prisma.qASession.findMany({
    where: {
      hostUserId: userId,
      ...(opts.status ? { status: opts.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });
}
