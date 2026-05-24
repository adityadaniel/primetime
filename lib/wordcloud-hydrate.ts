// Hydrates an in-memory WordCloudState from Prisma rows after server restart
// or first-time socket attach (F3 from the codex review).

import {
  createWordCloudState,
  normalizeWord,
  type WordCloudState,
  type WordCloudStateStatus,
} from './wordcloud';
import { getSessionByPin, type WordCloudSessionWithRelations } from './wordcloud-repo';

// Map a Prisma WordCloudStatus to the smaller in-memory state machine.
// ARCHIVED collapses to ENDED — the live socket treats both the same way:
// no transitions allowed, view-only.
function statusFromDb(status: WordCloudSessionWithRelations['status']): WordCloudStateStatus {
  if (status === 'ARCHIVED') return 'ENDED';
  return status;
}

export function hydrateStateFromSession(session: WordCloudSessionWithRelations): WordCloudState {
  const state = createWordCloudState({
    pin: session.pin,
    sessionId: session.id,
    prompt: session.prompt,
    wordsPerPlayer: session.wordsPerPlayer,
    profanityFilter: session.profanityFilter,
    hostUserId: session.hostUserId,
  });
  state.status = statusFromDb(session.status);

  // Players: rebuild map keyed by a synthetic in-memory id, but stash the DB
  // id on the entry so future submits can persist correctly.
  const dbIdToMemoryId = new Map<string, string>();
  for (const dbPlayer of session.players) {
    const memId = `wcp_${dbPlayer.id.slice(-7)}`;
    state.players.set(memId, {
      nickname: dbPlayer.nickname,
      submissions: [],
      dbPlayerId: dbPlayer.id,
    });
    dbIdToMemoryId.set(dbPlayer.id, memId);
  }

  // Submissions: aggregate non-removed into the words map, track removed
  // normals in trashedNormalized so a late-arriving duplicate persists with
  // removed=true (F5).
  for (const sub of session.submissions) {
    const memId = dbIdToMemoryId.get(sub.playerId);
    if (sub.removed) {
      state.trashedNormalized.add(sub.normalized);
      continue;
    }
    if (memId) {
      const player = state.players.get(memId);
      if (player && !player.submissions.includes(sub.normalized)) {
        player.submissions.push(sub.normalized);
      }
    }
    const existing = state.words.get(sub.normalized);
    if (existing) {
      existing.count += 1;
    } else {
      // Use the original raw casing (matches the in-memory submitWord path,
      // which also stores the first display variant). F12 (popular-casing
      // tracking) is out of scope for this PR.
      const norm = normalizeWord(sub.rawText);
      state.words.set(sub.normalized, {
        display: norm?.display ?? sub.rawText,
        count: 1,
      });
    }
  }

  return state;
}

export async function loadOrCreateState(
  states: Map<string, WordCloudState>,
  pin: string,
): Promise<WordCloudState | null> {
  const cached = states.get(pin);
  if (cached) return cached;
  const session = await getSessionByPin(pin);
  if (!session) return null;
  const state = hydrateStateFromSession(session);
  states.set(pin, state);
  return state;
}
