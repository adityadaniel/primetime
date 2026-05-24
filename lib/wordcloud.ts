import { isClean } from './profanity';

export type WordCloudStateStatus = 'LOBBY' | 'LIVE' | 'PAUSED' | 'ENDED';

export type WordCloudPlayerEntry = {
  nickname: string;
  submissions: string[];
  dbPlayerId: string | null;
};

export type WordCloudWordEntry = {
  display: string;
  count: number;
};

export type WordCloudState = {
  pin: string;
  sessionId: string;
  prompt: string;
  wordsPerPlayer: number;
  profanityFilter: boolean;
  status: WordCloudStateStatus;
  hostSocketId?: string;
  hostUserId: string | null;
  socketToPlayer: Map<string, string>;
  players: Map<string, WordCloudPlayerEntry>;
  words: Map<string, WordCloudWordEntry>;
  // Normalized words the host has trashed. Submissions that race the trash
  // event use this to persist with removed=true (F5 race guard).
  trashedNormalized: Set<string>;
  createdAt: number;
};

export type SubmitReason =
  | 'filter'
  | 'duplicate'
  | 'max_reached'
  | 'paused'
  | 'session_not_live'
  | 'unknown_player';

export type SubmitWordResult = {
  accepted: boolean;
  normalized?: string;
  display?: string;
  count?: number;
  reason?: SubmitReason;
};

export type AddPlayerResult = {
  playerId?: string;
  error?: 'duplicate_nickname';
};

const MAX_INPUT_LEN = 30;
const PUNCT_EDGE_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const COMBINING_RE = /\p{M}/gu;
const WHITESPACE_RE = /\s+/g;

export function normalizeWord(raw: string): { normalized: string; display: string } | null {
  if (typeof raw !== 'string') return null;
  if (raw.includes('\n') || raw.includes('\r')) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_INPUT_LEN) return null;

  const display = trimmed;

  const lowered = trimmed.toLowerCase();
  const stripped = lowered.normalize('NFD').replace(COMBINING_RE, '');
  const collapsed = stripped.replace(WHITESPACE_RE, ' ');
  const normalized = collapsed.replace(PUNCT_EDGE_RE, '');
  if (!normalized) return null;

  return { normalized, display };
}

export function createWordCloudState(args: {
  pin: string;
  sessionId: string;
  prompt: string;
  wordsPerPlayer: number;
  profanityFilter: boolean;
  hostUserId?: string | null;
}): WordCloudState {
  return {
    pin: args.pin,
    sessionId: args.sessionId,
    prompt: args.prompt,
    wordsPerPlayer: args.wordsPerPlayer,
    profanityFilter: args.profanityFilter,
    status: 'LOBBY',
    hostUserId: args.hostUserId ?? null,
    socketToPlayer: new Map(),
    players: new Map(),
    words: new Map(),
    trashedNormalized: new Set(),
    createdAt: Date.now(),
  };
}

export function addPlayerToCloud(
  state: WordCloudState,
  args: { nickname: string },
): AddPlayerResult {
  const trimmed = args.nickname.trim();
  const lower = trimmed.toLowerCase();
  for (const p of state.players.values()) {
    if (p.nickname.toLowerCase() === lower) {
      return { error: 'duplicate_nickname' };
    }
  }
  const playerId = `wcp_${Math.random().toString(36).slice(2, 9)}`;
  state.players.set(playerId, { nickname: trimmed, submissions: [], dbPlayerId: null });
  return { playerId };
}

export function submitWord(
  state: WordCloudState,
  args: { playerId: string; word: string },
): SubmitWordResult {
  if (state.status === 'PAUSED') return { accepted: false, reason: 'paused' };
  if (state.status !== 'LIVE') return { accepted: false, reason: 'session_not_live' };

  const player = state.players.get(args.playerId);
  if (!player) return { accepted: false, reason: 'unknown_player' };

  if (player.submissions.length >= state.wordsPerPlayer) {
    return { accepted: false, reason: 'max_reached' };
  }

  const norm = normalizeWord(args.word);
  if (!norm) return { accepted: false, reason: 'filter' };

  if (state.profanityFilter && !isClean(norm.normalized)) {
    return { accepted: false, reason: 'filter' };
  }

  if (player.submissions.includes(norm.normalized)) {
    return { accepted: false, reason: 'duplicate' };
  }

  player.submissions.push(norm.normalized);

  const existing = state.words.get(norm.normalized);
  if (existing) {
    existing.count += 1;
    return {
      accepted: true,
      normalized: norm.normalized,
      display: existing.display,
      count: existing.count,
    };
  }
  state.words.set(norm.normalized, { display: norm.display, count: 1 });
  return {
    accepted: true,
    normalized: norm.normalized,
    display: norm.display,
    count: 1,
  };
}

export function removeWord(
  state: WordCloudState,
  args: { normalized: string },
): { removed: boolean } {
  const had = state.words.delete(args.normalized);
  if (!had) return { removed: false };
  for (const player of state.players.values()) {
    player.submissions = player.submissions.filter((n) => n !== args.normalized);
  }
  return { removed: true };
}

export type SetStatusResult =
  | { ok: true; from: WordCloudStateStatus; to: WordCloudStateStatus }
  | {
      ok: false;
      reason: 'invalid_transition';
      from: WordCloudStateStatus;
      to: WordCloudStateStatus;
    };

const STATUS_TRANSITIONS: Record<WordCloudStateStatus, ReadonlySet<WordCloudStateStatus>> = {
  LOBBY: new Set<WordCloudStateStatus>(['LIVE']),
  LIVE: new Set<WordCloudStateStatus>(['PAUSED', 'ENDED']),
  PAUSED: new Set<WordCloudStateStatus>(['LIVE', 'ENDED']),
  // ENDED is terminal for live sockets — moderators can archive via DB only.
  ENDED: new Set<WordCloudStateStatus>(),
};

export function isValidTransition(from: WordCloudStateStatus, to: WordCloudStateStatus): boolean {
  return STATUS_TRANSITIONS[from]?.has(to) ?? false;
}

export function setStatus(state: WordCloudState, status: WordCloudStateStatus): SetStatusResult {
  const from = state.status;
  if (!isValidTransition(from, status)) {
    return { ok: false, reason: 'invalid_transition', from, to: status };
  }
  state.status = status;
  return { ok: true, from, to: status };
}

export function snapshotWords(
  state: WordCloudState,
): { normalized: string; display: string; count: number }[] {
  const out: { normalized: string; display: string; count: number }[] = [];
  for (const [normalized, entry] of state.words) {
    out.push({ normalized, display: entry.display, count: entry.count });
  }
  out.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.normalized.localeCompare(b.normalized);
  });
  return out;
}

export function playerSubmissions(
  state: WordCloudState,
  playerId: string,
): { normalized: string; display: string }[] {
  const player = state.players.get(playerId);
  if (!player) return [];
  const out: { normalized: string; display: string }[] = [];
  for (const normalized of player.submissions) {
    const entry = state.words.get(normalized);
    out.push({ normalized, display: entry?.display ?? normalized });
  }
  return out;
}
