import { describe, expect, it } from 'vitest';
import {
  addHostReply,
  addParticipant,
  addParticipantReply,
  applyVote,
  approveQuestion,
  archiveQuestion,
  assignLabel,
  bindParticipantSocket,
  createLabel,
  createQAState,
  dismissQuestion,
  editHostReply,
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
  restoreDismissedQuestion,
  restoreQuestion,
  setSessionStatus,
  setSubmissionsOpen,
  setVotingOpen,
  submitQuestion,
  toHostQuestion,
  toPublicQuestion,
  unassignLabel,
  withdrawQuestion,
} from './qa';
import type { QAQuestionStatus, QASessionStatus } from './types';

function makeState(overrides?: {
  privacyMode?: QAState['settings']['privacyMode'];
  moderationEnabled?: boolean;
  participantRepliesEnabled?: boolean;
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
    participantRepliesEnabled: overrides?.participantRepliesEnabled ?? false,
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
    // MID-339 review fix: a restored question is no longer answered — the
    // stale timestamp must not survive into exports.
    expect(q?.answeredAt).toBeNull();
  });

  it('archive and restore round-trips a LIVE question', () => {
    const state = makeState();
    const pid = join(state);
    const qid = submitLive(state, pid);
    expect(archiveQuestion(state, { questionId: qid }).ok).toBe(true);
    expect(state.questions.get(qid)?.status).toBe('ARCHIVED');
    expect(state.questions.get(qid)?.archivedAt).not.toBeNull();
    expect(restoreQuestion(state, { questionId: qid })).toMatchObject({ ok: true, to: 'LIVE' });
    expect(state.questions.get(qid)?.archivedAt).toBeNull();
  });

  it('restore to LIVE keeps the original approvedAt and dismissedAt semantics', () => {
    const state = makeState();
    const pid = join(state);
    const qid = submitLive(state, pid);
    const q = state.questions.get(qid);
    if (!q) throw new Error('question missing');
    // Force a known approvedAt to prove restore does not re-stamp it.
    q.approvedAt = 1111;
    expect(markAnswered(state, { questionId: qid }).ok).toBe(true);
    expect(restoreQuestion(state, { questionId: qid })).toMatchObject({ ok: true, to: 'LIVE' });
    expect(q.approvedAt).toBe(1111);

    // DISMISSED -> IN_REVIEW (MID-338) keeps dismissedAt untouched.
    const modState = makeState({ moderationEnabled: true });
    const modPid = join(modState);
    const r = submitQuestion(modState, { participantId: modPid, text: 'q' });
    if (!r.ok) throw new Error('submit failed');
    expect(dismissQuestion(modState, { questionId: r.question.id }).ok).toBe(true);
    expect(r.question.dismissedAt).not.toBeNull();
    expect(restoreQuestion(modState, { questionId: r.question.id })).toMatchObject({
      ok: true,
      to: 'IN_REVIEW',
    });
    expect(r.question.dismissedAt).not.toBeNull();
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

  // MID-338: the moderation-queue restore must be strictly DISMISSED ->
  // IN_REVIEW — it must never expose the MID-339 ANSWERED/ARCHIVED -> LIVE
  // restores that the generic restoreQuestion supports.
  it('restoreDismissedQuestion only restores DISMISSED back to IN_REVIEW', () => {
    const state = makeState({ moderationEnabled: true });
    const pid = join(state);
    const r = submitQuestion(state, { participantId: pid, text: 'q' });
    if (!r.ok) throw new Error('submit failed');
    const qid = r.question.id;

    expect(dismissQuestion(state, { questionId: qid }).ok).toBe(true);
    expect(restoreDismissedQuestion(state, { questionId: qid })).toMatchObject({
      ok: true,
      from: 'DISMISSED',
      to: 'IN_REVIEW',
    });
    expect(state.questions.get(qid)?.status).toBe('IN_REVIEW');
  });

  it('restoreDismissedQuestion rejects every non-DISMISSED status', () => {
    const statuses: QAQuestionStatus[] = ['IN_REVIEW', 'LIVE', 'ANSWERED', 'ARCHIVED', 'WITHDRAWN'];
    for (const status of statuses) {
      const state = makeState();
      const pid = join(state);
      const qid = submitLive(state, pid);
      const q = state.questions.get(qid);
      if (!q) throw new Error('question missing');
      q.status = status;
      expect(restoreDismissedQuestion(state, { questionId: qid }), status).toMatchObject({
        ok: false,
        reason: 'invalid_transition',
      });
      expect(state.questions.get(qid)?.status, status).toBe(status);
    }
    const state = makeState();
    expect(restoreDismissedQuestion(state, { questionId: 'nope' })).toEqual({
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

  // MID-339 review fix: restoring an answered/archived question to LIVE must
  // not resurrect its old highlight — the host re-highlights explicitly.
  it('restore to LIVE does not re-highlight a previously highlighted question', () => {
    const state = makeState();
    const pid = join(state);
    const qid = submitLive(state, pid);
    highlightQuestion(state, { questionId: qid });
    markAnswered(state, { questionId: qid });
    expect(state.highlightedQuestionId).toBeNull();
    expect(restoreQuestion(state, { questionId: qid })).toMatchObject({ ok: true, to: 'LIVE' });
    expect(state.highlightedQuestionId).toBeNull();
    // Once LIVE again it can be highlighted explicitly.
    expect(highlightQuestion(state, { questionId: qid })).toEqual({
      ok: true,
      previousQuestionId: null,
    });
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

  it('ENDED rejects stale participant submit and vote attempts with session_ended', () => {
    const state = makeState();
    const author = join(state);
    const voter = join(state);
    const qid = submitLive(state, author);
    setSessionStatus(state, 'ENDED');

    expect(submitQuestion(state, { participantId: author, text: 'too late' })).toEqual({
      ok: false,
      reason: 'session_ended',
    });
    expect(applyVote(state, { questionId: qid, participantId: voter })).toEqual({
      ok: false,
      reason: 'session_ended',
    });
    expect(removeVote(state, { questionId: qid, participantId: voter })).toEqual({
      ok: false,
      reason: 'session_ended',
    });
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

  it('counts questions by state and keeps only WITHDRAWN off the board', () => {
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
    expect(host.counts).toEqual({ live: 1, inReview: 0, answered: 1, archived: 1, dismissed: 0 });
    // ANSWERED/ARCHIVED rows board so the host can restore them (MID-339);
    // WITHDRAWN stays off — the participant took it back.
    expect(host.questions.map((q) => q.id).sort()).toEqual([answered, archived, live].sort());
    expect(JSON.stringify(host)).not.toContain('withdrawn q');
  });

  it('boards ANSWERED and ARCHIVED questions with status markers, host-only (MID-339)', () => {
    const state = makeState();
    const pid = join(state);
    const answered = submitLive(state, pid, 'answered q');
    const archived = submitLive(state, pid, 'archived q');
    markAnswered(state, { questionId: answered });
    archiveQuestion(state, { questionId: archived });

    const host = hostState(state);
    expect(host.questions.find((q) => q.id === answered)?.status).toBe('ANSWERED');
    expect(host.questions.find((q) => q.id === archived)?.status).toBe('ARCHIVED');
    // The host board sees them; the public board never does.
    const pub = JSON.stringify(publicState(state));
    expect(pub).not.toContain('answered q');
    expect(pub).not.toContain('archived q');
  });

  it('boards DISMISSED questions with status markers so the host can restore them (MID-338)', () => {
    const state = makeState({ moderationEnabled: true });
    const pid = join(state);
    const r = submitQuestion(state, { participantId: pid, text: 'spiked q' });
    if (!r.ok) throw new Error('submit failed');
    dismissQuestion(state, { questionId: r.question.id });

    const host = hostState(state);
    expect(host.counts).toEqual({ live: 0, inReview: 0, answered: 0, archived: 0, dismissed: 1 });
    expect(host.questions.map((q) => q.id)).toEqual([r.question.id]);
    expect(host.questions[0].status).toBe('DISMISSED');
    // The host board sees it; the public board never does.
    expect(JSON.stringify(publicState(state))).not.toContain('spiked q');
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

// MID-338: the moderation queue's whole point is private state separation —
// walk a question through every moderation transition and assert the public
// projection never carries IN_REVIEW or DISMISSED content at any step.
describe('moderation queue privacy (MID-338)', () => {
  function expectNotPublic(state: QAState, text: string) {
    const pub = publicState(state);
    expect(JSON.stringify(pub)).not.toContain(text);
    for (const q of pub.questions) {
      expect(['IN_REVIEW', 'DISMISSED']).not.toContain(
        state.questions.get(q.id)?.status ?? 'missing',
      );
    }
  }

  it('keeps a question private through submit -> dismiss -> restore -> approve', () => {
    const state = makeState({ moderationEnabled: true });
    const pid = join(state, 'Cara');
    const r = submitQuestion(state, { participantId: pid, text: 'lifecycle q' });
    if (!r.ok) throw new Error('submit failed');
    const qid = r.question.id;

    // Submitted: in review, host + owner only.
    expectNotPublic(state, 'lifecycle q');
    expect(hostState(state).questions.find((q) => q.id === qid)?.status).toBe('IN_REVIEW');
    expect(personalState(state, pid)?.questions[0]?.status).toBe('IN_REVIEW');

    // Dismissed: still private everywhere public.
    expect(dismissQuestion(state, { questionId: qid })).toMatchObject({ ok: true });
    expectNotPublic(state, 'lifecycle q');
    expect(personalState(state, pid)?.questions[0]?.status).toBe('DISMISSED');

    // Restored: back to review, still private.
    expect(restoreQuestion(state, { questionId: qid })).toMatchObject({
      ok: true,
      from: 'DISMISSED',
      to: 'IN_REVIEW',
    });
    expectNotPublic(state, 'lifecycle q');
    expect(personalState(state, pid)?.questions[0]?.status).toBe('IN_REVIEW');

    // Approved: NOW it is public.
    expect(approveQuestion(state, { questionId: qid })).toMatchObject({
      ok: true,
      from: 'IN_REVIEW',
      to: 'LIVE',
    });
    expect(publicState(state).questions.map((q) => q.id)).toEqual([qid]);
  });

  it('pulls a moderated participant edit of a LIVE question back out of public view', () => {
    const state = makeState({ moderationEnabled: true });
    const pid = join(state);
    const r = submitQuestion(state, { participantId: pid, text: 'approved q' });
    if (!r.ok) throw new Error('submit failed');
    approveQuestion(state, { questionId: r.question.id });
    expect(publicState(state).questions).toHaveLength(1);

    editQuestion(state, {
      questionId: r.question.id,
      text: 'edited back to review',
      editor: { role: 'participant', participantId: pid },
    });
    expectNotPublic(state, 'edited back to review');
    expect(publicState(state).questions).toHaveLength(0);
  });

  it('handles bulk approve and bulk dismiss with the same privacy guarantees', () => {
    const state = makeState({ moderationEnabled: true });
    const pid = join(state);
    const submitted: string[] = [];
    for (const text of ['bulk one', 'bulk two', 'bulk three', 'bulk four']) {
      const r = submitQuestion(state, { participantId: pid, text });
      if (!r.ok) throw new Error('submit failed');
      submitted.push(r.question.id);
    }
    expect(publicState(state).questions).toHaveLength(0);

    // Bulk approve the first two; bulk dismiss the last two — the helpers
    // are per-question, so bulk is a loop at the socket layer.
    for (const qid of submitted.slice(0, 2)) {
      expect(approveQuestion(state, { questionId: qid })).toMatchObject({ ok: true, to: 'LIVE' });
    }
    for (const qid of submitted.slice(2)) {
      expect(dismissQuestion(state, { questionId: qid })).toMatchObject({
        ok: true,
        to: 'DISMISSED',
      });
    }

    const pub = publicState(state);
    expect(pub.questions.map((q) => q.id).sort()).toEqual(submitted.slice(0, 2).sort());
    expectNotPublic(state, 'bulk three');
    expectNotPublic(state, 'bulk four');
    const host = hostState(state);
    expect(host.counts).toEqual({ live: 2, inReview: 0, answered: 0, archived: 0, dismissed: 2 });
  });

  it('dismiss is only reachable from IN_REVIEW, so a public question can never silently vanish into DISMISSED', () => {
    const state = makeState();
    const pid = join(state);
    const qid = submitLive(state, pid, 'live q');
    expect(dismissQuestion(state, { questionId: qid })).toMatchObject({
      ok: false,
      reason: 'invalid_transition',
    });
    expect(state.questions.get(qid)?.status).toBe('LIVE');
  });
});

describe('labels (MID-340)', () => {
  function makeLabel(state: QAState, name = 'Logistics', participantSelectable = false): string {
    const r = createLabel(state, { name, participantSelectable });
    if (!r.ok) throw new Error(`createLabel failed: ${r.reason}`);
    return r.labelId;
  }

  describe('createLabel', () => {
    it('creates a session-scoped label, trimmed, defaulting to host-only', () => {
      const state = makeState();
      const r = createLabel(state, { name: '  Logistics  ' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.label).toEqual({ name: 'Logistics', participantSelectable: false });
      expect(state.labels.get(r.labelId)).toEqual(r.label);
    });

    it('honors participantSelectable and an explicit labelId (hydration/rekey path)', () => {
      const state = makeState();
      const r = createLabel(state, { name: 'Venue', participantSelectable: true, labelId: 'l_db' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.labelId).toBe('l_db');
      expect(state.labels.get('l_db')?.participantSelectable).toBe(true);
    });

    it('rejects empty, over-long, and duplicate names', () => {
      const state = makeState();
      expect(createLabel(state, { name: '   ' })).toEqual({ ok: false, reason: 'empty_label' });
      expect(createLabel(state, { name: 'x'.repeat(51) })).toEqual({
        ok: false,
        reason: 'label_too_long',
      });
      makeLabel(state, 'Logistics');
      expect(createLabel(state, { name: ' Logistics ' })).toEqual({
        ok: false,
        reason: 'duplicate_label',
      });
      expect(state.labels.size).toBe(1);
    });

    it('rejects label creation after the session ended', () => {
      const state = makeState();
      setSessionStatus(state, 'ENDED');
      expect(createLabel(state, { name: 'Late' })).toEqual({
        ok: false,
        reason: 'session_ended',
      });
    });
  });

  describe('assignLabel / unassignLabel', () => {
    it('assigns and unassigns a label on a question, idempotently', () => {
      const state = makeState();
      const pid = join(state);
      const qid = submitLive(state, pid);
      const labelId = makeLabel(state);

      expect(assignLabel(state, { questionId: qid, labelId })).toEqual({
        ok: true,
        assigned: true,
      });
      expect(assignLabel(state, { questionId: qid, labelId })).toEqual({
        ok: true,
        assigned: false,
      });
      expect([...(state.questions.get(qid)?.labelIds ?? [])]).toEqual([labelId]);

      expect(unassignLabel(state, { questionId: qid, labelId })).toEqual({
        ok: true,
        removed: true,
      });
      expect(unassignLabel(state, { questionId: qid, labelId })).toEqual({
        ok: true,
        removed: false,
      });
      expect(state.questions.get(qid)?.labelIds.size).toBe(0);
    });

    it('supports multiple labels per question', () => {
      const state = makeState();
      const pid = join(state);
      const qid = submitLive(state, pid);
      const a = makeLabel(state, 'A');
      const b = makeLabel(state, 'B');
      assignLabel(state, { questionId: qid, labelId: a });
      assignLabel(state, { questionId: qid, labelId: b });
      expect([...(state.questions.get(qid)?.labelIds ?? [])].sort()).toEqual([a, b].sort());
    });

    it('rejects unknown questions and unknown labels', () => {
      const state = makeState();
      const pid = join(state);
      const qid = submitLive(state, pid);
      const labelId = makeLabel(state);
      expect(assignLabel(state, { questionId: 'nope', labelId })).toEqual({
        ok: false,
        reason: 'unknown_question',
      });
      expect(assignLabel(state, { questionId: qid, labelId: 'nope' })).toEqual({
        ok: false,
        reason: 'unknown_label',
      });
      expect(unassignLabel(state, { questionId: 'nope', labelId })).toEqual({
        ok: false,
        reason: 'unknown_question',
      });
    });
  });

  describe('participant label selection at submission', () => {
    it('attaches participant-selectable labels, deduplicated', () => {
      const state = makeState();
      const pid = join(state);
      const labelId = makeLabel(state, 'Open mic', true);
      const r = submitQuestion(state, {
        participantId: pid,
        text: 'q',
        labelIds: [labelId, labelId],
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect([...r.question.labelIds]).toEqual([labelId]);
    });

    it('rejects unknown and host-only labels instead of silently dropping them', () => {
      const state = makeState();
      const pid = join(state);
      const hostOnly = makeLabel(state, 'Host only', false);
      expect(submitQuestion(state, { participantId: pid, text: 'q', labelIds: ['nope'] })).toEqual({
        ok: false,
        reason: 'unknown_label',
      });
      expect(
        submitQuestion(state, { participantId: pid, text: 'q', labelIds: [hostOnly] }),
      ).toEqual({ ok: false, reason: 'label_not_selectable' });
      expect(state.questions.size).toBe(0);
    });
  });

  describe('projections', () => {
    it('public projection strips host-only labels while host projection keeps them', () => {
      const state = makeState();
      const pid = join(state);
      const qid = submitLive(state, pid);
      const visible = makeLabel(state, 'Audience pick', true);
      const hostOnly = makeLabel(state, 'Follow up', false);
      assignLabel(state, { questionId: qid, labelId: visible });
      assignLabel(state, { questionId: qid, labelId: hostOnly });

      const pub = publicState(state);
      expect(pub.labels).toEqual([
        { id: visible, name: 'Audience pick', participantSelectable: true },
      ]);
      expect(pub.questions[0].labelIds).toEqual([visible]);

      const host = hostState(state);
      expect(host.labels).toEqual([
        { id: visible, name: 'Audience pick', participantSelectable: true },
        { id: hostOnly, name: 'Follow up', participantSelectable: false },
      ]);
      expect(host.questions[0].labelIds.sort()).toEqual([visible, hostOnly].sort());
    });
  });
});

// --- Replies (MID-341, PRD §4.3 / §4.8) ---

describe('addHostReply', () => {
  it('replies to a LIVE question and projects it in public, host, and personal state', () => {
    const state = makeState();
    const pid = join(state, 'Alice');
    const qid = submitLive(state, pid, 'live question');
    const r = addHostReply(state, { questionId: qid, text: '  We ship next week.  ' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reply.isHostReply).toBe(true);
    expect(r.reply.participantId).toBeNull();
    expect(r.reply.text).toBe('We ship next week.');

    const pub = publicState(state);
    expect(pub.questions[0].replyCount).toBe(1);
    expect(pub.questions[0].replies.map((x) => x.text)).toEqual(['We ship next week.']);
    expect(hostState(state).questions[0].replies.map((x) => x.text)).toEqual([
      'We ship next week.',
    ]);
    expect(personalState(state, pid)?.questions[0].replies.map((x) => x.text)).toEqual([
      'We ship next week.',
    ]);
    // No participant linkage in any projection payload.
    expect(JSON.stringify(pub.questions[0].replies)).not.toContain('participantId');
  });

  it('keeps a reply to an IN_REVIEW question out of public state until approval', () => {
    const state = makeState({ moderationEnabled: true });
    const pid = join(state);
    const r = submitQuestion(state, { participantId: pid, text: 'pending question' });
    if (!r.ok) throw new Error('submit failed');
    const qid = r.question.id;

    const reply = addHostReply(state, { questionId: qid, text: 'private note' });
    expect(reply.ok).toBe(true);

    // Private while in review: absent from public, present for host + owner.
    expect(JSON.stringify(publicState(state))).not.toContain('private note');
    expect(
      hostState(state)
        .questions.find((q) => q.id === qid)
        ?.replies.map((x) => x.text),
    ).toEqual(['private note']);
    expect(personalState(state, pid)?.questions[0].replies.map((x) => x.text)).toEqual([
      'private note',
    ]);

    // Approval makes the same reply public.
    approveQuestion(state, { questionId: qid });
    expect(publicState(state).questions[0].replies.map((x) => x.text)).toEqual(['private note']);
  });

  it('keeps the prior private reply visible to the owner after a dismissal', () => {
    const state = makeState({ moderationEnabled: true });
    const pid = join(state);
    const r = submitQuestion(state, { participantId: pid, text: 'pending question' });
    if (!r.ok) throw new Error('submit failed');
    addHostReply(state, { questionId: r.question.id, text: 'sorry, off topic' });
    dismissQuestion(state, { questionId: r.question.id });

    const personal = personalState(state, pid);
    expect(personal?.questions[0].status).toBe('DISMISSED');
    expect(personal?.questions[0].replies.map((x) => x.text)).toEqual(['sorry, off topic']);
    expect(JSON.stringify(publicState(state))).not.toContain('sorry, off topic');
  });

  it('allows up to 1,000 characters regardless of the question limit', () => {
    const state = makeState({ questionCharLimit: 140 });
    const pid = join(state);
    const qid = submitLive(state, pid);
    const long = addHostReply(state, { questionId: qid, text: 'r'.repeat(1000) });
    expect(long.ok).toBe(true);
    expect(addHostReply(state, { questionId: qid, text: 'r'.repeat(1001) })).toEqual({
      ok: false,
      reason: 'text_too_long',
    });
    expect(addHostReply(state, { questionId: qid, text: '   ' })).toEqual({
      ok: false,
      reason: 'empty_text',
    });
  });

  it('rejects replies on settled or unknown questions and after the session ends', () => {
    const state = makeState();
    const pid = join(state);
    const qid = submitLive(state, pid);
    markAnswered(state, { questionId: qid });
    expect(addHostReply(state, { questionId: qid, text: 'too late' })).toEqual({
      ok: false,
      reason: 'invalid_status',
    });
    expect(addHostReply(state, { questionId: 'ghost', text: 'hello' })).toEqual({
      ok: false,
      reason: 'unknown_question',
    });
    restoreQuestion(state, { questionId: qid });
    setSessionStatus(state, 'ENDED');
    expect(addHostReply(state, { questionId: qid, text: 'after end' })).toEqual({
      ok: false,
      reason: 'session_ended',
    });
  });
});

describe('editHostReply', () => {
  it('rewrites a host reply in place', () => {
    const state = makeState();
    const pid = join(state);
    const qid = submitLive(state, pid);
    const created = addHostReply(state, { questionId: qid, text: 'first take' });
    if (!created.ok) throw new Error('reply failed');
    const edited = editHostReply(state, {
      questionId: qid,
      replyId: created.reply.id,
      text: 'second take',
    });
    expect(edited.ok).toBe(true);
    expect(publicState(state).questions[0].replies.map((x) => x.text)).toEqual(['second take']);
  });

  it('keeps an edited in-review reply private until approval', () => {
    const state = makeState({ moderationEnabled: true });
    const pid = join(state);
    const r = submitQuestion(state, { participantId: pid, text: 'pending question' });
    if (!r.ok) throw new Error('submit failed');
    const created = addHostReply(state, { questionId: r.question.id, text: 'draft answer' });
    if (!created.ok) throw new Error('reply failed');
    const edited = editHostReply(state, {
      questionId: r.question.id,
      replyId: created.reply.id,
      text: 'final answer',
    });
    expect(edited.ok).toBe(true);
    expect(JSON.stringify(publicState(state))).not.toContain('final answer');
    expect(personalState(state, pid)?.questions[0].replies.map((x) => x.text)).toEqual([
      'final answer',
    ]);
    approveQuestion(state, { questionId: r.question.id });
    expect(publicState(state).questions[0].replies.map((x) => x.text)).toEqual(['final answer']);
  });

  it('rejects unknown replies, participant replies, and over-long rewrites', () => {
    const state = makeState({ participantRepliesEnabled: true });
    const pid = join(state);
    const qid = submitLive(state, pid);
    const fromAudience = addParticipantReply(state, {
      questionId: qid,
      participantId: pid,
      text: 'audience take',
    });
    if (!fromAudience.ok) throw new Error('reply failed');
    expect(editHostReply(state, { questionId: qid, replyId: 'ghost', text: 'x' })).toEqual({
      ok: false,
      reason: 'unknown_reply',
    });
    expect(
      editHostReply(state, { questionId: qid, replyId: fromAudience.reply.id, text: 'hijack' }),
    ).toEqual({ ok: false, reason: 'not_host_reply' });
    const hostReply = addHostReply(state, { questionId: qid, text: 'fine' });
    if (!hostReply.ok) throw new Error('reply failed');
    expect(
      editHostReply(state, {
        questionId: qid,
        replyId: hostReply.reply.id,
        text: 'r'.repeat(1001),
      }),
    ).toEqual({ ok: false, reason: 'text_too_long' });
  });
});

describe('addParticipantReply', () => {
  it('threads under a LIVE question when enabled and stays anonymous in projections', () => {
    const state = makeState({ participantRepliesEnabled: true });
    const author = join(state, 'Alice');
    const replier = join(state, 'Bob');
    const qid = submitLive(state, author, 'live question');
    const r = addParticipantReply(state, {
      questionId: qid,
      participantId: replier,
      text: 'same question here!',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reply.isHostReply).toBe(false);
    expect(r.reply.participantId).toBe(replier);

    const pub = publicState(state);
    expect(pub.questions[0].replies.map((x) => x.text)).toEqual(['same question here!']);
    // Reply authorship never leaves the server — not even for the host.
    expect(JSON.stringify(pub)).not.toContain(replier);
    expect(JSON.stringify(hostState(state))).not.toContain(replier);
  });

  it('is rejected when the feature is disabled', () => {
    const state = makeState();
    const pid = join(state);
    const qid = submitLive(state, pid);
    expect(
      addParticipantReply(state, { questionId: qid, participantId: pid, text: 'hello' }),
    ).toEqual({ ok: false, reason: 'replies_disabled' });
  });

  it('is rejected when the target question is not LIVE', () => {
    const state = makeState({ participantRepliesEnabled: true, moderationEnabled: true });
    const pid = join(state);
    const pending = submitQuestion(state, { participantId: pid, text: 'pending question' });
    if (!pending.ok) throw new Error('submit failed');
    expect(
      addParticipantReply(state, {
        questionId: pending.question.id,
        participantId: pid,
        text: 'too early',
      }),
    ).toEqual({ ok: false, reason: 'not_live' });
    expect(
      addParticipantReply(state, { questionId: 'ghost', participantId: pid, text: 'hello' }),
    ).toEqual({ ok: false, reason: 'unknown_question' });
  });

  it('enforces the question char limit, unknown participants, and closed/ended sessions', () => {
    const state = makeState({ participantRepliesEnabled: true, questionCharLimit: 140 });
    const pid = join(state);
    const qid = submitLive(state, pid);
    expect(
      addParticipantReply(state, { questionId: qid, participantId: pid, text: 'r'.repeat(141) }),
    ).toEqual({ ok: false, reason: 'text_too_long' });
    expect(
      addParticipantReply(state, { questionId: qid, participantId: 'ghost', text: 'hello' }),
    ).toEqual({ ok: false, reason: 'unknown_participant' });

    // Closing submissions closes reply threads too (see DECISIONS.md).
    setSubmissionsOpen(state, false);
    expect(
      addParticipantReply(state, { questionId: qid, participantId: pid, text: 'hello' }),
    ).toEqual({ ok: false, reason: 'submissions_closed' });
    setSessionStatus(state, 'ENDED');
    expect(
      addParticipantReply(state, { questionId: qid, participantId: pid, text: 'hello' }),
    ).toEqual({ ok: false, reason: 'session_ended' });
  });

  it('publishes immediately even when question moderation is enabled', () => {
    const state = makeState({ participantRepliesEnabled: true, moderationEnabled: true });
    const author = join(state);
    const replier = join(state);
    const r = submitQuestion(state, { participantId: author, text: 'pending question' });
    if (!r.ok) throw new Error('submit failed');
    approveQuestion(state, { questionId: r.question.id });
    const reply = addParticipantReply(state, {
      questionId: r.question.id,
      participantId: replier,
      text: 'instant thread',
    });
    expect(reply.ok).toBe(true);
    expect(publicState(state).questions[0].replies.map((x) => x.text)).toEqual(['instant thread']);
  });
});

describe('toPublicQuestion', () => {
  it('serializes a LIVE question with public-safe fields only', () => {
    const state = makeState();
    const pid = join(state, 'Alice');
    const qid = submitLive(state, pid, 'What time is it?');
    const q = state.questions.get(qid);
    if (!q) throw new Error('question not found');
    const pub = toPublicQuestion(state, q);
    expect(pub.id).toBe(qid);
    expect(pub.text).toBe('What time is it?');
    expect(pub.isAnonymous).toBe(true); // ANONYMOUS_BY_DEFAULT
    expect(pub.authorDisplayName).toBeNull();
    expect(pub.score).toBe(0);
    expect(pub.upvotes).toBe(0);
    expect(pub.downvotes).toBe(0);
    expect(pub.labelIds).toEqual([]);
    expect(pub.replyCount).toBe(0);
    expect(pub.replies).toEqual([]);
    expect(pub.highlighted).toBe(false);
    expect(typeof pub.submittedAt).toBe('number');
    // Must not include status or participantId
    expect('status' in pub).toBe(false);
    expect('participantId' in pub).toBe(false);
  });

  it('exposes author name for non-anonymous questions', () => {
    const state = makeState({ privacyMode: 'NAMED_BY_DEFAULT' });
    const pid = join(state, 'Bob');
    const r = submitQuestion(state, { participantId: pid, text: 'Named q?', isAnonymous: false });
    if (!r.ok) throw new Error('submit failed');
    const pub = toPublicQuestion(state, r.question);
    expect(pub.isAnonymous).toBe(false);
    expect(pub.authorDisplayName).toBe('Bob');
  });

  it('filters labelIds to only participant-selectable labels', () => {
    const state = makeState();
    const hostLabelResult = createLabel(state, { name: 'Host Only', participantSelectable: false });
    const pubLabelResult = createLabel(state, {
      name: 'Public Tag',
      participantSelectable: true,
    });
    if (!hostLabelResult.ok || !pubLabelResult.ok) throw new Error('label creation failed');
    const pid = join(state);
    const r = submitQuestion(state, {
      participantId: pid,
      text: 'Tagged?',
      labelIds: [pubLabelResult.labelId],
    });
    if (!r.ok) throw new Error('submit failed');
    // Manually add host-only label to question (as if host assigned it)
    r.question.labelIds.add(hostLabelResult.labelId);
    const pub = toPublicQuestion(state, r.question);
    expect(pub.labelIds).toContain(pubLabelResult.labelId);
    expect(pub.labelIds).not.toContain(hostLabelResult.labelId);
  });

  it('reflects highlighted state', () => {
    const state = makeState();
    const pid = join(state);
    const qid = submitLive(state, pid);
    const q = state.questions.get(qid);
    if (!q) throw new Error('question not found');
    highlightQuestion(state, { questionId: qid });
    const pub = toPublicQuestion(state, q);
    expect(pub.highlighted).toBe(true);
  });

  it('matches the projection from publicState for the same question', () => {
    const state = makeState({ privacyMode: 'NAMED_BY_DEFAULT' });
    const pid = join(state, 'Carol');
    const qid = submitLive(state, pid, 'Hello?');
    const q = state.questions.get(qid);
    if (!q) throw new Error('question not found');
    const pub = toPublicQuestion(state, q);
    const fromFullState = publicState(state).questions.find((x) => x.id === qid);
    expect(pub).toEqual(fromFullState);
  });
});

describe('toHostQuestion', () => {
  it('serializes a LIVE question with status included', () => {
    const state = makeState();
    const pid = join(state);
    const qid = submitLive(state, pid, 'Live question');
    const q = state.questions.get(qid);
    if (!q) throw new Error('question not found');
    const host = toHostQuestion(state, q);
    expect(host.id).toBe(qid);
    expect(host.status).toBe('LIVE');
    expect('participantId' in host).toBe(false);
  });

  it('serializes an IN_REVIEW question with status', () => {
    const state = makeState({ moderationEnabled: true });
    const pid = join(state);
    const r = submitQuestion(state, { participantId: pid, text: 'Pending??' });
    if (!r.ok) throw new Error('submit failed');
    const host = toHostQuestion(state, r.question);
    expect(host.status).toBe('IN_REVIEW');
    expect(host.text).toBe('Pending??');
  });

  it('includes all label ids (not filtered to public-only)', () => {
    const state = makeState();
    const hostLabelResult = createLabel(state, {
      name: 'Internal',
      participantSelectable: false,
    });
    const pubLabelResult = createLabel(state, { name: 'Public', participantSelectable: true });
    if (!hostLabelResult.ok || !pubLabelResult.ok) throw new Error('label creation failed');
    const pid = join(state);
    const r = submitQuestion(state, {
      participantId: pid,
      text: 'Labeled?',
      labelIds: [pubLabelResult.labelId],
    });
    if (!r.ok) throw new Error('submit failed');
    r.question.labelIds.add(hostLabelResult.labelId);
    const host = toHostQuestion(state, r.question);
    expect(host.labelIds).toContain(pubLabelResult.labelId);
    expect(host.labelIds).toContain(hostLabelResult.labelId);
  });

  it('keeps author name anonymous even in host projection', () => {
    const state = makeState({ privacyMode: 'ALWAYS_ANONYMOUS' });
    const pid = join(state, 'Dave');
    const qid = submitLive(state, pid, 'Anon?');
    const q = state.questions.get(qid);
    if (!q) throw new Error('question not found');
    const host = toHostQuestion(state, q);
    expect(host.isAnonymous).toBe(true);
    expect(host.authorDisplayName).toBeNull();
  });

  it('matches the projection from hostState for the same question', () => {
    const state = makeState({ moderationEnabled: true, privacyMode: 'NAMED_BY_DEFAULT' });
    const pid = join(state, 'Eve');
    const r = submitQuestion(state, { participantId: pid, text: 'Hosted?' });
    if (!r.ok) throw new Error('submit failed');
    const host = toHostQuestion(state, r.question);
    const fromFullState = hostState(state).questions.find((x) => x.id === r.question.id);
    expect(host).toEqual(fromFullState);
  });
});
