import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionCreate = vi.fn();
const sessionFindUnique = vi.fn();
const sessionUpdate = vi.fn();
const sessionFindMany = vi.fn();
const playerCreate = vi.fn();
const submissionCreate = vi.fn();
const submissionUpdateMany = vi.fn();
const submissionFindMany = vi.fn();
const moderationCreate = vi.fn();

vi.mock('./db', () => ({
  prisma: {
    wordCloudSession: {
      create: (args: unknown) => sessionCreate(args),
      findUnique: (args: unknown) => sessionFindUnique(args),
      update: (args: unknown) => sessionUpdate(args),
      findMany: (args: unknown) => sessionFindMany(args),
    },
    wordCloudPlayer: {
      create: (args: unknown) => playerCreate(args),
    },
    wordCloudSubmission: {
      create: (args: unknown) => submissionCreate(args),
      updateMany: (args: unknown) => submissionUpdateMany(args),
      findMany: (args: unknown) => submissionFindMany(args),
    },
    wordCloudModeration: {
      create: (args: unknown) => moderationCreate(args),
    },
  },
}));

import {
  addPlayer,
  addSubmission,
  createSession,
  DuplicateNicknameError,
  getAggregatedWords,
  getSessionByPin,
  listSessionsForUser,
  logModeration,
  markSubmissionRemoved,
  setStatus,
} from './wordcloud-repo';

beforeEach(() => {
  sessionCreate.mockReset();
  sessionFindUnique.mockReset();
  sessionUpdate.mockReset();
  sessionFindMany.mockReset();
  playerCreate.mockReset();
  submissionCreate.mockReset();
  submissionUpdateMany.mockReset();
  submissionFindMany.mockReset();
  moderationCreate.mockReset();
});

describe('createSession', () => {
  it('creates a session with trimmed prompt and default status', async () => {
    sessionCreate.mockResolvedValueOnce({ id: 'wc_1', pin: '123456' });
    const out = await createSession({
      pin: '123456',
      prompt: '  How do you feel?  ',
      wordsPerPlayer: 3,
      profanityFilter: true,
      hostUserId: 'u_1',
    });
    expect(out).toEqual({ id: 'wc_1', pin: '123456' });
    expect(sessionCreate).toHaveBeenCalledWith({
      data: {
        pin: '123456',
        prompt: 'How do you feel?',
        wordsPerPlayer: 3,
        profanityFilter: true,
        hostUserId: 'u_1',
      },
    });
  });

  it('rejects empty pin', async () => {
    await expect(
      createSession({
        pin: '   ',
        prompt: 'p',
        wordsPerPlayer: 3,
        profanityFilter: true,
        hostUserId: null,
      }),
    ).rejects.toThrow('PIN required');
  });

  it('rejects empty prompt', async () => {
    await expect(
      createSession({
        pin: '123456',
        prompt: '   ',
        wordsPerPlayer: 3,
        profanityFilter: true,
        hostUserId: null,
      }),
    ).rejects.toThrow('Prompt required');
  });

  it('rejects wordsPerPlayer outside 1..5', async () => {
    await expect(
      createSession({
        pin: '123456',
        prompt: 'p',
        wordsPerPlayer: 0,
        profanityFilter: true,
        hostUserId: null,
      }),
    ).rejects.toThrow('wordsPerPlayer');
    await expect(
      createSession({
        pin: '123456',
        prompt: 'p',
        wordsPerPlayer: 6,
        profanityFilter: true,
        hostUserId: null,
      }),
    ).rejects.toThrow('wordsPerPlayer');
  });
});

describe('getSessionByPin', () => {
  it('returns session with players + submissions ordered ascending', async () => {
    sessionFindUnique.mockResolvedValueOnce({
      id: 'wc_1',
      pin: '123456',
      players: [],
      submissions: [],
    });
    const out = await getSessionByPin('123456');
    expect(out?.id).toBe('wc_1');
    expect(sessionFindUnique).toHaveBeenCalledWith({
      where: { pin: '123456' },
      include: {
        players: { orderBy: { joinedAt: 'asc' } },
        submissions: { orderBy: { createdAt: 'asc' } },
      },
    });
  });

  it('returns null when not found', async () => {
    sessionFindUnique.mockResolvedValueOnce(null);
    const out = await getSessionByPin('999999');
    expect(out).toBeNull();
  });
});

describe('addPlayer', () => {
  it('creates a player with trimmed nickname', async () => {
    playerCreate.mockResolvedValueOnce({ id: 'p_1', nickname: 'Alice' });
    const out = await addPlayer({ sessionId: 'wc_1', nickname: '  Alice  ' });
    expect(out.id).toBe('p_1');
    expect(playerCreate).toHaveBeenCalledWith({
      data: { sessionId: 'wc_1', nickname: 'Alice' },
    });
  });

  it('throws DuplicateNicknameError on Prisma P2002', async () => {
    playerCreate.mockRejectedValueOnce({ code: 'P2002' });
    await expect(addPlayer({ sessionId: 'wc_1', nickname: 'Alice' })).rejects.toBeInstanceOf(
      DuplicateNicknameError,
    );
  });

  it('rethrows other errors unchanged', async () => {
    const boom = new Error('db down');
    playerCreate.mockRejectedValueOnce(boom);
    await expect(addPlayer({ sessionId: 'wc_1', nickname: 'Alice' })).rejects.toBe(boom);
  });

  it('rejects empty nickname', async () => {
    await expect(addPlayer({ sessionId: 'wc_1', nickname: '   ' })).rejects.toThrow(
      'Nickname required',
    );
  });
});

describe('addSubmission', () => {
  it('creates a submission row', async () => {
    submissionCreate.mockResolvedValueOnce({ id: 's_1' });
    const out = await addSubmission({
      sessionId: 'wc_1',
      playerId: 'p_1',
      rawText: 'Excited',
      normalized: 'excited',
    });
    expect(out).toEqual({ id: 's_1' });
    expect(submissionCreate).toHaveBeenCalledWith({
      data: {
        sessionId: 'wc_1',
        playerId: 'p_1',
        rawText: 'Excited',
        normalized: 'excited',
      },
    });
  });

  it('rejects empty rawText or normalized', async () => {
    await expect(
      addSubmission({
        sessionId: 'wc_1',
        playerId: 'p_1',
        rawText: '   ',
        normalized: 'x',
      }),
    ).rejects.toThrow('rawText');
    await expect(
      addSubmission({
        sessionId: 'wc_1',
        playerId: 'p_1',
        rawText: 'x',
        normalized: '   ',
      }),
    ).rejects.toThrow('normalized');
  });
});

describe('markSubmissionRemoved', () => {
  it('updates rows that match sessionId+normalized and not yet removed; returns count', async () => {
    submissionUpdateMany.mockResolvedValueOnce({ count: 3 });
    const count = await markSubmissionRemoved({
      sessionId: 'wc_1',
      normalized: 'excited',
    });
    expect(count).toBe(3);
    const call = submissionUpdateMany.mock.calls[0][0] as {
      where: { sessionId: string; normalized: string; removed: boolean };
      data: { removed: boolean; removedAt: Date };
    };
    expect(call.where).toEqual({
      sessionId: 'wc_1',
      normalized: 'excited',
      removed: false,
    });
    expect(call.data.removed).toBe(true);
    expect(call.data.removedAt).toBeInstanceOf(Date);
  });
});

describe('setStatus', () => {
  it('sets startedAt on first LIVE transition', async () => {
    sessionFindUnique.mockResolvedValueOnce({ startedAt: null });
    sessionUpdate.mockResolvedValueOnce({ id: 'wc_1', status: 'LIVE' });
    await setStatus({ sessionId: 'wc_1', status: 'LIVE' });
    const call = sessionUpdate.mock.calls[0][0] as {
      where: { id: string };
      data: { status: string; startedAt?: Date; endedAt?: Date };
    };
    expect(call.data.status).toBe('LIVE');
    expect(call.data.startedAt).toBeInstanceOf(Date);
    expect(call.data.endedAt).toBeUndefined();
  });

  it('does not overwrite startedAt on subsequent LIVE transition', async () => {
    sessionFindUnique.mockResolvedValueOnce({ startedAt: new Date('2026-05-23T00:00:00Z') });
    sessionUpdate.mockResolvedValueOnce({ id: 'wc_1', status: 'LIVE' });
    await setStatus({ sessionId: 'wc_1', status: 'LIVE' });
    const call = sessionUpdate.mock.calls[0][0] as {
      data: { startedAt?: Date };
    };
    expect(call.data.startedAt).toBeUndefined();
  });

  it('sets endedAt on ENDED', async () => {
    sessionUpdate.mockResolvedValueOnce({ id: 'wc_1', status: 'ENDED' });
    await setStatus({ sessionId: 'wc_1', status: 'ENDED' });
    const call = sessionUpdate.mock.calls[0][0] as {
      data: { status: string; endedAt?: Date };
    };
    expect(call.data.status).toBe('ENDED');
    expect(call.data.endedAt).toBeInstanceOf(Date);
  });

  it('PAUSED only updates status', async () => {
    sessionUpdate.mockResolvedValueOnce({ id: 'wc_1', status: 'PAUSED' });
    await setStatus({ sessionId: 'wc_1', status: 'PAUSED' });
    const call = sessionUpdate.mock.calls[0][0] as {
      data: { status: string; startedAt?: Date; endedAt?: Date };
    };
    expect(call.data).toEqual({ status: 'PAUSED' });
  });
});

describe('logModeration', () => {
  it('writes a moderation row', async () => {
    moderationCreate.mockResolvedValueOnce({ id: 'm_1' });
    const out = await logModeration({
      sessionId: 'wc_1',
      hostUserId: 'u_1',
      word: 'excited',
      reason: 'trash',
    });
    expect(out).toEqual({ id: 'm_1' });
    expect(moderationCreate).toHaveBeenCalledWith({
      data: {
        sessionId: 'wc_1',
        hostUserId: 'u_1',
        word: 'excited',
        reason: 'trash',
      },
    });
  });
});

describe('getAggregatedWords', () => {
  it('clusters by normalized, picks most-popular display variant, sorts desc by count', async () => {
    submissionFindMany.mockResolvedValueOnce([
      { rawText: 'Excited', normalized: 'excited' },
      { rawText: 'Excited', normalized: 'excited' },
      { rawText: 'EXCITED', normalized: 'excited' },
      { rawText: 'Tired', normalized: 'tired' },
    ]);
    const out = await getAggregatedWords('wc_1');
    expect(out).toEqual([
      { display: 'Excited', normalized: 'excited', count: 3 },
      { display: 'Tired', normalized: 'tired', count: 1 },
    ]);
    expect(submissionFindMany).toHaveBeenCalledWith({
      where: { sessionId: 'wc_1', removed: false },
      select: { rawText: true, normalized: true },
    });
  });

  it('breaks count ties alphabetically by normalized', async () => {
    submissionFindMany.mockResolvedValueOnce([
      { rawText: 'Banana', normalized: 'banana' },
      { rawText: 'Apple', normalized: 'apple' },
    ]);
    const out = await getAggregatedWords('wc_1');
    expect(out.map((w) => w.normalized)).toEqual(['apple', 'banana']);
  });

  it('returns empty array when no submissions', async () => {
    submissionFindMany.mockResolvedValueOnce([]);
    const out = await getAggregatedWords('wc_1');
    expect(out).toEqual([]);
  });
});

describe('listSessionsForUser', () => {
  it('paginates with default limit 20 and orders by createdAt desc', async () => {
    sessionFindMany.mockResolvedValueOnce([{ id: 'wc_1' }]);
    await listSessionsForUser('u_1');
    expect(sessionFindMany).toHaveBeenCalledWith({
      where: { hostUserId: 'u_1' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      skip: 0,
    });
  });

  it('clamps limit to 1..100 and offset to >=0', async () => {
    sessionFindMany.mockResolvedValueOnce([]);
    await listSessionsForUser('u_1', { limit: 500, offset: -10 });
    const call = sessionFindMany.mock.calls[0][0] as {
      take: number;
      skip: number;
    };
    expect(call.take).toBe(100);
    expect(call.skip).toBe(0);
  });

  it('filters by status when provided', async () => {
    sessionFindMany.mockResolvedValueOnce([]);
    await listSessionsForUser('u_1', { status: 'ENDED', limit: 5, offset: 10 });
    expect(sessionFindMany).toHaveBeenCalledWith({
      where: { hostUserId: 'u_1', status: 'ENDED' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      skip: 10,
    });
  });
});
