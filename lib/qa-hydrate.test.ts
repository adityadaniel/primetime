import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadSessionForHydration = vi.fn();
vi.mock('./qa-repo', () => ({
  loadSessionForHydration: (pin: string) => loadSessionForHydration(pin),
}));

import type { QAState } from './qa';
import { personalState, publicState } from './qa';
import { hydrateStateFromSession, loadOrCreateState } from './qa-hydrate';

beforeEach(() => {
  loadSessionForHydration.mockReset();
});

const t0 = new Date('2026-06-10T10:00:00Z');
const t1 = new Date('2026-06-10T10:05:00Z');

const baseSession = {
  id: 'qas_1',
  pin: '654321',
  title: 'Ask us anything',
  description: 'Workshop questions',
  privacyMode: 'NAMED_BY_DEFAULT' as const,
  moderationEnabled: true,
  participantRepliesEnabled: true,
  downvotesEnabled: true,
  questionCharLimit: 280,
  status: 'OPEN' as const,
  votingOpen: true,
  highlightedQuestionId: null as string | null,
  hostUserId: 'user_a',
  createdAt: t0,
  updatedAt: t1,
  endedAt: null as Date | null,
};

function makeQuestion(overrides: Record<string, unknown>) {
  return {
    id: 'q1',
    sessionId: 'qas_1',
    participantId: 'p1',
    text: 'What is next?',
    originalText: null,
    isAnonymous: false,
    authorDisplayName: 'Alice',
    status: 'LIVE' as const,
    submittedAt: t0,
    approvedAt: t1,
    answeredAt: null,
    archivedAt: null,
    dismissedAt: null,
    withdrawnAt: null,
    updatedAt: t1,
    votes: [],
    labels: [],
    replies: [],
    ...overrides,
  };
}

const fullSession = {
  ...baseSession,
  highlightedQuestionId: 'q1',
  participants: [
    { id: 'p1', sessionId: 'qas_1', displayName: 'Alice', joinedAt: t0 },
    { id: 'p2', sessionId: 'qas_1', displayName: null, joinedAt: t0 },
  ],
  labels: [
    {
      id: 'l1',
      sessionId: 'qas_1',
      name: 'logistics',
      participantSelectable: true,
      createdAt: t0,
    },
  ],
  questions: [
    makeQuestion({
      id: 'q1',
      votes: [
        { id: 'v1', questionId: 'q1', participantId: 'p2', type: 'UP', createdAt: t1 },
        { id: 'v2', questionId: 'q1', participantId: 'p1', type: 'DOWN', createdAt: t1 },
      ],
      labels: [{ questionId: 'q1', labelId: 'l1', createdAt: t1 }],
      replies: [
        {
          id: 'r1',
          questionId: 'q1',
          participantId: null,
          isHostReply: true,
          text: 'Great question',
          createdAt: t1,
          updatedAt: t1,
        },
      ],
    }),
    makeQuestion({
      id: 'q2',
      participantId: 'p2',
      isAnonymous: true,
      authorDisplayName: null,
      status: 'IN_REVIEW' as const,
      approvedAt: null,
      originalText: 'original wording',
      text: 'edited wording',
      replies: [
        {
          id: 'r2',
          questionId: 'q2',
          participantId: null,
          isHostReply: true,
          text: 'private reply',
          createdAt: t1,
          updatedAt: t1,
        },
      ],
    }),
  ],
};

describe('hydrateStateFromSession', () => {
  it('restores settings, participants, labels, questions, votes, replies, and highlight', () => {
    const state = hydrateStateFromSession(fullSession);

    expect(state.pin).toBe('654321');
    expect(state.sessionId).toBe('qas_1');
    expect(state.hostUserId).toBe('user_a');
    expect(state.settings).toEqual({
      title: 'Ask us anything',
      description: 'Workshop questions',
      privacyMode: 'NAMED_BY_DEFAULT',
      moderationEnabled: true,
      participantRepliesEnabled: true,
      downvotesEnabled: true,
      questionCharLimit: 280,
    });
    expect(state.status).toBe('OPEN');
    expect(state.submissionsOpen).toBe(true);
    expect(state.votingOpen).toBe(true);

    expect(state.participants.get('p1')?.displayName).toBe('Alice');
    expect(state.participants.get('p2')?.displayName).toBeNull();

    expect(state.labels.get('l1')).toEqual({ name: 'logistics', participantSelectable: true });

    const q1 = state.questions.get('q1');
    expect(q1?.status).toBe('LIVE');
    expect(q1?.participantId).toBe('p1');
    expect(q1?.submittedAt).toBe(t0.getTime());
    expect(q1?.approvedAt).toBe(t1.getTime());
    expect(q1?.votes.get('p2')).toBe('UP');
    expect(q1?.votes.get('p1')).toBe('DOWN');
    expect([...(q1?.labelIds ?? [])]).toEqual(['l1']);
    expect(q1?.replies).toEqual([
      {
        id: 'r1',
        participantId: null,
        isHostReply: true,
        text: 'Great question',
        createdAt: t1.getTime(),
      },
    ]);

    const q2 = state.questions.get('q2');
    expect(q2?.status).toBe('IN_REVIEW');
    expect(q2?.text).toBe('edited wording');
    expect(q2?.originalText).toBe('original wording');

    expect(state.highlightedQuestionId).toBe('q1');
  });

  it('round-trips projections after a simulated restart', () => {
    const state = hydrateStateFromSession(fullSession);

    const pub = publicState(state);
    expect(pub.questions.map((q) => q.id)).toEqual(['q1']);
    expect(pub.questions[0].score).toBe(0);
    expect(pub.questions[0].upvotes).toBe(1);
    expect(pub.questions[0].downvotes).toBe(1);
    expect(pub.highlightedQuestionId).toBe('q1');
    expect(JSON.stringify(pub)).not.toContain('private reply');

    const personal = personalState(state, 'p2');
    expect(personal?.questions.map((q) => q.id)).toEqual(['q2']);
    expect(personal?.questions[0].replies.map((r) => r.text)).toEqual(['private reply']);
    expect(personal?.votes).toEqual({ q1: 'UP' });
  });

  it('derives submissionsOpen from status and keeps votingOpen from the column', () => {
    const closed = hydrateStateFromSession({
      ...fullSession,
      status: 'CLOSED' as const,
      votingOpen: true,
      highlightedQuestionId: null,
    });
    expect(closed.status).toBe('CLOSED');
    expect(closed.submissionsOpen).toBe(false);
    expect(closed.votingOpen).toBe(true);

    const votingClosed = hydrateStateFromSession({
      ...fullSession,
      votingOpen: false,
      highlightedQuestionId: null,
    });
    expect(votingClosed.votingOpen).toBe(false);
  });

  it('collapses ARCHIVED to ENDED and forces both flags closed', () => {
    const state = hydrateStateFromSession({
      ...fullSession,
      status: 'ARCHIVED' as 'ENDED',
      votingOpen: true,
      highlightedQuestionId: null,
    });
    expect(state.status).toBe('ENDED');
    expect(state.submissionsOpen).toBe(false);
    expect(state.votingOpen).toBe(false);
  });

  it('drops a stale highlight pointing at a non-LIVE or missing question', () => {
    const stale = hydrateStateFromSession({
      ...fullSession,
      highlightedQuestionId: 'q2',
    });
    expect(stale.highlightedQuestionId).toBeNull();

    const missing = hydrateStateFromSession({
      ...fullSession,
      highlightedQuestionId: 'gone',
    });
    expect(missing.highlightedQuestionId).toBeNull();
  });
});

describe('loadOrCreateState', () => {
  it('returns the cached state without hitting Prisma', async () => {
    const cache = new Map<string, QAState>();
    const cached = { pin: '111111' } as unknown as QAState;
    cache.set('111111', cached);
    const r = await loadOrCreateState(cache, '111111');
    expect(r).toBe(cached);
    expect(loadSessionForHydration).not.toHaveBeenCalled();
  });

  it('hydrates from Prisma when not cached, then caches the result', async () => {
    const cache = new Map<string, QAState>();
    loadSessionForHydration.mockResolvedValue(fullSession);
    const r1 = await loadOrCreateState(cache, '654321');
    expect(r1?.sessionId).toBe('qas_1');
    expect(cache.has('654321')).toBe(true);
    const r2 = await loadOrCreateState(cache, '654321');
    expect(r2).toBe(r1);
    expect(loadSessionForHydration).toHaveBeenCalledTimes(1);
  });

  it('returns null when Prisma has no row', async () => {
    const cache = new Map<string, QAState>();
    loadSessionForHydration.mockResolvedValue(null);
    const r = await loadOrCreateState(cache, '999999');
    expect(r).toBeNull();
    expect(cache.has('999999')).toBe(false);
  });
});
