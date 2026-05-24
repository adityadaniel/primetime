import { describe, expect, it } from 'vitest';
import {
  addPlayerToCloud,
  createWordCloudState,
  normalizeWord,
  removeWord,
  setStatus,
  submitWord,
  type WordCloudState,
} from './wordcloud';

function makeState(overrides?: {
  status?: WordCloudState['status'];
  wordsPerPlayer?: number;
  profanityFilter?: boolean;
}): WordCloudState {
  const state = createWordCloudState({
    pin: '123456',
    sessionId: 'sess_1',
    prompt: 'feeling',
    wordsPerPlayer: overrides?.wordsPerPlayer ?? 3,
    profanityFilter: overrides?.profanityFilter ?? true,
    hostUserId: null,
  });
  if (overrides?.status) state.status = overrides.status;
  return state;
}

describe('normalizeWord', () => {
  it('lowercases ASCII for clustering and preserves trimmed display casing', () => {
    expect(normalizeWord('Excited')).toEqual({ normalized: 'excited', display: 'Excited' });
    expect(normalizeWord('  HELLO  ')).toEqual({ normalized: 'hello', display: 'HELLO' });
  });

  it('strips diacritics via NFD', () => {
    expect(normalizeWord('café')).toEqual({ normalized: 'cafe', display: 'café' });
    expect(normalizeWord('naïve')?.normalized).toBe('naive');
  });

  it('collapses internal whitespace to single space', () => {
    const r = normalizeWord('hello   world');
    expect(r?.normalized).toBe('hello world');
    expect(r?.display).toBe('hello   world');
  });

  it('strips leading and trailing punctuation', () => {
    expect(normalizeWord('!hello!')?.normalized).toBe('hello');
    expect(normalizeWord('...wow.')?.normalized).toBe('wow');
    expect(normalizeWord('"quoted"')?.normalized).toBe('quoted');
  });

  it('rejects input over 30 chars', () => {
    expect(normalizeWord('a'.repeat(31))).toBeNull();
    expect(normalizeWord('a'.repeat(30))).not.toBeNull();
  });

  it('returns null for blank or empty after normalization', () => {
    expect(normalizeWord('')).toBeNull();
    expect(normalizeWord('   ')).toBeNull();
    expect(normalizeWord('!!!')).toBeNull();
  });

  it('rejects internal newlines', () => {
    expect(normalizeWord('foo\nbar')).toBeNull();
    expect(normalizeWord('foo\rbar')).toBeNull();
  });
});

describe('addPlayerToCloud', () => {
  it('returns a playerId on happy path', () => {
    const state = makeState();
    const result = addPlayerToCloud(state, { nickname: 'alice' });
    expect(result.playerId).toBeTruthy();
    expect(result.error).toBeUndefined();
    expect(state.players.size).toBe(1);
  });

  it('rejects duplicate nicknames case-insensitively', () => {
    const state = makeState();
    addPlayerToCloud(state, { nickname: 'Alice' });
    const dup = addPlayerToCloud(state, { nickname: 'alice' });
    expect(dup.error).toBe('duplicate_nickname');
    expect(dup.playerId).toBeUndefined();
  });
});

describe('submitWord', () => {
  function setupLive() {
    const state = makeState({ status: 'LIVE' });
    const join = addPlayerToCloud(state, { nickname: 'alice' });
    const playerId = join.playerId as string;
    return { state, playerId };
  }

  it('accepts a fresh word and increments count', () => {
    const { state, playerId } = setupLive();
    const r = submitWord(state, { playerId, word: 'happy' });
    expect(r.accepted).toBe(true);
    expect(r.normalized).toBe('happy');
    expect(r.display).toBe('happy');
    expect(r.count).toBe(1);
  });

  it('rejects words that fail the profanity filter', () => {
    const { state, playerId } = setupLive();
    const r = submitWord(state, { playerId, word: 'fuck' });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('filter');
  });

  it('rejects duplicate same-player same-word', () => {
    const { state, playerId } = setupLive();
    submitWord(state, { playerId, word: 'happy' });
    const r = submitWord(state, { playerId, word: 'Happy' });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('duplicate');
  });

  it('rejects when the player has reached wordsPerPlayer', () => {
    const state = makeState({ status: 'LIVE', wordsPerPlayer: 2 });
    const join = addPlayerToCloud(state, { nickname: 'bob' });
    const playerId = join.playerId as string;
    submitWord(state, { playerId, word: 'one' });
    submitWord(state, { playerId, word: 'two' });
    const r = submitWord(state, { playerId, word: 'three' });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('max_reached');
  });

  it('rejects submissions while paused', () => {
    const { state, playerId } = setupLive();
    setStatus(state, 'PAUSED');
    const r = submitWord(state, { playerId, word: 'something' });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('paused');
  });

  it('rejects submissions when session is not LIVE', () => {
    const state = makeState({ status: 'LOBBY' });
    const join = addPlayerToCloud(state, { nickname: 'alice' });
    const playerId = join.playerId as string;
    const r = submitWord(state, { playerId, word: 'hi' });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('session_not_live');
  });

  it('rejects when player is unknown', () => {
    const state = makeState({ status: 'LIVE' });
    const r = submitWord(state, { playerId: 'nope', word: 'hi' });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('unknown_player');
  });

  it('clusters two distinct players submitting the same word', () => {
    const state = makeState({ status: 'LIVE' });
    const a = addPlayerToCloud(state, { nickname: 'a' }).playerId as string;
    const b = addPlayerToCloud(state, { nickname: 'b' }).playerId as string;
    submitWord(state, { playerId: a, word: 'café' });
    const r = submitWord(state, { playerId: b, word: 'CAFE' });
    expect(r.accepted).toBe(true);
    expect(r.normalized).toBe('cafe');
    expect(r.count).toBe(2);
  });
});

describe('removeWord', () => {
  it("removes a word from the cloud and from each player's submissions", () => {
    const state = makeState({ status: 'LIVE' });
    const a = addPlayerToCloud(state, { nickname: 'a' }).playerId as string;
    const b = addPlayerToCloud(state, { nickname: 'b' }).playerId as string;
    submitWord(state, { playerId: a, word: 'happy' });
    submitWord(state, { playerId: b, word: 'happy' });
    submitWord(state, { playerId: a, word: 'tired' });

    const r = removeWord(state, { normalized: 'happy' });
    expect(r.removed).toBe(true);
    expect(state.words.has('happy')).toBe(false);
    expect(state.players.get(a)?.submissions).toEqual(['tired']);
    expect(state.players.get(b)?.submissions).toEqual([]);
  });

  it('returns removed:false for unknown word', () => {
    const state = makeState({ status: 'LIVE' });
    expect(removeWord(state, { normalized: 'missing' }).removed).toBe(false);
  });
});

describe('setStatus', () => {
  it('walks LOBBY → LIVE → PAUSED → LIVE → ENDED', () => {
    const state = makeState();
    expect(state.status).toBe('LOBBY');
    expect(setStatus(state, 'LIVE')).toEqual({ ok: true, from: 'LOBBY', to: 'LIVE' });
    expect(setStatus(state, 'PAUSED')).toEqual({ ok: true, from: 'LIVE', to: 'PAUSED' });
    expect(setStatus(state, 'LIVE')).toEqual({ ok: true, from: 'PAUSED', to: 'LIVE' });
    expect(setStatus(state, 'ENDED')).toEqual({ ok: true, from: 'LIVE', to: 'ENDED' });
    expect(state.status).toBe('ENDED');
  });

  it('rejects LOBBY → ENDED (must go through LIVE)', () => {
    const state = makeState();
    const r = setStatus(state, 'ENDED');
    expect(r).toEqual({ ok: false, reason: 'invalid_transition', from: 'LOBBY', to: 'ENDED' });
    expect(state.status).toBe('LOBBY');
  });

  it('rejects LOBBY → PAUSED', () => {
    const state = makeState();
    const r = setStatus(state, 'PAUSED');
    expect(r.ok).toBe(false);
    expect(state.status).toBe('LOBBY');
  });

  it('rejects ENDED → LIVE (terminal)', () => {
    const state = makeState({ status: 'ENDED' });
    const r = setStatus(state, 'LIVE');
    expect(r).toEqual({ ok: false, reason: 'invalid_transition', from: 'ENDED', to: 'LIVE' });
    expect(state.status).toBe('ENDED');
  });

  it('rejects ENDED → PAUSED (terminal)', () => {
    const state = makeState({ status: 'ENDED' });
    const r = setStatus(state, 'PAUSED');
    expect(r.ok).toBe(false);
    expect(state.status).toBe('ENDED');
  });

  it('rejects LIVE → LOBBY', () => {
    const state = makeState({ status: 'LIVE' });
    const r = setStatus(state, 'LOBBY');
    expect(r.ok).toBe(false);
    expect(state.status).toBe('LIVE');
  });

  it('rejects PAUSED → LOBBY', () => {
    const state = makeState({ status: 'PAUSED' });
    const r = setStatus(state, 'LOBBY');
    expect(r.ok).toBe(false);
    expect(state.status).toBe('PAUSED');
  });

  it('rejects re-entering same state (LIVE → LIVE)', () => {
    const state = makeState({ status: 'LIVE' });
    const r = setStatus(state, 'LIVE');
    expect(r.ok).toBe(false);
  });
});
