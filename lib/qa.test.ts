import { describe, expect, it } from 'vitest';
import {
  addParticipant,
  applyVote,
  approveQuestion,
  archiveQuestion,
  bindParticipantSocket,
  createQAState,
  dismissQuestion,
  editQuestion,
  highlightQuestion,
  hostState,
  isValidQuestionTransition,
  isValidSessionTransition,
  markAnswered,
  personalState,
  publicState,
  type QAState,
  removeVote,
  resolveJoinIdentity,
  restoreQuestion,
  setSessionStatus,
  setSubmissionsOpen,
  setVotingOpen,
  submitQuestion,
  withdrawQuestion,
} from './qa';
import type { QAQuestionStatus, QASessionStatus } from './types';

function makeState(overrides?: {
  privacyMode?: QAState['settings']['privacyMode'];
  moderationEnabled?: boolean;
  downvotesEnabled?: boolean;
  questionCharLimit?: number;
}): QAState {
  return createQAState({
    pin: '123456',
    sessionId: 'qas_1',
    title: 'Ask us anything',
    description: 'Workshop questions',
    privacyMode: overrides?.privacyMode ?? 'ANONYMOUS_BY_DEFAULT',
    moderationEnabled: overrides?.moderationEnabled ?? false,
    participantRepliesEnabled: false,
    downvotesEnabled: overrides?.downvotesEnabled ?? false,
    questionCharLimit: overrides?.questionCharLimit ?? 280,
    hostUserId: 'user_a',
  });
}

function join(state: QAState, displayName?: string): string {
  const r = addParticipant(state, { displayName });
  if (!r.ok) throw new Error(`join failed: ${r.reason}`);
  return r.participantId;
}

function submitLive(state: QAState, participantId: string, text = 'Why?'): string {
  const r = submitQuestion(state, { participantId, text });
  if (!r.ok) throw new Error(`submit failed: ${r.reason}`);
  return r.question.id;
}

describe('createQAState', () => {
  it('starts OPEN with submissions and voting open and no highlight', () => {
    const state = makeState();
    expect(state.pin).toBe('123456');
    expect(state.sessionId).toBe('qas_1');
    expect(state.status).toBe('OPEN');
    expect(state.submissionsOpen).toBe(true);
    expect(state.votingOpen).toBe(true);
    expect(state.highlightedQuestionId).toBeNull();
    expect(state.questions.size).toBe(0);
    expect(state.participants.size).toBe(0);
  });
});

describe('addParticipant', () => {
  it('adds a named participant', () => {
    const state = makeState();
    const r = addParticipant(state, { displayName: 'Alice' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(state.participants.get(r.participantId)?.displayName).toBe('Alice');
  });

  it('requires a display name when privacy is NAME_REQUIRED', () => {
    const state = makeState({ privacyMode: 'NAME_REQUIRED' });
    const r = addParticipant(state, {});
    expect(r).toEqual({ ok: false, reason: 'name_required' });
    const r2 = addParticipant(state, { displayName: '   ' });
    expect(r2).toEqual({ ok: false, reason: 'name_required' });
  });

  it('never stores a display name when privacy is ALWAYS_ANONYMOUS', () => {
    const state = makeState({ privacyMode: 'ALWAYS_ANONYMOUS' });
    const r = addParticipant(state, { displayName: 'Alice' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(state.participants.get(r.participantId)?.displayName).toBeNull();
  });

  it('rejects joins after the session has ended', () => {
    const state = makeState();
    setSessionStatus(state, 'ENDED');
    expect(addParticipant(state, { displayName: 'Late' })).toEqual({
      ok: false,
      reason: 'session_ended',
    });
  });

  it('honors a caller-supplied participantId for persisted rows', () => {
    const state = makeState();
    const r = addParticipant(state, { displayName: 'Alice', participantId: 'db_p1' });
    expect(r).toEqual({ ok: true, participantId: 'db_p1' });
    expect(state.participants.has('db_p1')).toBe(true);
  });
});

describe('resolveJoinIdentity', () => {
  it('trims the display name', () => {
    const state = makeState();
    expect(resolveJoinIdentity(state, '  Alice  ')).toEqual({ ok: true, displayName: 'Alice' });
  });

  it('treats a blank name as anonymous when names are optional', () => {
    const state = makeState();
    expect(resolveJoinIdentity(state, '   ')).toEqual({ ok: true, displayName: null });
    expect(resolveJoinIdentity(state)).toEqual({ ok: true, displayName: null });
  });

  it('rejects missing or blank names under NAME_REQUIRED', () => {
    const state = makeState({ privacyMode: 'NAME_REQUIRED' });
    expect(resolveJoinIdentity(state)).toEqual({ ok: false, reason: 'name_required' });
    expect(resolveJoinIdentity(state, '   ')).toEqual({ ok: false, reason: 'name_required' });
  });

  it('never returns a name under ALWAYS_ANONYMOUS', () => {
    const state = makeState({ privacyMode: 'ALWAYS_ANONYMOUS' });
    expect(resolveJoinIdentity(state, 'Alice')).toEqual({ ok: true, displayName: null });
  });

  it('rejects joins after the session has ended', () => {
    const state = makeState();
    setSessionStatus(state, 'ENDED');
    expect(resolveJoinIdentity(state, 'Late')).toEqual({ ok: false, reason: 'session_ended' });
  });
});

describe('bindParticipantSocket', () => {
  it('binds a socket to an existing participant', () => {
    const state = makeState();
    const pid = join(state, 'Alice');
    expect(bindParticipantSocket(state, 'sock-1', pid)).toBe(true);
    expect(state.socketToParticipant.get('sock-1')).toBe(pid);
  });

  it('rebinds a reconnecting participant without duplicating them', () => {
    const state = makeState();
    const pid = join(state, 'Alice');
    bindParticipantSocket(state, 'sock-old', pid);
    expect(bindParticipantSocket(state, 'sock-new', pid)).toBe(true);
    expect(state.participants.size).toBe(1);
    expect(state.socketToParticipant.has('sock-old')).toBe(false);
    expect(state.socketToParticipant.get('sock-new')).toBe(pid);
  });

  it('refuses to bind an unknown participant', () => {
    const state = makeState();
    expect(bindParticipantSocket(state, 'sock-1', 'nope')).toBe(false);
    expect(state.socketToParticipant.size).toBe(0);
  });

  it('leaves other participants bindings untouched', () => {
    const state = makeState();
    const alice = join(state, 'Alice');
    const bob = join(state, 'Bob');
    bindParticipantSocket(state, 'sock-a', alice);
    bindParticipantSocket(state, 'sock-b', bob);
    bindParticipantSocket(state, 'sock-a2', alice);
    expect(state.socketToParticipant.get('sock-b')).toBe(bob);
    expect(state.socketToParticipant.get('sock-a2')).toBe(alice);
    expect(state.socketToParticipant.has('sock-a')).toBe(false);
  });
});

describe('submitQuestion', () => {
  it('goes LIVE immediately when moderation is off', () => {
    const state = makeState();
    const pid = join(state);
    const r = submitQuestion(state, { participantId: pid, text: '  What is next?  ' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.question.status).toBe('LIVE');
      expect(r.question.text).toBe('What is next?');
      expect(r.question.participantId).toBe(pid);
    }
  });

  it('enters IN_REVIEW when moderation is on', () => {
    const state = makeState({ moderationEnabled: true });
    const pid = join(state);
    const r = submitQuestion(state, { participantId: pid, text: 'Moderate me' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.question.status).toBe('IN_REVIEW');
  });

  it('rejects empty and over-limit text', () => {
    const state = makeState({ questionCharLimit: 10 });
    const pid = join(state);
    expect(submitQuestion(state, { participantId: pid, text: '   ' })).toEqual({
      ok: false,
      reason: 'empty_text',
    });
    expect(submitQuestion(state, { participantId: pid, text: 'a'.repeat(11) })).toEqual({
      ok: false,
      reason: 'text_too_long',
    });
    expect(submitQuestion(state, { participantId: pid, text: 'a'.repeat(10) }).ok).toBe(true);
  });

  it('rejects unknown participants', () => {
    const state = makeState();
    expect(submitQuestion(state, { participantId: 'nope', text: 'hi' })).toEqual({
      ok: false,
      reason: 'unknown_participant',
    });
  });

  it('rejects submissions when submissions are closed', () => {
    const state = makeState();
    const pid = join(state);
    setSessionStatus(state, 'CLOSED');
    expect(submitQuestion(state, { participantId: pid, text: 'late' })).toEqual({
      ok: false,
      reason: 'submissions_closed',
    });
  });

  it('forces anonymity under ALWAYS_ANONYMOUS even when asked to be named', () => {
    const state = makeState({ privacyMode: 'ALWAYS_ANONYMOUS' });
    const pid = join(state, 'Alice');
    const r = submitQuestion(state, { participantId: pid, text: 'q', isAnonymous: false });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.question.isAnonymous).toBe(true);
      expect(r.question.authorDisplayName).toBeNull();
    }
  });

  it('forces named under NAME_REQUIRED and snapshots the author name', () => {
    const state = makeState({ privacyMode: 'NAME_REQUIRED' });
    const pid = join(state, 'Alice');
    const r = submitQuestion(state, { participantId: pid, text: 'q', isAnonymous: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.question.isAnonymous).toBe(false);
      expect(r.question.authorDisplayName).toBe('Alice');
    }
  });

  it('defaults to anonymous under ANONYMOUS_BY_DEFAULT and named under NAMED_BY_DEFAULT', () => {
    const anon = makeState({ privacyMode: 'ANONYMOUS_BY_DEFAULT' });
    const anonPid = join(anon, 'Alice');
    const r1 = submitQuestion(anon, { participantId: anonPid, text: 'q' });
    expect(r1.ok && r1.question.isAnonymous).toBe(true);

    const named = makeState({ privacyMode: 'NAMED_BY_DEFAULT' });
    const namedPid = join(named, 'Bob');
    const r2 = submitQuestion(named, { participantId: namedPid, text: 'q' });
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.question.isAnonymous).toBe(false);
      expect(r2.question.authorDisplayName).toBe('Bob');
    }
  });

  it('rejects a named submission when the participant has no display name', () => {
    const state = makeState({ privacyMode: 'NAMED_BY_DEFAULT' });
    const pid = join(state);
    expect(submitQuestion(state, { participantId: pid, text: 'q', isAnonymous: false })).toEqual({
      ok: false,
      reason: 'name_required',
    });
  });
});

describe('question status transitions (PRD §4.3)', () => {
  const all: QAQuestionStatus[] = [
    'IN_REVIEW',
    'LIVE',
    'ANSWERED',
    'ARCHIVED',
    'DISMISSED',
    'WITHDRAWN',
  ];
  const allowed: Record<QAQuestionStatus, QAQuestionStatus[]> = {
    IN_REVIEW: ['LIVE', 'DISMISSED', 'WITHDRAWN'],
    LIVE: ['ANSWERED', 'ARCHIVED', 'WITHDRAWN', 'IN_REVIEW'],
    ANSWERED: ['LIVE'],
    ARCHIVED: ['LIVE'],
    DISMISSED: ['IN_REVIEW'],
    WITHDRAWN: [],
  };

  it('matches the full transition matrix', () => {
    for (const from of all) {
      for (const to of all) {
        expect(isValidQuestionTransition(from, to), `${from} -> ${to}`).toBe(
          allowed[from].includes(to),
        );
      }
    }
  });

  it('approve moves IN_REVIEW to LIVE and stamps approvedAt', () => {
    const state = makeState({ moderationEnabled: true });
    const pid = join(state);
    const r = submitQuestion(state, { participantId: pid, text: 'q' });
    if (!r.ok) throw new Error('submit failed');
    const qid = r.question.id;
    expect(r.question.approvedAt).toBeNull();
    expect(approveQuestion(state, { questionId: qid }).ok).toBe(true);
    const q = state.questions.get(qid);
    expect(q?.status).toBe('LIVE');
    expect(q?.approvedAt).not.toBeNull();
  });

  it('rejects approving a LIVE question', () => {
    const state = makeState();
    const pid = join(state);
    const qid = submitLive(state, pid);
    expect(approveQuestion(state, { questionId: qid })).toMatchObject({
      ok: false,
      reason: 'invalid_transition',
    });
  });

  it('dismiss only applies to IN_REVIEW questions and restore returns them to review', () => {
    const state = makeState({ moderationEnabled: true });
    const pid = join(state);
    const r = submitQuestion(state, { participantId: pid, text: 'q' });
    if (!r.ok) throw new Error('submit failed');
    const qid = r.question.id;

    expect(dismissQuestion(state, { questionId: qid }).ok).toBe(true);
    expect(state.questions.get(qid)?.status).toBe('DISMISSED');
    expect(dismissQuestion(state, { questionId: qid })).toMatchObject({
      ok: false,
      reason: 'invalid_transition',
    });

    expect(restoreQuestion(state, { questionId: qid })).toMatchObject({
      ok: true,
      to: 'IN_REVIEW',
    });
    expect(state.questions.get(qid)?.status).toBe('IN_REVIEW');
  });

  it('markAnswered archives the question as ANSWERED and restore brings it back LIVE', () => {
    const state = makeState();
    const pid = join(state);
    const qid = submitLive(state, pid);
    expect(markAnswered(state, { questionId: qid }).ok).toBe(true);
    const q = state.questions.get(qid);
    expect(q?.status).toBe('ANSWERED');
    expect(q?.answeredAt).not.toBeNull();
    expect(restoreQuestion(state, { questionId: qid })).toMatchObject({ ok: true, to: 'LIVE' });
  });

  it('archive and restore round-trips a LIVE question', () => {
    const state = makeState();
    const pid = join(state);
    const qid = submitLive(state, pid);
    expect(archiveQuestion(state, { questionId: qid }).ok).toBe(true);
    expect(state.questions.get(qid)?.status).toBe('ARCHIVED');
    expect(restoreQuestion(state, { questionId: qid })).toMatchObject({ ok: true, to: 'LIVE' });
  });

  it('rejects restoring a LIVE question and unknown questions', () => {
    const state = makeState();
    const pid = join(state);
    const qid = submitLive(state, pid);
    expect(restoreQuestion(state, { questionId: qid })).toMatchObject({
      ok: false,
      reason: 'invalid_transition',
    });
    expect(markAnswered(state, { questionId: 'nope' })).toEqual({
      ok: false,
      reason: 'unknown_question',
    });
  });

  it('WITHDRAWN is terminal', () => {
    const state = makeState();
    const pid = join(state);
    const qid = submitLive(state, pid);
    expect(withdrawQuestion(state, { questionId: qid, participantId: pid }).ok).toBe(true);
    expect(restoreQuestion(state, { questionId: qid })).toMatchObject({
      ok: false,
      reason: 'invalid_transition',
    });
    expect(approveQuestion(state, { questionId: qid })).toMatchObject({
      ok: false,
      reason: 'invalid_transition',
    });
  });
});

describe('withdrawQuestion', () => {
  it('lets the owner withdraw a pending or live question', () => {
    const state = makeState({ moderationEnabled: true });
    const pid = join(state);
    const r = submitQuestion(state, { participantId: pid, text: 'q' });
    if (!r.ok) throw new Error('submit failed');
    expect(withdrawQuestion(state, { questionId: r.question.id, participantId: pid }).ok).toBe(
      true,
    );
    expect(state.questions.get(r.question.id)?.status).toBe('WITHDRAWN');
    expect(state.questions.get(r.question.id)?.withdrawnAt).not.toBeNull();
  });

  it('rejects withdrawal by a non-owner', () => {
    const state = makeState();
    const owner = join(state);
    const other = join(state);
    const qid = submitLive(state, owner);
    expect(withdrawQuestion(state, { questionId: qid, participantId: other })).toEqual({
      ok: false,
      reason: 'not_owner',
    });
  });

  it('rejects withdrawing an answered question', () => {
    const state = makeState();
    const pid = join(state);
    const qid = submitLive(state, pid);
    markAnswered(state, { questionId: qid });
    expect(withdrawQuestion(state, { questionId: qid, participantId: pid })).toMatchObject({
      ok: false,
      reason: 'invalid_transition',
    });
  });

  it('rejects withdrawing after the session has ended', () => {
    const state = makeState();
    const pid = join(state);
    const qid = submitLive(state, pid);
    setSessionStatus(state, 'ENDED');
    expect(withdrawQuestion(state, { questionId: qid, participantId: pid })).toEqual({
      ok: false,
      reason: 'session_ended',
    });
    expect(state.questions.get(qid)?.status).toBe('LIVE');
  });
});

describe('editQuestion', () => {
  it('host edit preserves the original text only once', () => {
    const state = makeState();
    const pid = join(state);
    const qid = submitLive(state, pid, 'orig text');
    expect(
      editQuestion(state, { questionId: qid, text: 'edit one', editor: { role: 'host' } }).ok,
    ).toBe(true);
    const q = state.questions.get(qid);
    expect(q?.text).toBe('edit one');
    expect(q?.originalText).toBe('orig text');
    editQuestion(state, { questionId: qid, text: 'edit two', editor: { role: 'host' } });
    expect(state.questions.get(qid)?.originalText).toBe('orig text');
  });

  it('participant edit of an approved question returns it to review when moderated', () => {
    const state = makeState({ moderationEnabled: true });
    const pid = join(state);
    const r = submitQuestion(state, { participantId: pid, text: 'q' });
    if (!r.ok) throw new Error('submit failed');
    approveQuestion(state, { questionId: r.question.id });
    const edit = editQuestion(state, {
      questionId: r.question.id,
      text: 'edited',
      editor: { role: 'participant', participantId: pid },
    });
    expect(edit.ok).toBe(true);
    expect(state.questions.get(r.question.id)?.status).toBe('IN_REVIEW');
  });

  it('participant edit without moderation stays LIVE', () => {
    const state = makeState();
    const pid = join(state);
    const qid = submitLive(state, pid);
    editQuestion(state, {
      questionId: qid,
      text: 'edited',
      editor: { role: 'participant', participantId: pid },
    });
    expect(state.questions.get(qid)?.status).toBe('LIVE');
  });

  it('rejects edits by non-owners and on settled questions', () => {
    const state = makeState();
    const owner = join(state);
    const other = join(state);
    const qid = submitLive(state, owner);
    expect(
      editQuestion(state, {
        questionId: qid,
        text: 'hax',
        editor: { role: 'participant', participantId: other },
      }),
    ).toEqual({ ok: false, reason: 'not_owner' });
    markAnswered(state, { questionId: qid });
    expect(
      editQuestion(state, { questionId: qid, text: 'late', editor: { role: 'host' } }),
    ).toEqual({ ok: false, reason: 'invalid_status' });
  });

  it('rejects participant edits after the session has ended but allows host edits', () => {
    const state = makeState();
    const pid = join(state);
    const qid = submitLive(state, pid, 'orig');
    setSessionStatus(state, 'ENDED');
    expect(
      editQuestion(state, {
        questionId: qid,
        text: 'too late',
        editor: { role: 'participant', participantId: pid },
      }),
    ).toEqual({ ok: false, reason: 'session_ended' });
    expect(state.questions.get(qid)?.text).toBe('orig');
    expect(
      editQuestion(state, { questionId: qid, text: 'host cleanup', editor: { role: 'host' } }).ok,
    ).toBe(true);
  });

  it('validates edited text against the char limit', () => {
    const state = makeState({ questionCharLimit: 5 });
    const pid = join(state);
    const qid = submitLive(state, pid, 'abc');
    expect(
      editQuestion(state, { questionId: qid, text: 'toolong', editor: { role: 'host' } }),
    ).toEqual({ ok: false, reason: 'text_too_long' });
    expect(editQuestion(state, { questionId: qid, text: '  ', editor: { role: 'host' } })).toEqual({
      ok: false,
      reason: 'empty_text',
    });
  });
});

describe('highlightQuestion', () => {
  it('enforces exactly one highlighted question', () => {
    const state = makeState();
    const pid = join(state);
    const q1 = submitLive(state, pid, 'first');
    const q2 = submitLive(state, pid, 'second');

    expect(highlightQuestion(state, { questionId: q1 })).toEqual({
      ok: true,
      previousQuestionId: null,
    });
    expect(state.highlightedQuestionId).toBe(q1);

    expect(highlightQuestion(state, { questionId: q2 })).toEqual({
      ok: true,
      previousQuestionId: q1,
    });
    expect(state.highlightedQuestionId).toBe(q2);
  });

  it('clears the highlight with null', () => {
    const state = makeState();
    const pid = join(state);
    const q1 = submitLive(state, pid);
    highlightQuestion(state, { questionId: q1 });
    expect(highlightQuestion(state, { questionId: null })).toEqual({
      ok: true,
      previousQuestionId: q1,
    });
    expect(state.highlightedQuestionId).toBeNull();
  });

  it('only LIVE questions can be highlighted', () => {
    const state = makeState({ moderationEnabled: true });
    const pid = join(state);
    const r = submitQuestion(state, { participantId: pid, text: 'pending' });
    if (!r.ok) throw new Error('submit failed');
    expect(highlightQuestion(state, { questionId: r.question.id })).toEqual({
      ok: false,
      reason: 'not_live',
    });
    expect(highlightQuestion(state, { questionId: 'nope' })).toEqual({
      ok: false,
      reason: 'unknown_question',
    });
  });

  it('clears the highlight when the highlighted question leaves LIVE', () => {
    const state = makeState();
    const pid = join(state);

    const q1 = submitLive(state, pid, 'one');
    highlightQuestion(state, { questionId: q1 });
    markAnswered(state, { questionId: q1 });
    expect(state.highlightedQuestionId).toBeNull();

    const q2 = submitLive(state, pid, 'two');
    highlightQuestion(state, { questionId: q2 });
    archiveQuestion(state, { questionId: q2 });
    expect(state.highlightedQuestionId).toBeNull();

    const q3 = submitLive(state, pid, 'three');
    highlightQuestion(state, { questionId: q3 });
    withdrawQuestion(state, { questionId: q3, participantId: pid });
    expect(state.highlightedQuestionId).toBeNull();
  });
});

describe('votes', () => {
  it('is idempotent per participant and derives the score from votes', () => {
    const state = makeState();
    const author = join(state);
    const voter = join(state);
    const qid = submitLive(state, author);

    const r1 = applyVote(state, { questionId: qid, participantId: voter });
    expect(r1).toMatchObject({ ok: true, score: 1, upvotes: 1, downvotes: 0 });
    const r2 = applyVote(state, { questionId: qid, participantId: voter });
    expect(r2).toMatchObject({ ok: true, score: 1, upvotes: 1, downvotes: 0 });

    const other = join(state);
    expect(applyVote(state, { questionId: qid, participantId: other })).toMatchObject({
      ok: true,
      score: 2,
      upvotes: 2,
    });
  });

  it('makes up and down mutually exclusive by switching the vote', () => {
    const state = makeState({ downvotesEnabled: true });
    const author = join(state);
    const voter = join(state);
    const qid = submitLive(state, author);

    applyVote(state, { questionId: qid, participantId: voter, type: 'UP' });
    const r = applyVote(state, { questionId: qid, participantId: voter, type: 'DOWN' });
    expect(r).toMatchObject({ ok: true, score: -1, upvotes: 0, downvotes: 1 });
    expect(state.questions.get(qid)?.votes.get(voter)).toBe('DOWN');
  });

  it('switches DOWN back to UP and adjusts the score both ways', () => {
    const state = makeState({ downvotesEnabled: true });
    const author = join(state);
    const voter = join(state);
    const qid = submitLive(state, author);

    applyVote(state, { questionId: qid, participantId: voter, type: 'DOWN' });
    const r = applyVote(state, { questionId: qid, participantId: voter, type: 'UP' });
    expect(r).toMatchObject({ ok: true, score: 1, upvotes: 1, downvotes: 0 });
    expect(state.questions.get(qid)?.votes.get(voter)).toBe('UP');
  });

  it('allows a participant to vote on their own question (explicit v1 decision)', () => {
    const state = makeState();
    const author = join(state);
    const qid = submitLive(state, author);
    expect(applyVote(state, { questionId: qid, participantId: author })).toMatchObject({
      ok: true,
      score: 1,
      upvotes: 1,
    });
  });

  it('rejects downvotes when downvotes are disabled', () => {
    const state = makeState();
    const author = join(state);
    const voter = join(state);
    const qid = submitLive(state, author);
    expect(applyVote(state, { questionId: qid, participantId: voter, type: 'DOWN' })).toEqual({
      ok: false,
      reason: 'downvotes_disabled',
    });
  });

  it('only LIVE questions accept votes', () => {
    const state = makeState({ moderationEnabled: true });
    const author = join(state);
    const voter = join(state);
    const r = submitQuestion(state, { participantId: author, text: 'pending' });
    if (!r.ok) throw new Error('submit failed');
    expect(applyVote(state, { questionId: r.question.id, participantId: voter })).toEqual({
      ok: false,
      reason: 'not_live',
    });
  });

  it('rejects votes when voting is closed and allows removal otherwise', () => {
    const state = makeState();
    const author = join(state);
    const voter = join(state);
    const qid = submitLive(state, author);
    applyVote(state, { questionId: qid, participantId: voter });

    const removed = removeVote(state, { questionId: qid, participantId: voter });
    expect(removed).toMatchObject({ ok: true, removed: true, score: 0 });
    const removedAgain = removeVote(state, { questionId: qid, participantId: voter });
    expect(removedAgain).toMatchObject({ ok: true, removed: false });

    setVotingOpen(state, false);
    expect(applyVote(state, { questionId: qid, participantId: voter })).toEqual({
      ok: false,
      reason: 'voting_closed',
    });
    expect(removeVote(state, { questionId: qid, participantId: voter })).toEqual({
      ok: false,
      reason: 'voting_closed',
    });
  });

  it('rejects votes from unknown participants and on unknown questions', () => {
    const state = makeState();
    const pid = join(state);
    const qid = submitLive(state, pid);
    expect(applyVote(state, { questionId: qid, participantId: 'ghost' })).toEqual({
      ok: false,
      reason: 'unknown_participant',
    });
    expect(applyVote(state, { questionId: 'nope', participantId: pid })).toEqual({
      ok: false,
      reason: 'unknown_question',
    });
  });
});

describe('session status and open flags', () => {
  it('follows OPEN -> CLOSED -> OPEN -> ENDED and rejects reopening an ended session', () => {
    const state = makeState();
    expect(setSessionStatus(state, 'CLOSED')).toEqual({ ok: true, from: 'OPEN', to: 'CLOSED' });
    expect(setSessionStatus(state, 'OPEN')).toEqual({ ok: true, from: 'CLOSED', to: 'OPEN' });
    expect(setSessionStatus(state, 'ENDED')).toEqual({ ok: true, from: 'OPEN', to: 'ENDED' });
    expect(setSessionStatus(state, 'OPEN')).toEqual({
      ok: false,
      reason: 'invalid_transition',
      from: 'ENDED',
      to: 'OPEN',
    });
  });

  it('exposes the full session transition matrix', () => {
    const all: QASessionStatus[] = ['OPEN', 'CLOSED', 'ENDED'];
    const allowed: Record<QASessionStatus, QASessionStatus[]> = {
      OPEN: ['CLOSED', 'ENDED'],
      CLOSED: ['OPEN', 'ENDED'],
      ENDED: [],
    };
    for (const from of all) {
      for (const to of all) {
        expect(isValidSessionTransition(from, to), `${from} -> ${to}`).toBe(
          allowed[from].includes(to),
        );
      }
    }
  });

  it('keeps submissionsOpen in sync with status', () => {
    const state = makeState();
    setSessionStatus(state, 'CLOSED');
    expect(state.submissionsOpen).toBe(false);
    setSessionStatus(state, 'OPEN');
    expect(state.submissionsOpen).toBe(true);
  });

  it('ENDED closes both submissions and voting', () => {
    const state = makeState();
    setSessionStatus(state, 'ENDED');
    expect(state.submissionsOpen).toBe(false);
    expect(state.votingOpen).toBe(false);
  });

  it('setSubmissionsOpen toggles between OPEN and CLOSED and is idempotent', () => {
    const state = makeState();
    expect(setSubmissionsOpen(state, false).ok).toBe(true);
    expect(state.status).toBe('CLOSED');
    expect(setSubmissionsOpen(state, false).ok).toBe(true);
    expect(setSubmissionsOpen(state, true).ok).toBe(true);
    expect(state.status).toBe('OPEN');
    setSessionStatus(state, 'ENDED');
    expect(setSubmissionsOpen(state, true)).toMatchObject({ ok: false });
  });

  it('voting can stay open while submissions are closed (PRD §4.10)', () => {
    const state = makeState();
    const author = join(state);
    const voter = join(state);
    const qid = submitLive(state, author);
    setSessionStatus(state, 'CLOSED');
    expect(applyVote(state, { questionId: qid, participantId: voter }).ok).toBe(true);
  });

  it('setVotingOpen rejects changes after the session ended', () => {
    const state = makeState();
    setSessionStatus(state, 'ENDED');
    expect(setVotingOpen(state, true)).toEqual({ ok: false, reason: 'session_ended' });
  });
});

describe('publicState projection', () => {
  it('contains only LIVE questions — never IN_REVIEW or DISMISSED', () => {
    const state = makeState({ moderationEnabled: true });
    const pid = join(state);

    const pending = submitQuestion(state, { participantId: pid, text: 'pending one' });
    const dismissed = submitQuestion(state, { participantId: pid, text: 'dismiss me' });
    const live = submitQuestion(state, { participantId: pid, text: 'live one' });
    if (!pending.ok || !dismissed.ok || !live.ok) throw new Error('submit failed');
    dismissQuestion(state, { questionId: dismissed.question.id });
    approveQuestion(state, { questionId: live.question.id });

    const pub = publicState(state);
    expect(pub.questions.map((q) => q.id)).toEqual([live.question.id]);
    expect(pub.questionCount).toBe(1);
    const serialized = JSON.stringify(pub);
    expect(serialized).not.toContain('pending one');
    expect(serialized).not.toContain('dismiss me');
  });

  it('hides answered, archived, and withdrawn questions from the live board', () => {
    const state = makeState();
    const pid = join(state);
    const answered = submitLive(state, pid, 'answered');
    const archived = submitLive(state, pid, 'archived');
    const withdrawn = submitLive(state, pid, 'withdrawn');
    const live = submitLive(state, pid, 'still live');
    markAnswered(state, { questionId: answered });
    archiveQuestion(state, { questionId: archived });
    withdrawQuestion(state, { questionId: withdrawn, participantId: pid });
    expect(publicState(state).questions.map((q) => q.id)).toEqual([live]);
  });

  it('never exposes participant linkage and nulls the author for anonymous questions', () => {
    const state = makeState({ privacyMode: 'ANONYMOUS_BY_DEFAULT' });
    const pid = join(state, 'Secret Name');
    submitLive(state, pid, 'anon question');
    const pub = publicState(state);
    expect(pub.questions[0].isAnonymous).toBe(true);
    expect(pub.questions[0].authorDisplayName).toBeNull();
    const serialized = JSON.stringify(pub);
    expect(serialized).not.toContain(pid);
    expect(serialized).not.toContain('Secret Name');
  });

  it('excludes private replies on non-live questions', () => {
    const state = makeState({ moderationEnabled: true });
    const pid = join(state);
    const r = submitQuestion(state, { participantId: pid, text: 'pending' });
    if (!r.ok) throw new Error('submit failed');
    r.question.replies.push({
      id: 'reply_1',
      participantId: null,
      isHostReply: true,
      text: 'private host reply',
      createdAt: Date.now(),
    });
    expect(JSON.stringify(publicState(state))).not.toContain('private host reply');
  });

  it('sorts by score descending then oldest first, and marks the highlight', () => {
    const state = makeState();
    const author = join(state);
    const v1 = join(state);
    const v2 = join(state);
    const qLow = submitLive(state, author, 'low');
    const qHigh = submitLive(state, author, 'high');
    applyVote(state, { questionId: qHigh, participantId: v1 });
    applyVote(state, { questionId: qHigh, participantId: v2 });
    applyVote(state, { questionId: qLow, participantId: v1 });
    highlightQuestion(state, { questionId: qLow });

    const pub = publicState(state);
    expect(pub.questions.map((q) => q.id)).toEqual([qHigh, qLow]);
    expect(pub.questions[1].highlighted).toBe(true);
    expect(pub.highlightedQuestionId).toBe(qLow);
    expect(pub.questions[0].score).toBe(2);
  });
});

describe('personalState projection', () => {
  it('includes own pending, withdrawn, and private data plus own votes', () => {
    const state = makeState({ moderationEnabled: true });
    const me = join(state, 'Me');
    const other = join(state, 'Other');

    const mine = submitQuestion(state, { participantId: me, text: 'my pending q' });
    const theirs = submitQuestion(state, { participantId: other, text: 'their pending q' });
    if (!mine.ok || !theirs.ok) throw new Error('submit failed');
    mine.question.replies.push({
      id: 'reply_1',
      participantId: null,
      isHostReply: true,
      text: 'private reply to you',
      createdAt: Date.now(),
    });

    const liveQ = submitQuestion(state, { participantId: other, text: 'live q' });
    if (!liveQ.ok) throw new Error('submit failed');
    approveQuestion(state, { questionId: liveQ.question.id });
    applyVote(state, { questionId: liveQ.question.id, participantId: me });

    const personal = personalState(state, me);
    expect(personal).not.toBeNull();
    if (!personal) return;
    expect(personal.participantId).toBe(me);
    expect(personal.questions.map((q) => q.id)).toEqual([mine.question.id]);
    expect(personal.questions[0].status).toBe('IN_REVIEW');
    expect(personal.questions[0].replies.map((r) => r.text)).toEqual(['private reply to you']);
    expect(personal.votes).toEqual({ [liveQ.question.id]: 'UP' });
    expect(JSON.stringify(personal)).not.toContain('their pending q');
  });

  it('returns null for unknown participants', () => {
    const state = makeState();
    expect(personalState(state, 'ghost')).toBeNull();
  });
});

describe('hostState projection', () => {
  it('boards LIVE and IN_REVIEW questions with status markers', () => {
    const state = makeState({ moderationEnabled: true });
    const pid = join(state);
    const pending = submitQuestion(state, { participantId: pid, text: 'pending one' });
    const live = submitQuestion(state, { participantId: pid, text: 'live one' });
    if (!pending.ok || !live.ok) throw new Error('submit failed');
    approveQuestion(state, { questionId: live.question.id });

    const host = hostState(state);
    expect(host.moderationEnabled).toBe(true);
    expect(host.questions.map((q) => q.id).sort()).toEqual(
      [pending.question.id, live.question.id].sort(),
    );
    expect(host.questions.find((q) => q.id === pending.question.id)?.status).toBe('IN_REVIEW');
    expect(host.questions.find((q) => q.id === live.question.id)?.status).toBe('LIVE');
  });

  it('counts questions by state and keeps settled ones off the board', () => {
    const state = makeState();
    const pid = join(state);
    const answered = submitLive(state, pid, 'answered q');
    const archived = submitLive(state, pid, 'archived q');
    const withdrawn = submitLive(state, pid, 'withdrawn q');
    const live = submitLive(state, pid, 'live q');
    markAnswered(state, { questionId: answered });
    archiveQuestion(state, { questionId: archived });
    withdrawQuestion(state, { questionId: withdrawn, participantId: pid });

    const host = hostState(state);
    expect(host.counts).toEqual({ live: 1, inReview: 0, answered: 1, archived: 1 });
    expect(host.questions.map((q) => q.id)).toEqual([live]);
    const serialized = JSON.stringify(host);
    expect(serialized).not.toContain('answered q');
    expect(serialized).not.toContain('withdrawn q');
  });

  it('keeps anonymous questions anonymous to the host — no participant linkage', () => {
    const state = makeState({ privacyMode: 'ANONYMOUS_BY_DEFAULT', moderationEnabled: true });
    const pid = join(state, 'Secret Name');
    const r = submitQuestion(state, { participantId: pid, text: 'anon pending q' });
    if (!r.ok) throw new Error('submit failed');

    const host = hostState(state);
    expect(host.questions[0].isAnonymous).toBe(true);
    expect(host.questions[0].authorDisplayName).toBeNull();
    const serialized = JSON.stringify(host);
    expect(serialized).not.toContain(pid);
    expect(serialized).not.toContain('Secret Name');
  });

  it('sorts by score descending then oldest first across statuses', () => {
    const state = makeState();
    const author = join(state);
    const v1 = join(state);
    const v2 = join(state);
    const qLow = submitLive(state, author, 'low');
    const qHigh = submitLive(state, author, 'high');
    applyVote(state, { questionId: qHigh, participantId: v1 });
    applyVote(state, { questionId: qHigh, participantId: v2 });
    applyVote(state, { questionId: qLow, participantId: v1 });
    highlightQuestion(state, { questionId: qLow });

    const host = hostState(state);
    expect(host.questions.map((q) => q.id)).toEqual([qHigh, qLow]);
    expect(host.questions[0].score).toBe(2);
    expect(host.questions[1].highlighted).toBe(true);
    expect(host.highlightedQuestionId).toBe(qLow);
    expect(host.participantCount).toBe(3);
  });
});
