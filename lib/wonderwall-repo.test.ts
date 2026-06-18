import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionCreate = vi.fn();
const sessionFindUnique = vi.fn();
const sessionFindMany = vi.fn();
const postCreate = vi.fn();
const postFindUnique = vi.fn();
const postFindMany = vi.fn();
const postFindFirst = vi.fn();
const postUpdate = vi.fn();
const postAggregate = vi.fn();
const postCount = vi.fn();

vi.mock('./db', () => {
  const prisma: Record<string, unknown> = {
    wonderWallSession: {
      create: (args: unknown) => sessionCreate(args),
      findUnique: (args: unknown) => sessionFindUnique(args),
      findMany: (args: unknown) => sessionFindMany(args),
    },
    wonderWallPost: {
      create: (args: unknown) => postCreate(args),
      findUnique: (args: unknown) => postFindUnique(args),
      findMany: (args: unknown) => postFindMany(args),
      findFirst: (args: unknown) => postFindFirst(args),
      update: (args: unknown) => postUpdate(args),
      aggregate: (args: unknown) => postAggregate(args),
      count: (args: unknown) => postCount(args),
    },
  };
  // Interactive-transaction mock: run the callback against the same mocked
  // client so per-model spies observe the writes made inside transactions.
  prisma.$transaction = (fn: (tx: unknown) => unknown) => fn(prisma);
  return { prisma };
});

import {
  assertHostOwnsSession,
  createSession,
  getHostStateByPin,
  getPostsForSubmitter,
  getPublicStateByPin,
  listPostsForExport,
  reorderApprovedPosts,
  reviewPost,
  submitPost,
  WONDERWALL_INSTRUCTIONS_MAX,
  WonderWallNotFoundError,
  WonderWallOwnershipError,
  WonderWallReorderError,
  WonderWallSubmissionError,
} from './wonderwall-repo';

beforeEach(() => {
  sessionCreate.mockReset();
  sessionFindUnique.mockReset();
  sessionFindMany.mockReset();
  postCreate.mockReset();
  postFindUnique.mockReset();
  postFindMany.mockReset();
  postFindFirst.mockReset();
  postUpdate.mockReset();
  postAggregate.mockReset();
  postCount.mockReset();
  postFindFirst.mockResolvedValue(null);
  postCount.mockResolvedValue(0);
  // Default: update echoes back the data it was given merged with the id.
  postUpdate.mockImplementation((args: { where: { id: string }; data: Record<string, unknown> }) =>
    Promise.resolve({ id: args.where.id, ...args.data }),
  );
});

describe('createSession', () => {
  it('creates a DRAFT session with trimmed fields and defaults', async () => {
    sessionCreate.mockResolvedValueOnce({ id: 'ww_1', pin: '123456' });
    const out = await createSession({
      pin: '123456',
      title: '  My Wall  ',
      description: '  about it  ',
      instructions: '  paste links  ',
      hostUserId: 'u_1',
    });
    expect(out).toEqual({ id: 'ww_1', pin: '123456' });
    expect(sessionCreate).toHaveBeenCalledWith({
      data: {
        pin: '123456',
        title: 'My Wall',
        description: 'about it',
        instructions: 'paste links',
        hostUserId: 'u_1',
      },
    });
  });

  it('passes an explicit status through', async () => {
    sessionCreate.mockResolvedValueOnce({ id: 'ww_1' });
    await createSession({ pin: '123456', title: 'X', status: 'LIVE', hostUserId: null });
    expect(sessionCreate.mock.calls[0][0].data.status).toBe('LIVE');
  });

  it('nulls empty optional fields', async () => {
    sessionCreate.mockResolvedValueOnce({ id: 'ww_1' });
    await createSession({
      pin: '123456',
      title: 'X',
      description: '   ',
      instructions: '',
      hostUserId: null,
    });
    expect(sessionCreate.mock.calls[0][0].data.description).toBeNull();
    expect(sessionCreate.mock.calls[0][0].data.instructions).toBeNull();
  });

  it('rejects missing pin/title and overlong fields', async () => {
    await expect(createSession({ pin: '  ', title: 'X', hostUserId: null })).rejects.toThrow(
      'PIN required',
    );
    await expect(createSession({ pin: '1', title: '  ', hostUserId: null })).rejects.toThrow(
      'Title required',
    );
    await expect(
      createSession({
        pin: '1',
        title: 'X',
        instructions: 'a'.repeat(WONDERWALL_INSTRUCTIONS_MAX + 1),
        hostUserId: null,
      }),
    ).rejects.toThrow('Instructions too long');
    expect(sessionCreate).not.toHaveBeenCalled();
  });
});

describe('getPublicStateByPin', () => {
  it('returns only approved + displayable posts as a public DTO', async () => {
    sessionFindUnique.mockResolvedValueOnce({
      pin: '123456',
      title: 'Wall',
      description: null,
      instructions: 'paste',
      status: 'LIVE',
      posts: [
        {
          id: 'p_1',
          originalUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:1/',
          urn: 'urn:li:activity:1',
          embedUrl: 'https://www.linkedin.com/embed/feed/update/urn:li:activity:1',
          status: 'APPROVED',
          canDisplay: true,
          position: 0,
          // Review-only fields that must NOT appear in the public DTO.
          submitterKey: 'browser-abc',
          rejectionReason: 'should not leak',
        },
      ],
    });

    const state = await getPublicStateByPin('123456');
    expect(state).toEqual({
      pin: '123456',
      title: 'Wall',
      description: null,
      instructions: 'paste',
      status: 'LIVE',
      posts: [
        {
          id: 'p_1',
          originalUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:1/',
          urn: 'urn:li:activity:1',
          embedUrl: 'https://www.linkedin.com/embed/feed/update/urn:li:activity:1',
          status: 'APPROVED',
          canDisplay: true,
          position: 0,
        },
      ],
    });
    // The query itself must constrain to approved + displayable, ordered.
    const arg = sessionFindUnique.mock.calls[0][0];
    expect(arg.include.posts.where).toEqual({ status: 'APPROVED', canDisplay: true });
    expect(arg.include.posts.orderBy).toEqual([{ position: 'asc' }, { createdAt: 'asc' }]);
  });

  it('returns null for an unknown pin', async () => {
    sessionFindUnique.mockResolvedValueOnce(null);
    expect(await getPublicStateByPin('000000')).toBeNull();
  });
});

describe('getHostStateByPin', () => {
  it('returns all posts and review metadata for the owner', async () => {
    sessionFindUnique.mockResolvedValueOnce({
      id: 'ww_1',
      pin: '123456',
      title: 'Wall',
      description: null,
      instructions: null,
      status: 'DRAFT',
      hostUserId: 'u_1',
      createdAt: new Date('2026-06-18T00:00:00Z'),
      updatedAt: new Date('2026-06-18T00:00:00Z'),
      endedAt: null,
      posts: [
        { id: 'p_1', status: 'PENDING', canDisplay: false },
        { id: 'p_2', status: 'REJECTED', canDisplay: false },
        { id: 'p_3', status: 'APPROVED', canDisplay: true },
      ],
    });
    const state = await getHostStateByPin({ pin: '123456', hostUserId: 'u_1' });
    expect(state?.posts.map((p) => p.status)).toEqual(['PENDING', 'REJECTED', 'APPROVED']);
    expect(sessionFindUnique.mock.calls[0][0].include.posts.orderBy).toEqual([
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('returns null for an unknown pin', async () => {
    sessionFindUnique.mockResolvedValueOnce(null);
    expect(await getHostStateByPin({ pin: '000000', hostUserId: 'u_1' })).toBeNull();
  });

  it('throws for the wrong host', async () => {
    sessionFindUnique.mockResolvedValueOnce({ hostUserId: 'u_owner', posts: [] });
    await expect(
      getHostStateByPin({ pin: '123456', hostUserId: 'u_other' }),
    ).rejects.toBeInstanceOf(WonderWallOwnershipError);
  });
});

describe('assertHostOwnsSession', () => {
  it('returns the session for the owner', async () => {
    sessionFindUnique.mockResolvedValueOnce({ id: 'ww_1', hostUserId: 'u_1' });
    const session = await assertHostOwnsSession({ pin: '123456', hostUserId: 'u_1' });
    expect(session.id).toBe('ww_1');
  });

  it('throws not-found when the session is missing', async () => {
    sessionFindUnique.mockResolvedValueOnce(null);
    await expect(
      assertHostOwnsSession({ pin: '000000', hostUserId: 'u_1' }),
    ).rejects.toBeInstanceOf(WonderWallNotFoundError);
  });

  it('throws ownership error for a different host', async () => {
    sessionFindUnique.mockResolvedValueOnce({ id: 'ww_1', hostUserId: 'u_owner' });
    await expect(
      assertHostOwnsSession({ pin: '123456', hostUserId: 'u_other' }),
    ).rejects.toBeInstanceOf(WonderWallOwnershipError);
  });
});

describe('submitPost', () => {
  it('persists a valid LinkedIn URL as PENDING + canDisplay=false', async () => {
    sessionFindUnique.mockResolvedValueOnce({ id: 'ww_1', status: 'DRAFT' });
    postCreate.mockResolvedValueOnce({ id: 'p_1' });
    await submitPost({
      pin: '123456',
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000000/',
      submitterName: '  Dani  ',
      submitterKey: '  browser-abc  ',
    });
    expect(postCreate).toHaveBeenCalledWith({
      data: {
        sessionId: 'ww_1',
        originalUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000000/',
        urn: 'urn:li:activity:7000000000000000000',
        embedUrl: 'https://www.linkedin.com/embed/feed/update/urn:li:activity:7000000000000000000',
        status: 'PENDING',
        canDisplay: false,
        submitterName: 'Dani',
        submitterKey: 'browser-abc',
      },
    });
  });

  it('throws a submission error with the parser reason for an invalid URL', async () => {
    sessionFindUnique.mockResolvedValueOnce({ id: 'ww_1', status: 'DRAFT' });
    const error = await submitPost({ pin: '123456', url: 'https://example.com/post/1' }).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(WonderWallSubmissionError);
    expect(error.reason).toBe('unsupported_host');
    expect(postCreate).not.toHaveBeenCalled();
  });

  it('throws session_not_found for an unknown pin', async () => {
    sessionFindUnique.mockResolvedValueOnce(null);
    await expect(
      submitPost({ pin: '000000', url: 'https://www.linkedin.com/feed/update/urn:li:activity:1/' }),
    ).rejects.toMatchObject({ reason: 'session_not_found' });
  });

  it('throws submissions_closed for an ended wall', async () => {
    sessionFindUnique.mockResolvedValueOnce({ id: 'ww_1', status: 'ENDED' });
    await expect(
      submitPost({ pin: '123456', url: 'https://www.linkedin.com/feed/update/urn:li:activity:1/' }),
    ).rejects.toMatchObject({ reason: 'submissions_closed' });
    expect(postCount).not.toHaveBeenCalled();
    expect(postCreate).not.toHaveBeenCalled();
  });

  it('throws submissions_closed when the post cap is reached', async () => {
    sessionFindUnique.mockResolvedValueOnce({ id: 'ww_1', status: 'LIVE' });
    postCount.mockResolvedValueOnce(100);
    await expect(
      submitPost({ pin: '123456', url: 'https://www.linkedin.com/feed/update/urn:li:activity:1/' }),
    ).rejects.toMatchObject({ reason: 'submissions_closed' });
    expect(postCount).toHaveBeenCalledWith({ where: { sessionId: 'ww_1' } });
    expect(postCreate).not.toHaveBeenCalled();
  });
});

const ownedReviewSession = { pin: '123456', hostUserId: 'u_1' };

describe('reviewPost', () => {
  it('approve assigns the next position and sets canDisplay=true', async () => {
    postFindUnique.mockResolvedValueOnce({
      id: 'p_1',
      sessionId: 'ww_1',
      status: 'PENDING',
      canDisplay: false,
      position: null,
      approvedAt: null,
      session: ownedReviewSession,
    });
    postAggregate.mockResolvedValueOnce({ _max: { position: 2 } });
    const out = await reviewPost({
      postId: 'p_1',
      pin: '123456',
      hostUserId: 'u_1',
      action: 'approve',
    });
    expect(postAggregate).toHaveBeenCalledWith({
      where: { sessionId: 'ww_1', canDisplay: true },
      _max: { position: true },
    });
    const data = postUpdate.mock.calls[0][0].data;
    expect(data.status).toBe('APPROVED');
    expect(data.canDisplay).toBe(true);
    expect(data.position).toBe(3);
    expect(data.rejectionReason).toBeNull();
    expect(data.failureReason).toBeNull();
    expect(data.reviewedByHostUserId).toBe('u_1');
    expect(data.approvedAt).toBeInstanceOf(Date);
    expect(out.position).toBe(3);
  });

  it('approve starts positions at 0 when nothing is displayable yet', async () => {
    postFindUnique.mockResolvedValueOnce({
      id: 'p_1',
      sessionId: 'ww_1',
      position: null,
      approvedAt: null,
      session: ownedReviewSession,
    });
    postAggregate.mockResolvedValueOnce({ _max: { position: null } });
    await reviewPost({ postId: 'p_1', pin: '123456', hostUserId: 'u_1', action: 'approve' });
    expect(postUpdate.mock.calls[0][0].data.position).toBe(0);
  });

  it('reject sets REJECTED + canDisplay=false and stores a trimmed reason', async () => {
    postFindUnique.mockResolvedValueOnce({
      id: 'p_1',
      sessionId: 'ww_1',
      session: ownedReviewSession,
    });
    await reviewPost({
      postId: 'p_1',
      pin: '123456',
      hostUserId: 'u_1',
      action: 'reject',
      reason: '  off topic  ',
    });
    const data = postUpdate.mock.calls[0][0].data;
    expect(data.status).toBe('REJECTED');
    expect(data.canDisplay).toBe(false);
    expect(data.rejectionReason).toBe('off topic');
    expect(data.rejectedAt).toBeInstanceOf(Date);
    expect(postAggregate).not.toHaveBeenCalled();
  });

  it('hide keeps position and approvedAt while clearing display', async () => {
    postFindUnique.mockResolvedValueOnce({
      id: 'p_1',
      sessionId: 'ww_1',
      status: 'APPROVED',
      canDisplay: true,
      position: 4,
      approvedAt: new Date('2026-06-18T00:00:00Z'),
      session: ownedReviewSession,
    });
    await reviewPost({ postId: 'p_1', pin: '123456', hostUserId: 'u_1', action: 'hide' });
    const data = postUpdate.mock.calls[0][0].data;
    expect(data.status).toBe('HIDDEN');
    expect(data.canDisplay).toBe(false);
    expect(data.hiddenAt).toBeInstanceOf(Date);
    // position/approvedAt are intentionally left untouched.
    expect(data).not.toHaveProperty('position');
    expect(data).not.toHaveProperty('approvedAt');
  });

  it('restore reuses the kept position and re-enables display', async () => {
    postFindUnique.mockResolvedValueOnce({
      id: 'p_1',
      sessionId: 'ww_1',
      status: 'HIDDEN',
      canDisplay: false,
      position: 4,
      approvedAt: new Date('2026-06-18T00:00:00Z'),
      session: ownedReviewSession,
    });
    await reviewPost({ postId: 'p_1', pin: '123456', hostUserId: 'u_1', action: 'restore' });
    expect(postFindFirst).toHaveBeenCalledWith({
      where: {
        sessionId: 'ww_1',
        position: 4,
        canDisplay: true,
        NOT: { id: 'p_1' },
      },
      select: { id: true },
    });
    const data = postUpdate.mock.calls[0][0].data;
    expect(data.status).toBe('APPROVED');
    expect(data.canDisplay).toBe(true);
    expect(data.position).toBe(4);
    expect(data.restoredAt).toBeInstanceOf(Date);
    // Existing approval time is preserved, not overwritten.
    expect(data.approvedAt).toEqual(new Date('2026-06-18T00:00:00Z'));
    expect(postAggregate).not.toHaveBeenCalled();
  });

  it('restore appends when the kept position has been reused', async () => {
    postFindUnique.mockResolvedValueOnce({
      id: 'p_1',
      sessionId: 'ww_1',
      status: 'HIDDEN',
      canDisplay: false,
      position: 4,
      approvedAt: new Date('2026-06-18T00:00:00Z'),
      session: ownedReviewSession,
    });
    postFindFirst.mockResolvedValueOnce({ id: 'p_new' });
    postAggregate.mockResolvedValueOnce({ _max: { position: 4 } });
    await reviewPost({ postId: 'p_1', pin: '123456', hostUserId: 'u_1', action: 'restore' });
    expect(postUpdate.mock.calls[0][0].data.position).toBe(5);
  });

  it('restore assigns a new position when none was kept', async () => {
    postFindUnique.mockResolvedValueOnce({
      id: 'p_1',
      sessionId: 'ww_1',
      status: 'HIDDEN',
      position: null,
      approvedAt: null,
      session: ownedReviewSession,
    });
    postAggregate.mockResolvedValueOnce({ _max: { position: 0 } });
    await reviewPost({ postId: 'p_1', pin: '123456', hostUserId: 'u_1', action: 'restore' });
    expect(postUpdate.mock.calls[0][0].data.position).toBe(1);
  });

  it('fail sets FAILED + canDisplay=false and never a position', async () => {
    postFindUnique.mockResolvedValueOnce({
      id: 'p_1',
      sessionId: 'ww_1',
      session: ownedReviewSession,
    });
    await reviewPost({
      postId: 'p_1',
      pin: '123456',
      hostUserId: 'u_1',
      action: 'fail',
      reason: 'unembeddable',
    });
    const data = postUpdate.mock.calls[0][0].data;
    expect(data.status).toBe('FAILED');
    expect(data.canDisplay).toBe(false);
    expect(data.failureReason).toBe('unembeddable');
    expect(data).not.toHaveProperty('position');
  });

  it('rejects review when the post belongs to a different wall pin', async () => {
    postFindUnique.mockResolvedValueOnce({
      id: 'p_1',
      sessionId: 'ww_2',
      position: null,
      approvedAt: null,
      session: { pin: '654321', hostUserId: 'u_1' },
    });
    await expect(
      reviewPost({ postId: 'p_1', pin: '123456', hostUserId: 'u_1', action: 'approve' }),
    ).rejects.toBeInstanceOf(WonderWallNotFoundError);
    expect(postUpdate).not.toHaveBeenCalled();
  });

  it('rejects review when the host does not own the wall', async () => {
    postFindUnique.mockResolvedValueOnce({
      id: 'p_1',
      sessionId: 'ww_1',
      position: null,
      approvedAt: null,
      session: { pin: '123456', hostUserId: 'u_owner' },
    });
    await expect(
      reviewPost({ postId: 'p_1', pin: '123456', hostUserId: 'u_other', action: 'approve' }),
    ).rejects.toBeInstanceOf(WonderWallOwnershipError);
    expect(postUpdate).not.toHaveBeenCalled();
  });

  it('throws not-found for an unknown post', async () => {
    postFindUnique.mockResolvedValueOnce(null);
    await expect(
      reviewPost({ postId: 'nope', pin: '123456', hostUserId: 'u_1', action: 'approve' }),
    ).rejects.toBeInstanceOf(WonderWallNotFoundError);
    expect(postUpdate).not.toHaveBeenCalled();
  });
});

describe('getPostsForSubmitter', () => {
  it('scopes posts to the session and submitter key', async () => {
    sessionFindUnique.mockResolvedValueOnce({ id: 'ww_1' });
    postFindMany.mockResolvedValueOnce([{ id: 'p_1' }]);
    const out = await getPostsForSubmitter({ pin: '123456', submitterKey: '  browser-abc  ' });
    expect(out).toEqual([{ id: 'p_1' }]);
    expect(postFindMany).toHaveBeenCalledWith({
      where: { sessionId: 'ww_1', submitterKey: 'browser-abc' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('returns [] for an empty key without querying posts', async () => {
    expect(await getPostsForSubmitter({ pin: '123456', submitterKey: '   ' })).toEqual([]);
    expect(sessionFindUnique).not.toHaveBeenCalled();
    expect(postFindMany).not.toHaveBeenCalled();
  });

  it('returns [] for an unknown pin', async () => {
    sessionFindUnique.mockResolvedValueOnce(null);
    expect(await getPostsForSubmitter({ pin: '000000', submitterKey: 'k' })).toEqual([]);
    expect(postFindMany).not.toHaveBeenCalled();
  });
});

describe('listPostsForExport', () => {
  it('returns all submissions ordered by createdAt then id for the owner', async () => {
    sessionFindUnique.mockResolvedValueOnce({ id: 'ww_1', hostUserId: 'u_1' });
    postFindMany.mockResolvedValueOnce([{ id: 'p_1' }, { id: 'p_2' }]);
    const out = await listPostsForExport({ pin: '123456', hostUserId: 'u_1' });
    expect(out).toHaveLength(2);
    expect(postFindMany).toHaveBeenCalledWith({
      where: { sessionId: 'ww_1' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('rejects a non-owner before reading posts', async () => {
    sessionFindUnique.mockResolvedValueOnce({ id: 'ww_1', hostUserId: 'u_owner' });
    await expect(
      listPostsForExport({ pin: '123456', hostUserId: 'u_other' }),
    ).rejects.toBeInstanceOf(WonderWallOwnershipError);
    expect(postFindMany).not.toHaveBeenCalled();
  });
});

describe('reorderApprovedPosts', () => {
  it('renumbers approved posts sequentially within the session', async () => {
    postFindMany.mockResolvedValueOnce([
      { id: 'p_2', status: 'APPROVED', canDisplay: true },
      { id: 'p_1', status: 'APPROVED', canDisplay: true },
    ]);
    await reorderApprovedPosts({ sessionId: 'ww_1', orderedPostIds: ['p_1', 'p_2'] });
    expect(postFindMany).toHaveBeenCalledWith({
      where: { sessionId: 'ww_1', status: 'APPROVED', canDisplay: true },
      select: { id: true, status: true, canDisplay: true },
    });
    expect(postUpdate.mock.calls).toEqual([
      [{ where: { id: 'p_1' }, data: { position: 0 } }],
      [{ where: { id: 'p_2' }, data: { position: 1 } }],
    ]);
  });

  it('rejects duplicate ids before touching the database', async () => {
    await expect(
      reorderApprovedPosts({ sessionId: 'ww_1', orderedPostIds: ['p_1', 'p_1'] }),
    ).rejects.toBeInstanceOf(WonderWallReorderError);
    expect(postFindMany).not.toHaveBeenCalled();
  });

  it('rejects partial reorder lists before renumbering', async () => {
    postFindMany.mockResolvedValueOnce([
      { id: 'p_1', status: 'APPROVED', canDisplay: true },
      { id: 'p_2', status: 'APPROVED', canDisplay: true },
      { id: 'p_3', status: 'APPROVED', canDisplay: true },
    ]);
    await expect(
      reorderApprovedPosts({ sessionId: 'ww_1', orderedPostIds: ['p_3', 'p_1'] }),
    ).rejects.toThrow('include every approved displayable post');
    expect(postUpdate).not.toHaveBeenCalled();
  });

  it('rejects when an id is not one of the session displayable posts', async () => {
    postFindMany.mockResolvedValueOnce([
      { id: 'p_1', status: 'APPROVED', canDisplay: true },
      { id: 'p_2', status: 'APPROVED', canDisplay: true },
    ]);
    await expect(
      reorderApprovedPosts({ sessionId: 'ww_1', orderedPostIds: ['p_1', 'p_missing'] }),
    ).rejects.toThrow('belong to the session');
    expect(postUpdate).not.toHaveBeenCalled();
  });
});
