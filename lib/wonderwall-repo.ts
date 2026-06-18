// Persistence layer for the WonderWall LinkedIn-iframe activity (MID-397).
// Mirrors lib/wordcloud-repo.ts and lib/qa-repo.ts: thin validated wrappers
// around Prisma so the API/socket/state layer can persist before broadcasting.
//
// Display-safety rule (the whole reason this module is centralized): a
// submitted LinkedIn URL must never reach the projector until the host
// approves it. Parsing a URL into an embed URL only means "technically
// understood", not "safe/appropriate/on-air" — the projector gate is the
// canDisplay column, not the parser. getPublicStateByPin() therefore returns
// ONLY status=APPROVED + canDisplay=true rows; pending/rejected/hidden/failed
// content is host- and submitter-feedback state only and must never leak onto
// a display surface. See docs/wonderwall-iframe-plan.md §5.3 and §7.2.

import {
  Prisma,
  type WonderWallPost,
  type WonderWallSession,
  type WonderWallStatus,
} from '@prisma/client';
import { prisma } from './db';
import { parseLinkedInPostUrl, type WonderWallParseResult } from './wonderwall-input';
import {
  WONDERWALL_DESCRIPTION_MAX,
  WONDERWALL_INSTRUCTIONS_MAX,
  WONDERWALL_TITLE_MAX,
} from './wonderwall-limits';

export { WONDERWALL_DESCRIPTION_MAX, WONDERWALL_INSTRUCTIONS_MAX, WONDERWALL_TITLE_MAX };
export const WONDERWALL_POST_LIMIT = 100;

// Public display/player DTO. Intentionally excludes every review-only field
// (submitterName/Key, rejectionReason, failureReason, review timestamps): the
// projector never needs them and they must not leak from the public endpoint.
// The literal status/canDisplay types encode the display invariant in the type
// system — getPublicStateByPin() can only ever emit approved, displayable rows.
export type WonderWallPublicPost = {
  id: string;
  originalUrl: string;
  urn: string;
  embedUrl: string;
  status: 'APPROVED';
  canDisplay: true;
  position: number;
};

export type WonderWallPublicState = {
  pin: string;
  title: string;
  description: string | null;
  instructions: string | null;
  status: WonderWallStatus;
  posts: WonderWallPublicPost[];
};

// Host control DTO. Includes every post regardless of status plus the full
// review/audit metadata so the control surface can render the review queue and
// "Can display?" chips. Host-only — never hand this to a public surface.
export type WonderWallHostState = {
  id: string;
  pin: string;
  title: string;
  description: string | null;
  instructions: string | null;
  status: WonderWallStatus;
  hostUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  endedAt: Date | null;
  posts: WonderWallPost[];
};

type WonderWallParseFailureReason = Extract<WonderWallParseResult, { ok: false }>['reason'];

export type WonderWallSubmissionErrorReason =
  | WonderWallParseFailureReason
  | 'session_not_found'
  | 'submissions_closed';

// Thrown when a participant submission cannot be persisted. `reason` is a
// machine-readable code the API layer maps to a user-facing message/HTTP code
// (see docs/wonderwall-iframe-plan.md §6.3 error codes). No row is created.
export class WonderWallSubmissionError extends Error {
  reason: WonderWallSubmissionErrorReason;
  constructor(reason: WonderWallSubmissionErrorReason) {
    super(`WonderWall submission rejected: ${reason}`);
    this.name = 'WonderWallSubmissionError';
    this.reason = reason;
  }
}

export class WonderWallNotFoundError extends Error {
  constructor(pinOrId: string) {
    super(`WonderWall session/post not found: ${pinOrId}`);
    this.name = 'WonderWallNotFoundError';
  }
}

export class WonderWallOwnershipError extends Error {
  constructor(pin: string) {
    super(`Host does not own WonderWall session ${pin}`);
    this.name = 'WonderWallOwnershipError';
  }
}

export class WonderWallReorderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WonderWallReorderError';
  }
}

export async function allocatePin(): Promise<string> {
  const { allocatePin: shared } = await import('./pin-allocator');
  return shared();
}

export async function createSession(args: {
  pin: string;
  title: string;
  description?: string | null;
  instructions?: string | null;
  status?: WonderWallStatus;
  hostUserId: string | null;
}): Promise<WonderWallSession> {
  if (!args.pin.trim()) throw new Error('PIN required');
  const title = args.title.trim();
  if (!title) throw new Error('Title required');
  if (title.length > WONDERWALL_TITLE_MAX) throw new Error('Title too long');
  const description = args.description?.trim() || null;
  if (description && description.length > WONDERWALL_DESCRIPTION_MAX) {
    throw new Error('Description too long');
  }
  const instructions = args.instructions?.trim() || null;
  if (instructions && instructions.length > WONDERWALL_INSTRUCTIONS_MAX) {
    throw new Error('Instructions too long');
  }
  return prisma.wonderWallSession.create({
    data: {
      pin: args.pin,
      title,
      description,
      instructions,
      ...(args.status ? { status: args.status } : {}),
      hostUserId: args.hostUserId,
    },
  });
}

// Public projection. Returns ONLY approved + displayable posts ordered for the
// waterfall. Returns null when the wall does not exist so callers can 404.
export async function getPublicStateByPin(pin: string): Promise<WonderWallPublicState | null> {
  const session = await prisma.wonderWallSession.findUnique({
    where: { pin },
    include: {
      posts: {
        where: { status: 'APPROVED', canDisplay: true },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });
  if (!session) return null;
  return {
    pin: session.pin,
    title: session.title,
    description: session.description,
    instructions: session.instructions,
    status: session.status,
    posts: session.posts.map((post) => ({
      id: post.id,
      originalUrl: post.originalUrl,
      urn: post.urn,
      embedUrl: post.embedUrl,
      status: 'APPROVED' as const,
      canDisplay: true as const,
      // Approved/displayable rows always carry a position; coerce defensively.
      position: post.position ?? 0,
    })),
  };
}

// Host projection. Includes all posts and review metadata for the control
// surface. Returns null when the wall does not exist; throws when the wall
// exists but the requesting host does not own it.
export async function getHostStateByPin(args: {
  pin: string;
  hostUserId: string;
}): Promise<WonderWallHostState | null> {
  const session = await prisma.wonderWallSession.findUnique({
    where: { pin: args.pin },
    include: {
      posts: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
    },
  });
  if (!session) return null;
  if (session.hostUserId !== args.hostUserId) throw new WonderWallOwnershipError(args.pin);
  return {
    id: session.id,
    pin: session.pin,
    title: session.title,
    description: session.description,
    instructions: session.instructions,
    status: session.status,
    hostUserId: session.hostUserId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    endedAt: session.endedAt,
    posts: session.posts,
  };
}

// Ownership guard for host-only mutations/exports. Throws if the wall is
// missing or owned by a different host; returns the session otherwise.
export async function assertHostOwnsSession(args: {
  pin: string;
  hostUserId: string;
}): Promise<WonderWallSession> {
  const session = await prisma.wonderWallSession.findUnique({ where: { pin: args.pin } });
  if (!session) throw new WonderWallNotFoundError(args.pin);
  if (session.hostUserId !== args.hostUserId) throw new WonderWallOwnershipError(args.pin);
  return session;
}

// Participant submission. Persists a VALID parser result as a PENDING,
// non-displayable row awaiting host review. Invalid URLs (and closed/missing
// walls) throw WonderWallSubmissionError and create no row, so the projector
// gate can never be bypassed by submission. A FAILED audit row, if desired for
// an unsupported URL, is created via reviewPost({ action: 'fail' }) rather than
// here — keeping the participant path strictly "valid → PENDING".
export async function submitPost(args: {
  pin: string;
  url: string;
  submitterName?: string | null;
  submitterKey?: string | null;
}): Promise<WonderWallPost> {
  const session = await prisma.wonderWallSession.findUnique({
    where: { pin: args.pin },
    select: { id: true, status: true },
  });
  if (!session) throw new WonderWallSubmissionError('session_not_found');
  if (session.status === 'ENDED' || session.status === 'ARCHIVED') {
    throw new WonderWallSubmissionError('submissions_closed');
  }
  const currentPostCount = await prisma.wonderWallPost.count({ where: { sessionId: session.id } });
  if (currentPostCount >= WONDERWALL_POST_LIMIT) {
    throw new WonderWallSubmissionError('submissions_closed');
  }
  const parsed = parseLinkedInPostUrl(args.url);
  if (!parsed.ok) throw new WonderWallSubmissionError(parsed.reason);
  return prisma.wonderWallPost.create({
    data: {
      sessionId: session.id,
      originalUrl: parsed.originalUrl,
      urn: parsed.urn,
      embedUrl: parsed.embedUrl,
      status: 'PENDING',
      canDisplay: false,
      submitterName: args.submitterName?.trim() || null,
      submitterKey: args.submitterKey?.trim() || null,
    },
  });
}

export type WonderWallReviewAction =
  | { action: 'approve' }
  | { action: 'reject'; reason?: string | null }
  | { action: 'hide' }
  | { action: 'restore' }
  | { action: 'fail'; reason?: string | null };

// Next display position for a session: max position among currently
// displayable posts, +1. Hidden/rejected/failed rows are excluded, so they do
// not reserve slots at the end of the waterfall.
async function nextDisplayPosition(
  tx: Prisma.TransactionClient,
  sessionId: string,
): Promise<number> {
  const agg = await tx.wonderWallPost.aggregate({
    where: { sessionId, canDisplay: true },
    _max: { position: true },
  });
  return (agg._max.position ?? -1) + 1;
}

async function displayPositionIsFree(
  tx: Prisma.TransactionClient,
  args: { sessionId: string; position: number; currentPostId: string },
): Promise<boolean> {
  const occupied = await tx.wonderWallPost.findFirst({
    where: {
      sessionId: args.sessionId,
      position: args.position,
      canDisplay: true,
      NOT: { id: args.currentPostId },
    },
    select: { id: true },
  });
  return occupied === null;
}

async function displayPositionForPost(
  tx: Prisma.TransactionClient,
  post: WonderWallPost,
): Promise<number> {
  if (
    post.position !== null &&
    (await displayPositionIsFree(tx, {
      sessionId: post.sessionId,
      position: post.position,
      currentPostId: post.id,
    }))
  ) {
    return post.position;
  }
  return nextDisplayPosition(tx, post.sessionId);
}

function isSerializableConflict(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2034'
  );
}

async function serializableWonderWallWrite<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err) {
      if (!isSerializableConflict(err)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

// Host review action — the ONLY path that can make a post displayable.
// Transactional so position assignment cannot race a concurrent approval.
//   approve : APPROVED + canDisplay=true, assign/reuse position, clear
//             rejection/failure feedback, stamp reviewedAt/approvedAt.
//   reject  : REJECTED + canDisplay=false, store rejectionReason, stamp
//             reviewedAt/rejectedAt.
//   hide    : HIDDEN + canDisplay=false, keep position AND approvedAt so a
//             later restore can reuse them.
//   restore : APPROVED + canDisplay=true again, reuse position if present else
//             assign next, stamp restoredAt.
//   fail    : FAILED + canDisplay=false, store failureReason. Never displayed.
export async function reviewPost(
  args: { postId: string; pin: string; hostUserId: string } & WonderWallReviewAction,
): Promise<WonderWallPost> {
  return serializableWonderWallWrite(async (tx) => {
    const post = await tx.wonderWallPost.findUnique({
      where: { id: args.postId },
      include: { session: { select: { pin: true, hostUserId: true } } },
    });
    if (!post) throw new WonderWallNotFoundError(args.postId);
    if (post.session.pin !== args.pin) throw new WonderWallNotFoundError(args.postId);
    if (post.session.hostUserId !== args.hostUserId) throw new WonderWallOwnershipError(args.pin);
    const now = new Date();
    const reviewedByHostUserId = args.hostUserId;

    switch (args.action) {
      case 'approve': {
        const position = await displayPositionForPost(tx, post);
        return tx.wonderWallPost.update({
          where: { id: post.id },
          data: {
            status: 'APPROVED',
            canDisplay: true,
            position,
            rejectionReason: null,
            failureReason: null,
            reviewedAt: now,
            reviewedByHostUserId,
            approvedAt: post.approvedAt ?? now,
          },
        });
      }
      case 'reject':
        return tx.wonderWallPost.update({
          where: { id: post.id },
          data: {
            status: 'REJECTED',
            canDisplay: false,
            rejectionReason: args.reason?.trim() || null,
            reviewedAt: now,
            reviewedByHostUserId,
            rejectedAt: now,
          },
        });
      case 'hide':
        return tx.wonderWallPost.update({
          where: { id: post.id },
          // Keep position and approvedAt untouched for a later restore.
          data: {
            status: 'HIDDEN',
            canDisplay: false,
            reviewedAt: now,
            reviewedByHostUserId,
            hiddenAt: now,
          },
        });
      case 'restore': {
        const position = await displayPositionForPost(tx, post);
        return tx.wonderWallPost.update({
          where: { id: post.id },
          data: {
            status: 'APPROVED',
            canDisplay: true,
            position,
            reviewedAt: now,
            reviewedByHostUserId,
            restoredAt: now,
            approvedAt: post.approvedAt ?? now,
          },
        });
      }
      case 'fail':
        return tx.wonderWallPost.update({
          where: { id: post.id },
          data: {
            status: 'FAILED',
            canDisplay: false,
            failureReason: args.reason?.trim() || null,
            reviewedAt: now,
            reviewedByHostUserId,
          },
        });
    }
  });
}

// Participant feedback scope. Returns every post submitted from one browser
// (sessionId + opaque submitterKey) so the participant page can show
// pending/approved/rejected/failed status. submitterKey is a convenience
// correlation id, NOT a security boundary. Empty key or unknown pin → [].
export async function getPostsForSubmitter(args: {
  pin: string;
  submitterKey: string;
}): Promise<WonderWallPost[]> {
  const submitterKey = args.submitterKey.trim();
  if (!submitterKey) return [];
  const session = await prisma.wonderWallSession.findUnique({
    where: { pin: args.pin },
    select: { id: true },
  });
  if (!session) return [];
  return prisma.wonderWallPost.findMany({
    where: { sessionId: session.id, submitterKey },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

// Host-only export source. Returns ALL submissions (every status) ordered
// stably by createdAt ASC then id ASC for a complete moderation/audit log.
// Ownership-guarded so a non-owner can never read another host's submissions.
export async function listPostsForExport(args: {
  pin: string;
  hostUserId: string;
}): Promise<WonderWallPost[]> {
  const session = await assertHostOwnsSession(args);
  return prisma.wonderWallPost.findMany({
    where: { sessionId: session.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

// Reassign display positions for the approved/displayable posts of one wall.
// All ids must belong to the session and be APPROVED + canDisplay; otherwise
// the whole reorder rolls back so the waterfall never ends up half-renumbered.
export async function reorderApprovedPosts(args: {
  sessionId: string;
  orderedPostIds: string[];
}): Promise<void> {
  const ids = args.orderedPostIds;
  if (new Set(ids).size !== ids.length) {
    throw new WonderWallReorderError('orderedPostIds must not contain duplicates');
  }
  await serializableWonderWallWrite(async (tx) => {
    const currentDisplayable = await tx.wonderWallPost.findMany({
      where: { sessionId: args.sessionId, status: 'APPROVED', canDisplay: true },
      select: { id: true, status: true, canDisplay: true },
    });
    if (currentDisplayable.length !== ids.length) {
      throw new WonderWallReorderError(
        'orderedPostIds must include every approved displayable post',
      );
    }
    const currentIds = new Set(currentDisplayable.map((post) => post.id));
    for (const id of ids) {
      if (!currentIds.has(id)) {
        throw new WonderWallReorderError('All reordered posts must belong to the session');
      }
    }
    for (let i = 0; i < ids.length; i++) {
      await tx.wonderWallPost.update({ where: { id: ids[i] }, data: { position: i } });
    }
  });
}

export async function listSessionsForUser(
  userId: string,
  opts: { status?: WonderWallStatus; limit?: number; offset?: number } = {},
): Promise<WonderWallSession[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  return prisma.wonderWallSession.findMany({
    where: {
      hostUserId: userId,
      ...(opts.status ? { status: opts.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });
}
