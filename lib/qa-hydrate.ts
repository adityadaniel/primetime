// Hydrates an in-memory QAState from Prisma rows after a server restart or
// first-time socket attach. Mirrors lib/wordcloud-hydrate.ts.

import { createQAState, type QAQuestionEntry, type QAState } from './qa';
import { loadSessionForHydration, type QASessionWithRelations } from './qa-repo';
import type { QASessionStatus } from './types';

const inFlightLoads = new Map<string, Promise<QAState | null>>();

// Map a Prisma QASessionStatus to the smaller in-memory state machine.
// ARCHIVED collapses to ENDED — the live socket treats both the same way:
// no transitions allowed, view-only.
function statusFromDb(status: QASessionWithRelations['status']): QASessionStatus {
  if (status === 'ARCHIVED') return 'ENDED';
  return status;
}

export function hydrateStateFromSession(session: QASessionWithRelations): QAState {
  const state = createQAState({
    pin: session.pin,
    sessionId: session.id,
    title: session.title,
    description: session.description,
    privacyMode: session.privacyMode,
    moderationEnabled: session.moderationEnabled,
    participantRepliesEnabled: session.participantRepliesEnabled,
    downvotesEnabled: session.downvotesEnabled,
    questionCharLimit: session.questionCharLimit,
    hostUserId: session.hostUserId,
  });
  state.status = statusFromDb(session.status);
  // submissionsOpen has no column: it is derived from session status.
  state.submissionsOpen = state.status === 'OPEN';
  state.votingOpen = state.status === 'ENDED' ? false : session.votingOpen;
  state.createdAt = session.createdAt.getTime();

  // Participants and questions are keyed by their DB ids, so votes, ownership
  // checks, and personal projections line up across restarts.
  for (const p of session.participants) {
    state.participants.set(p.id, { displayName: p.displayName });
  }
  for (const label of session.labels) {
    state.labels.set(label.id, {
      name: label.name,
      participantSelectable: label.participantSelectable,
    });
  }

  for (const q of session.questions) {
    const entry: QAQuestionEntry = {
      id: q.id,
      participantId: q.participantId,
      text: q.text,
      originalText: q.originalText,
      isAnonymous: q.isAnonymous,
      authorDisplayName: q.isAnonymous ? null : q.authorDisplayName,
      status: q.status,
      submittedAt: q.submittedAt.getTime(),
      approvedAt: q.approvedAt?.getTime() ?? null,
      answeredAt: q.answeredAt?.getTime() ?? null,
      archivedAt: q.archivedAt?.getTime() ?? null,
      dismissedAt: q.dismissedAt?.getTime() ?? null,
      withdrawnAt: q.withdrawnAt?.getTime() ?? null,
      labelIds: new Set(q.labels.map((l) => l.labelId)),
      votes: new Map(q.votes.map((v) => [v.participantId, v.type])),
      replies: q.replies.map((r) => ({
        id: r.id,
        participantId: r.participantId,
        isHostReply: r.isHostReply,
        text: r.text,
        createdAt: r.createdAt.getTime(),
      })),
    };
    state.questions.set(entry.id, entry);
  }

  // Restore the highlight only if it still points at a LIVE question; a stale
  // pointer (question answered/archived after the column was written) drops.
  const highlighted = session.highlightedQuestionId
    ? state.questions.get(session.highlightedQuestionId)
    : undefined;
  state.highlightedQuestionId = highlighted?.status === 'LIVE' ? highlighted.id : null;

  return state;
}

export async function loadOrCreateState(
  states: Map<string, QAState>,
  pin: string,
): Promise<QAState | null> {
  const cached = states.get(pin);
  if (cached) return cached;

  // Serialize concurrent first-time loads for the same PIN: without this, two
  // sockets connecting to a fresh PIN both miss the cache, both hydrate, and
  // the second states.set() orphans the first caller's state object.
  const inFlight = inFlightLoads.get(pin);
  if (inFlight) return inFlight;

  const load = (async () => {
    const session = await loadSessionForHydration(pin);
    if (!session) return null;
    // Re-check the cache: a prior in-flight load for this PIN may have resolved
    // and populated it while we awaited the DB.
    const raced = states.get(pin);
    if (raced) return raced;
    const state = hydrateStateFromSession(session);
    states.set(pin, state);
    return state;
  })();

  inFlightLoads.set(pin, load);
  try {
    return await load;
  } finally {
    inFlightLoads.delete(pin);
  }
}
