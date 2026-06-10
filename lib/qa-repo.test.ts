import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionCreate = vi.fn();
const sessionFindUnique = vi.fn();
const sessionUpdate = vi.fn();
const sessionFindMany = vi.fn();
const participantCreate = vi.fn();
const questionCreate = vi.fn();
const questionFindUnique = vi.fn();
const questionUpdate = vi.fn();
const voteUpsert = vi.fn();
const voteDeleteMany = vi.fn();
const labelCreate = vi.fn();
const labelUpdate = vi.fn();
const labelDelete = vi.fn();
const labelFindMany = vi.fn();
const questionLabelUpsert = vi.fn();
const questionLabelDeleteMany = vi.fn();
const replyCreate = vi.fn();
const moderationEventCreate = vi.fn();

vi.mock('./db', () => ({
  prisma: {
    qASession: {
      create: (args: unknown) => sessionCreate(args),
      findUnique: (args: unknown) => sessionFindUnique(args),
      update: (args: unknown) => sessionUpdate(args),
      findMany: (args: unknown) => sessionFindMany(args),
    },
    qAParticipant: {
      create: (args: unknown) => participantCreate(args),
    },
    qAQuestion: {
      create: (args: unknown) => questionCreate(args),
      findUnique: (args: unknown) => questionFindUnique(args),
      update: (args: unknown) => questionUpdate(args),
    },
    qAVote: {
      upsert: (args: unknown) => voteUpsert(args),
      deleteMany: (args: unknown) => voteDeleteMany(args),
    },
    qALabel: {
      create: (args: unknown) => labelCreate(args),
      update: (args: unknown) => labelUpdate(args),
      delete: (args: unknown) => labelDelete(args),
      findMany: (args: unknown) => labelFindMany(args),
    },
    qAQuestionLabel: {
      upsert: (args: unknown) => questionLabelUpsert(args),
      deleteMany: (args: unknown) => questionLabelDeleteMany(args),
    },
    qAReply: {
      create: (args: unknown) => replyCreate(args),
    },
    qAModerationEvent: {
      create: (args: unknown) => moderationEventCreate(args),
    },
  },
}));

import {
  addParticipant,
  addQuestion,
  addReply,
  assignLabel,
  createLabel,
  createSession,
  DuplicateLabelError,
  deleteLabel,
  editQuestionText,
  listLabels,
  listSessionsForUser,
  loadSessionForHydration,
  logModerationEvent,
  recordVote,
  removeVote,
  setQuestionStatus,
  setSessionStatus,
  toHostVisibleQuestion,
  unassignLabel,
  updateLabel,
} from './qa-repo';

beforeEach(() => {
  sessionCreate.mockReset();
  sessionFindUnique.mockReset();
  sessionUpdate.mockReset();
  sessionFindMany.mockReset();
  participantCreate.mockReset();
  questionCreate.mockReset();
  questionFindUnique.mockReset();
  questionUpdate.mockReset();
  voteUpsert.mockReset();
  voteDeleteMany.mockReset();
  labelCreate.mockReset();
  labelUpdate.mockReset();
  labelDelete.mockReset();
  labelFindMany.mockReset();
  questionLabelUpsert.mockReset();
  questionLabelDeleteMany.mockReset();
  replyCreate.mockReset();
  moderationEventCreate.mockReset();
});

describe('createSession', () => {
  it('creates a session with trimmed title/description and defaults', async () => {
    sessionCreate.mockResolvedValueOnce({ id: 'qa_1', pin: '123456' });
    const out = await createSession({
      pin: '123456',
      title: '  Ask us anything  ',
      description: '  End of workshop  ',
      hostUserId: 'u_1',
    });
    expect(out).toEqual({ id: 'qa_1', pin: '123456' });
    expect(sessionCreate).toHaveBeenCalledWith({
      data: {
        pin: '123456',
        title: 'Ask us anything',
        description: 'End of workshop',
        privacyMode: 'ANONYMOUS_BY_DEFAULT',
        moderationEnabled: false,
        participantRepliesEnabled: false,
        downvotesEnabled: false,
        questionCharLimit: 280,
        hostUserId: 'u_1',
      },
    });
  });

  it('stores null description when omitted or blank', async () => {
    sessionCreate.mockResolvedValue({ id: 'qa_1' });
    await createSession({ pin: '123456', title: 't', description: '   ', hostUserId: null });
    await createSession({ pin: '123457', title: 't', hostUserId: null });
    for (const call of sessionCreate.mock.calls) {
      expect((call[0] as { data: { description: string | null } }).data.description).toBeNull();
    }
  });

  it('passes through explicit settings', async () => {
    sessionCreate.mockResolvedValueOnce({ id: 'qa_1' });
    await createSession({
      pin: '123456',
      title: 't',
      privacyMode: 'NAME_REQUIRED',
      moderationEnabled: true,
      participantRepliesEnabled: true,
      downvotesEnabled: true,
      questionCharLimit: 140,
      hostUserId: null,
    });
    const call = sessionCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.privacyMode).toBe('NAME_REQUIRED');
    expect(call.data.moderationEnabled).toBe(true);
    expect(call.data.participantRepliesEnabled).toBe(true);
    expect(call.data.downvotesEnabled).toBe(true);
    expect(call.data.questionCharLimit).toBe(140);
  });

  it('rejects empty pin', async () => {
    await expect(createSession({ pin: '   ', title: 't', hostUserId: null })).rejects.toThrow(
      'PIN required',
    );
  });

  it('rejects empty title', async () => {
    await expect(createSession({ pin: '123456', title: '  ', hostUserId: null })).rejects.toThrow(
      'Title required',
    );
  });

  it('rejects title over 100 chars and description over 200 chars', async () => {
    await expect(
      createSession({ pin: '123456', title: 'x'.repeat(101), hostUserId: null }),
    ).rejects.toThrow('Title too long');
    await expect(
      createSession({
        pin: '123456',
        title: 't',
        description: 'x'.repeat(201),
        hostUserId: null,
      }),
    ).rejects.toThrow('Description too long');
  });

  it('rejects questionCharLimit outside 1..500', async () => {
    await expect(
      createSession({ pin: '123456', title: 't', questionCharLimit: 0, hostUserId: null }),
    ).rejects.toThrow('questionCharLimit');
    await expect(
      createSession({ pin: '123456', title: 't', questionCharLimit: 501, hostUserId: null }),
    ).rejects.toThrow('questionCharLimit');
  });
});

describe('setSessionStatus', () => {
  it('sets endedAt on ENDED', async () => {
    sessionUpdate.mockResolvedValueOnce({ id: 'qa_1', status: 'ENDED' });
    await setSessionStatus({ sessionId: 'qa_1', status: 'ENDED' });
    const call = sessionUpdate.mock.calls[0][0] as {
      where: { id: string };
      data: { status: string; endedAt?: Date };
    };
    expect(call.where).toEqual({ id: 'qa_1' });
    expect(call.data.status).toBe('ENDED');
    expect(call.data.endedAt).toBeInstanceOf(Date);
  });

  it('CLOSED only updates status', async () => {
    sessionUpdate.mockResolvedValueOnce({ id: 'qa_1', status: 'CLOSED' });
    await setSessionStatus({ sessionId: 'qa_1', status: 'CLOSED' });
    const call = sessionUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data).toEqual({ status: 'CLOSED' });
  });
});

describe('addParticipant', () => {
  it('creates a participant with trimmed display name', async () => {
    participantCreate.mockResolvedValueOnce({ id: 'pt_1', displayName: 'Alice' });
    const out = await addParticipant({ sessionId: 'qa_1', displayName: '  Alice  ' });
    expect(out.id).toBe('pt_1');
    expect(participantCreate).toHaveBeenCalledWith({
      data: { sessionId: 'qa_1', displayName: 'Alice' },
    });
  });

  it('stores null display name when omitted or blank', async () => {
    participantCreate.mockResolvedValue({ id: 'pt_1' });
    await addParticipant({ sessionId: 'qa_1' });
    await addParticipant({ sessionId: 'qa_1', displayName: '   ' });
    for (const call of participantCreate.mock.calls) {
      expect((call[0] as { data: { displayName: string | null } }).data.displayName).toBeNull();
    }
  });
});

describe('addQuestion', () => {
  it('creates a LIVE anonymous question by default with trimmed text', async () => {
    questionCreate.mockResolvedValueOnce({ id: 'q_1' });
    const out = await addQuestion({
      sessionId: 'qa_1',
      participantId: 'pt_1',
      text: '  Why broadcast?  ',
    });
    expect(out).toEqual({ id: 'q_1' });
    expect(questionCreate).toHaveBeenCalledWith({
      data: {
        sessionId: 'qa_1',
        participantId: 'pt_1',
        text: 'Why broadcast?',
        isAnonymous: true,
        authorDisplayName: null,
        status: 'LIVE',
      },
    });
  });

  it('never stores an author display name for anonymous questions', async () => {
    questionCreate.mockResolvedValueOnce({ id: 'q_1' });
    await addQuestion({
      sessionId: 'qa_1',
      participantId: 'pt_1',
      text: 'q',
      isAnonymous: true,
      authorDisplayName: 'Alice',
    });
    const call = questionCreate.mock.calls[0][0] as {
      data: { authorDisplayName: string | null };
    };
    expect(call.data.authorDisplayName).toBeNull();
  });

  it('stores the author display name for named questions', async () => {
    questionCreate.mockResolvedValueOnce({ id: 'q_1' });
    await addQuestion({
      sessionId: 'qa_1',
      participantId: 'pt_1',
      text: 'q',
      isAnonymous: false,
      authorDisplayName: '  Alice  ',
    });
    const call = questionCreate.mock.calls[0][0] as {
      data: { isAnonymous: boolean; authorDisplayName: string | null };
    };
    expect(call.data.isAnonymous).toBe(false);
    expect(call.data.authorDisplayName).toBe('Alice');
  });

  it('accepts IN_REVIEW status for moderated sessions', async () => {
    questionCreate.mockResolvedValueOnce({ id: 'q_1' });
    await addQuestion({
      sessionId: 'qa_1',
      participantId: 'pt_1',
      text: 'q',
      status: 'IN_REVIEW',
    });
    const call = questionCreate.mock.calls[0][0] as { data: { status: string } };
    expect(call.data.status).toBe('IN_REVIEW');
  });

  it('rejects creation statuses other than IN_REVIEW or LIVE', async () => {
    await expect(
      addQuestion({ sessionId: 'qa_1', participantId: 'pt_1', text: 'q', status: 'ANSWERED' }),
    ).rejects.toThrow('status');
  });

  it('rejects empty text and text over 500 chars', async () => {
    await expect(
      addQuestion({ sessionId: 'qa_1', participantId: 'pt_1', text: '   ' }),
    ).rejects.toThrow('Question text required');
    await expect(
      addQuestion({ sessionId: 'qa_1', participantId: 'pt_1', text: 'x'.repeat(501) }),
    ).rejects.toThrow('Question text too long');
  });
});

describe('setQuestionStatus', () => {
  it('sets approvedAt on first LIVE transition', async () => {
    questionFindUnique.mockResolvedValueOnce({ approvedAt: null });
    questionUpdate.mockResolvedValueOnce({ id: 'q_1', status: 'LIVE' });
    await setQuestionStatus({ questionId: 'q_1', status: 'LIVE' });
    const call = questionUpdate.mock.calls[0][0] as {
      where: { id: string };
      data: { status: string; approvedAt?: Date };
    };
    expect(call.where).toEqual({ id: 'q_1' });
    expect(call.data.status).toBe('LIVE');
    expect(call.data.approvedAt).toBeInstanceOf(Date);
  });

  it('does not overwrite approvedAt on subsequent LIVE transitions', async () => {
    questionFindUnique.mockResolvedValueOnce({ approvedAt: new Date('2026-06-01T00:00:00Z') });
    questionUpdate.mockResolvedValueOnce({ id: 'q_1', status: 'LIVE' });
    await setQuestionStatus({ questionId: 'q_1', status: 'LIVE' });
    const call = questionUpdate.mock.calls[0][0] as { data: { approvedAt?: Date } };
    expect(call.data.approvedAt).toBeUndefined();
  });

  it.each([
    ['ANSWERED', 'answeredAt'],
    ['ARCHIVED', 'archivedAt'],
    ['DISMISSED', 'dismissedAt'],
    ['WITHDRAWN', 'withdrawnAt'],
  ] as const)('sets %s timestamp', async (status, field) => {
    questionUpdate.mockResolvedValueOnce({ id: 'q_1', status });
    await setQuestionStatus({ questionId: 'q_1', status });
    const call = questionUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.status).toBe(status);
    expect(call.data[field]).toBeInstanceOf(Date);
  });

  it('IN_REVIEW only updates status', async () => {
    questionUpdate.mockResolvedValueOnce({ id: 'q_1', status: 'IN_REVIEW' });
    await setQuestionStatus({ questionId: 'q_1', status: 'IN_REVIEW' });
    const call = questionUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data).toEqual({ status: 'IN_REVIEW' });
  });
});

describe('editQuestionText', () => {
  it('preserves the original text on first edit', async () => {
    questionFindUnique.mockResolvedValueOnce({ text: 'orig??', originalText: null });
    questionUpdate.mockResolvedValueOnce({ id: 'q_1' });
    await editQuestionText({ questionId: 'q_1', text: '  orig?  ' });
    expect(questionUpdate).toHaveBeenCalledWith({
      where: { id: 'q_1' },
      data: { text: 'orig?', originalText: 'orig??' },
    });
  });

  it('does not overwrite originalText on later edits', async () => {
    questionFindUnique.mockResolvedValueOnce({ text: 'edited once', originalText: 'orig??' });
    questionUpdate.mockResolvedValueOnce({ id: 'q_1' });
    await editQuestionText({ questionId: 'q_1', text: 'edited twice' });
    expect(questionUpdate).toHaveBeenCalledWith({
      where: { id: 'q_1' },
      data: { text: 'edited twice' },
    });
  });

  it('throws when the question does not exist', async () => {
    questionFindUnique.mockResolvedValueOnce(null);
    await expect(editQuestionText({ questionId: 'q_x', text: 'q' })).rejects.toThrow(
      'Question not found',
    );
  });

  it('rejects empty and over-long text', async () => {
    await expect(editQuestionText({ questionId: 'q_1', text: '  ' })).rejects.toThrow(
      'Question text required',
    );
    await expect(editQuestionText({ questionId: 'q_1', text: 'x'.repeat(501) })).rejects.toThrow(
      'Question text too long',
    );
  });
});

describe('recordVote / removeVote', () => {
  it('upserts an UP vote by default keyed on question+participant', async () => {
    voteUpsert.mockResolvedValueOnce({ id: 'v_1', type: 'UP' });
    const out = await recordVote({ questionId: 'q_1', participantId: 'pt_1' });
    expect(out.type).toBe('UP');
    expect(voteUpsert).toHaveBeenCalledWith({
      where: {
        questionId_participantId: { questionId: 'q_1', participantId: 'pt_1' },
      },
      create: { questionId: 'q_1', participantId: 'pt_1', type: 'UP' },
      update: { type: 'UP' },
    });
  });

  it('switches vote type on re-vote', async () => {
    voteUpsert.mockResolvedValueOnce({ id: 'v_1', type: 'DOWN' });
    await recordVote({ questionId: 'q_1', participantId: 'pt_1', type: 'DOWN' });
    const call = voteUpsert.mock.calls[0][0] as {
      create: { type: string };
      update: { type: string };
    };
    expect(call.create.type).toBe('DOWN');
    expect(call.update.type).toBe('DOWN');
  });

  it('removeVote deletes the participant vote pair and returns count', async () => {
    voteDeleteMany.mockResolvedValueOnce({ count: 1 });
    const count = await removeVote({ questionId: 'q_1', participantId: 'pt_1' });
    expect(count).toBe(1);
    expect(voteDeleteMany).toHaveBeenCalledWith({
      where: { questionId: 'q_1', participantId: 'pt_1' },
    });
  });
});

describe('addReply', () => {
  it('creates a host reply with no participant linkage', async () => {
    replyCreate.mockResolvedValueOnce({ id: 'r_1' });
    const out = await addReply({ questionId: 'q_1', isHostReply: true, text: '  Answer  ' });
    expect(out).toEqual({ id: 'r_1' });
    expect(replyCreate).toHaveBeenCalledWith({
      data: {
        questionId: 'q_1',
        participantId: null,
        isHostReply: true,
        text: 'Answer',
      },
    });
  });

  it('creates a participant reply with participant linkage', async () => {
    replyCreate.mockResolvedValueOnce({ id: 'r_1' });
    await addReply({
      questionId: 'q_1',
      participantId: 'pt_1',
      isHostReply: false,
      text: 'me too',
    });
    expect(replyCreate).toHaveBeenCalledWith({
      data: {
        questionId: 'q_1',
        participantId: 'pt_1',
        isHostReply: false,
        text: 'me too',
      },
    });
  });

  it('rejects participant replies without participantId', async () => {
    await expect(addReply({ questionId: 'q_1', isHostReply: false, text: 'hi' })).rejects.toThrow(
      'participantId required',
    );
  });

  it('rejects empty and over-long reply text', async () => {
    await expect(addReply({ questionId: 'q_1', isHostReply: true, text: '  ' })).rejects.toThrow(
      'Reply text required',
    );
    await expect(
      addReply({ questionId: 'q_1', isHostReply: true, text: 'x'.repeat(1001) }),
    ).rejects.toThrow('Reply text too long');
  });
});

describe('labels', () => {
  it('createLabel trims name and defaults to host-only', async () => {
    labelCreate.mockResolvedValueOnce({ id: 'l_1', name: 'Logistics' });
    const out = await createLabel({ sessionId: 'qa_1', name: '  Logistics  ' });
    expect(out.id).toBe('l_1');
    expect(labelCreate).toHaveBeenCalledWith({
      data: { sessionId: 'qa_1', name: 'Logistics', participantSelectable: false },
    });
  });

  it('createLabel throws DuplicateLabelError on Prisma P2002', async () => {
    labelCreate.mockRejectedValueOnce({ code: 'P2002' });
    await expect(createLabel({ sessionId: 'qa_1', name: 'Logistics' })).rejects.toBeInstanceOf(
      DuplicateLabelError,
    );
  });

  it('createLabel rejects empty and over-long names', async () => {
    await expect(createLabel({ sessionId: 'qa_1', name: '   ' })).rejects.toThrow(
      'Label name required',
    );
    await expect(createLabel({ sessionId: 'qa_1', name: 'x'.repeat(51) })).rejects.toThrow(
      'Label name too long',
    );
  });

  it('updateLabel updates name and participantSelectable', async () => {
    labelUpdate.mockResolvedValueOnce({ id: 'l_1' });
    await updateLabel({ labelId: 'l_1', name: '  Venue  ', participantSelectable: true });
    expect(labelUpdate).toHaveBeenCalledWith({
      where: { id: 'l_1' },
      data: { name: 'Venue', participantSelectable: true },
    });
  });

  it('updateLabel throws DuplicateLabelError on Prisma P2002', async () => {
    labelUpdate.mockRejectedValueOnce({ code: 'P2002' });
    await expect(updateLabel({ labelId: 'l_1', name: 'Venue' })).rejects.toBeInstanceOf(
      DuplicateLabelError,
    );
  });

  it('deleteLabel deletes by id', async () => {
    labelDelete.mockResolvedValueOnce({ id: 'l_1' });
    await deleteLabel('l_1');
    expect(labelDelete).toHaveBeenCalledWith({ where: { id: 'l_1' } });
  });

  it('listLabels orders by createdAt ascending', async () => {
    labelFindMany.mockResolvedValueOnce([{ id: 'l_1' }]);
    const out = await listLabels('qa_1');
    expect(out).toEqual([{ id: 'l_1' }]);
    expect(labelFindMany).toHaveBeenCalledWith({
      where: { sessionId: 'qa_1' },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('assignLabel is idempotent via upsert on the compound key', async () => {
    questionLabelUpsert.mockResolvedValueOnce({ questionId: 'q_1', labelId: 'l_1' });
    await assignLabel({ questionId: 'q_1', labelId: 'l_1' });
    expect(questionLabelUpsert).toHaveBeenCalledWith({
      where: { questionId_labelId: { questionId: 'q_1', labelId: 'l_1' } },
      create: { questionId: 'q_1', labelId: 'l_1' },
      update: {},
    });
  });

  it('unassignLabel deletes the assignment and returns count', async () => {
    questionLabelDeleteMany.mockResolvedValueOnce({ count: 1 });
    const count = await unassignLabel({ questionId: 'q_1', labelId: 'l_1' });
    expect(count).toBe(1);
    expect(questionLabelDeleteMany).toHaveBeenCalledWith({
      where: { questionId: 'q_1', labelId: 'l_1' },
    });
  });
});

describe('logModerationEvent', () => {
  it('writes a moderation event row', async () => {
    moderationEventCreate.mockResolvedValueOnce({ id: 'me_1' });
    const out = await logModerationEvent({
      sessionId: 'qa_1',
      questionId: 'q_1',
      hostUserId: 'u_1',
      action: 'dismiss',
      reason: 'duplicate',
    });
    expect(out).toEqual({ id: 'me_1' });
    expect(moderationEventCreate).toHaveBeenCalledWith({
      data: {
        sessionId: 'qa_1',
        questionId: 'q_1',
        hostUserId: 'u_1',
        action: 'dismiss',
        reason: 'duplicate',
      },
    });
  });

  it('defaults optional fields to null and requires an action', async () => {
    moderationEventCreate.mockResolvedValueOnce({ id: 'me_1' });
    await logModerationEvent({ sessionId: 'qa_1', action: 'close_questions' });
    expect(moderationEventCreate).toHaveBeenCalledWith({
      data: {
        sessionId: 'qa_1',
        questionId: null,
        hostUserId: null,
        action: 'close_questions',
        reason: null,
      },
    });
    await expect(logModerationEvent({ sessionId: 'qa_1', action: '  ' })).rejects.toThrow(
      'Action required',
    );
  });
});

describe('loadSessionForHydration', () => {
  it('loads the full session graph ordered for replay', async () => {
    sessionFindUnique.mockResolvedValueOnce({
      id: 'qa_1',
      pin: '123456',
      participants: [],
      questions: [],
      labels: [],
    });
    const out = await loadSessionForHydration('123456');
    expect(out?.id).toBe('qa_1');
    expect(sessionFindUnique).toHaveBeenCalledWith({
      where: { pin: '123456' },
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
  });

  it('returns null when not found', async () => {
    sessionFindUnique.mockResolvedValueOnce(null);
    const out = await loadSessionForHydration('999999');
    expect(out).toBeNull();
  });
});

describe('toHostVisibleQuestion', () => {
  const base = {
    id: 'q_1',
    sessionId: 'qa_1',
    participantId: 'pt_1',
    text: 'Why?',
    originalText: null,
    isAnonymous: true,
    authorDisplayName: null,
    status: 'LIVE',
    submittedAt: new Date('2026-06-10T00:00:00Z'),
    approvedAt: null,
    answeredAt: null,
    archivedAt: null,
    dismissedAt: null,
    withdrawnAt: null,
    updatedAt: new Date('2026-06-10T00:00:00Z'),
  };

  it('strips participant linkage for all questions', () => {
    const dto = toHostVisibleQuestion({ ...base });
    expect('participantId' in dto).toBe(false);
  });

  it('exposes no author identity for anonymous questions', () => {
    const dto = toHostVisibleQuestion({
      ...base,
      isAnonymous: true,
      authorDisplayName: 'Leaked Name',
    });
    expect(dto.authorDisplayName).toBeNull();
  });

  it('keeps the display name for named questions', () => {
    const dto = toHostVisibleQuestion({
      ...base,
      isAnonymous: false,
      authorDisplayName: 'Alice',
    });
    expect(dto.authorDisplayName).toBe('Alice');
  });
});

describe('listSessionsForUser', () => {
  it('paginates with default limit 20 and orders by createdAt desc', async () => {
    sessionFindMany.mockResolvedValueOnce([{ id: 'qa_1' }]);
    await listSessionsForUser('u_1');
    expect(sessionFindMany).toHaveBeenCalledWith({
      where: { hostUserId: 'u_1' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      skip: 0,
    });
  });

  it('clamps limit to 1..100, offset to >=0, and filters by status', async () => {
    sessionFindMany.mockResolvedValue([]);
    await listSessionsForUser('u_1', { limit: 500, offset: -10 });
    const first = sessionFindMany.mock.calls[0][0] as { take: number; skip: number };
    expect(first.take).toBe(100);
    expect(first.skip).toBe(0);
    await listSessionsForUser('u_1', { status: 'ENDED', limit: 5, offset: 10 });
    expect(sessionFindMany).toHaveBeenLastCalledWith({
      where: { hostUserId: 'u_1', status: 'ENDED' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      skip: 10,
    });
  });
});
