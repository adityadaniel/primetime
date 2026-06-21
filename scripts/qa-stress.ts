// Q&A 120-participant stress test (MID-345).
//
// Validates PRD §8: ≥120 participants submitting and voting concurrently
// without losing any actions. Also verifies the submission-fanout fix: the
// submit burst must NOT regress to per-submit full qa:state broadcasts.
//
// Usage:
//   # server must already run on :4321
//   PARTICIPANTS=120 npm run qa:stress

import { io } from 'socket.io-client';

const URL = process.env.LOAD_URL ?? 'http://localhost:4321';
const PARTICIPANTS = Number(process.env.PARTICIPANTS ?? 120);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Sock = ReturnType<typeof io>;

interface Slot {
  sock: Sock;
  participantId: string;
  submitAckMs: number;
  voteAckMs: number;
  // Event counters received on this socket during the test phases
  qaStateCount: number;
  qaQuestionsCount: number;
  qaScoresCount: number;
}

function connect(): Promise<Sock> {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout')), 15_000);
    s.on('connect', () => {
      clearTimeout(t);
      resolve(s);
    });
    s.on('connect_error', (e: Error) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

function emit<T>(sock: Sock, event: string, payload: unknown): Promise<T> {
  return new Promise((r) => sock.emit(event, payload, r));
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function main() {
  console.log(`Q&A stress test: ${PARTICIPANTS} participants`);
  console.log(`Server: ${URL}\n`);

  // --- Setup: create session ---
  const { allocatePin } = await import('../lib/pin-allocator');
  const { createSession } = await import('../lib/qa-repo');
  const pin = await allocatePin();
  const session = await createSession({
    pin,
    title: 'Stress Test Q&A',
    privacyMode: 'NAMED_BY_DEFAULT',
    hostUserId: null,
    moderationEnabled: false, // questions go LIVE immediately
    participantRepliesEnabled: false,
    downvotesEnabled: true,
  });
  console.log(`Session created: pin=${pin} id=${session.id}`);

  // --- Host socket ---
  const host = await connect();
  // qa:host:attach requires sessionId (enforced server-side since MID-332).
  const hostAck = await emit<
    { pin: string; sessionId: string; state: unknown; hostState: unknown } | { error: string }
  >(host, 'qa:host:attach', { pin, sessionId: session.id });
  if ('error' in hostAck) throw new Error(`host attach failed: ${hostAck.error}`);
  console.log('Host attached');

  // --- Connect participants ---
  console.log(`Connecting ${PARTICIPANTS} participants...`);
  const slots: Slot[] = [];
  const batchSize = 20;
  for (let i = 0; i < PARTICIPANTS; i += batchSize) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(batchSize, PARTICIPANTS - i) }, () => connect()),
    );
    for (let j = 0; j < batch.length; j++) {
      const idx = i + j;
      const sock = batch[j];
      const joinAck = await emit<{ participantId: string } | { error: string }>(
        sock,
        'qa:participant:join',
        { pin, displayName: `P${String(idx).padStart(3, '0')}` },
      );
      if ('error' in joinAck) throw new Error(`join failed for P${idx}: ${joinAck.error}`);
      const slot: Slot = {
        sock,
        participantId: joinAck.participantId,
        submitAckMs: 0,
        voteAckMs: 0,
        qaStateCount: 0,
        qaQuestionsCount: 0,
        qaScoresCount: 0,
      };
      sock.on('qa:state', (s: { pin: string }) => {
        if (s.pin === pin) slot.qaStateCount++;
      });
      sock.on('qa:questions', (d: { pin: string }) => {
        if (d.pin === pin) slot.qaQuestionsCount++;
      });
      sock.on('qa:scores', (d: { pin: string }) => {
        if (d.pin === pin) slot.qaScoresCount++;
      });
      slots.push(slot);
    }
    process.stdout.write(`  ${Math.min(i + batchSize, PARTICIPANTS)}/${PARTICIPANTS} connected\r`);
  }
  console.log(`\n✓ ${slots.length} participants joined\n`);

  // Drain join-triggered qa:state broadcasts before measuring submit-phase fanout.
  // Each join emits one qa:state to the joining socket; waiting here ensures those
  // deliveries have all arrived before we zero the counters, so the submit-phase
  // measurement starts clean.
  await sleep(500);

  // Reset counters so submit-phase measurement is uncontaminated by join traffic.
  for (const slot of slots) {
    slot.qaStateCount = 0;
    slot.qaQuestionsCount = 0;
    slot.qaScoresCount = 0;
  }

  // --- Phase 1: concurrent question submission ---
  console.log('Phase 1: burst-submit questions...');
  const questionIds: string[] = [];
  const submitStart = Date.now();

  const submitResults = await Promise.all(
    slots.map(async (slot) => {
      const t0 = Date.now();
      const ack = await emit<{ ok: true; questionId: string } | { error: string }>(
        slot.sock,
        'qa:participant:submit',
        {
          pin,
          participantId: slot.participantId,
          text: `Question from ${slot.participantId}`,
          isAnonymous: false,
        },
      );
      slot.submitAckMs = Date.now() - t0;
      return ack;
    }),
  );

  const submitDuration = Date.now() - submitStart;
  let submitLost = 0;
  for (const r of submitResults) {
    if ('error' in r) {
      submitLost++;
    } else {
      questionIds.push(r.questionId);
    }
  }

  // Allow the coalesce window to flush before reading counters.
  await sleep(500);

  const submitAcks = slots.map((s) => s.submitAckMs);
  console.log(`  Duration: ${submitDuration}ms`);
  console.log(`  Submitted: ${questionIds.length}/${PARTICIPANTS}`);
  console.log(`  Lost: ${submitLost}`);
  console.log(
    `  Ack latency — p50: ${percentile(submitAcks, 50)}ms, p95: ${percentile(submitAcks, 95)}ms, max: ${percentile(submitAcks, 100)}ms`,
  );

  // Fanout verification: counters were reset after a 500ms join-drain, so any
  // qa:state seen here is from the submit burst itself — not stale join traffic.
  // The coalesced path emits qa:questions deltas, never qa:state per-submit.
  const totalQaStates = slots.reduce((n, s) => n + s.qaStateCount, 0);
  const totalQaQuestions = slots.reduce((n, s) => n + s.qaQuestionsCount, 0);
  console.log(`  Fanout — qa:state deliveries during submit: ${totalQaStates}`);
  console.log(`  Fanout — qa:questions deliveries during submit: ${totalQaQuestions}`);
  if (totalQaStates > 0) {
    throw new Error(
      `FAIL: submit burst caused ${totalQaStates} qa:state deliveries (expected 0). ` +
        'Coalesced qa:questions delta not active — fanout regression.',
    );
  }
  if (totalQaQuestions < 1) {
    throw new Error(
      `FAIL: submit burst produced zero qa:questions deliveries — coalesced delta not firing.`,
    );
  }
  if (submitLost > 0) {
    throw new Error(`FAIL: ${submitLost} submissions lost`);
  }

  // Reset counters before vote phase.
  for (const slot of slots) {
    slot.qaStateCount = 0;
    slot.qaQuestionsCount = 0;
    slot.qaScoresCount = 0;
  }

  // --- Phase 2: concurrent voting ---
  // Each participant upvotes the FIRST question (cross-vote)
  console.log('\nPhase 2: burst-vote (each participant upvotes first question)...');
  const targetQuestion = questionIds[0];
  const voteStart = Date.now();

  const voteResults = await Promise.all(
    slots.map(async (slot) => {
      const t0 = Date.now();
      const ack = await emit<{ ok: true } | { error: string }>(slot.sock, 'qa:participant:vote', {
        pin,
        participantId: slot.participantId,
        questionId: targetQuestion,
        type: 'UP',
      });
      slot.voteAckMs = Date.now() - t0;
      return ack;
    }),
  );

  const voteDuration = Date.now() - voteStart;
  let voteLost = 0;
  for (const r of voteResults) {
    if ('error' in r) voteLost++;
  }

  // Allow the coalesce window to flush.
  await sleep(500);

  const voteAcks = slots.map((s) => s.voteAckMs);
  const totalVoteQaStates = slots.reduce((n, s) => n + s.qaStateCount, 0);
  const totalQaScores = slots.reduce((n, s) => n + s.qaScoresCount, 0);
  console.log(`  Duration: ${voteDuration}ms`);
  console.log(`  Votes registered: ${PARTICIPANTS - voteLost}/${PARTICIPANTS}`);
  console.log(`  Lost: ${voteLost}`);
  console.log(
    `  Ack latency — p50: ${percentile(voteAcks, 50)}ms, p95: ${percentile(voteAcks, 95)}ms, max: ${percentile(voteAcks, 100)}ms`,
  );
  console.log(`  Fanout — qa:state deliveries during vote: ${totalVoteQaStates}`);
  console.log(`  Fanout — qa:scores deliveries during vote: ${totalQaScores}`);

  // Self-upvote is expected to fail for the question owner (1 expected rejection)
  if (voteLost > 1) {
    throw new Error(`FAIL: ${voteLost} votes lost (max 1 expected for self-upvote)`);
  }
  // Vote phase should use qa:scores (coalesced), not qa:state per vote.
  if (totalVoteQaStates > 0) {
    throw new Error(
      `FAIL: vote burst caused ${totalVoteQaStates} qa:state deliveries (expected 0). ` +
        'qa:scores coalescing not active.',
    );
  }
  if (totalQaScores < 1) {
    throw new Error(
      `FAIL: vote burst produced zero qa:scores deliveries — coalesced scores delta not firing.`,
    );
  }

  // --- Phase 3: verify final state ---
  console.log('\nPhase 3: verify final state...');
  const hostReattach = await emit<
    { pin: string; sessionId: string; hostState: { counts: { live: number } } } | { error: string }
  >(host, 'qa:host:attach', { pin, sessionId: session.id });
  if ('error' in hostReattach) throw new Error(`host re-attach failed: ${hostReattach.error}`);
  const liveCounts = hostReattach.hostState.counts.live;
  console.log(`  Live questions on host board: ${liveCounts}`);
  if (liveCounts !== PARTICIPANTS) {
    throw new Error(`FAIL: expected ${PARTICIPANTS} live questions, got ${liveCounts}`);
  }

  // --- Cleanup ---
  console.log('\nDisconnecting...');
  host.disconnect();
  for (const slot of slots) slot.sock.disconnect();

  console.log('\n═══════════════════════════════════════════');
  console.log('  Q&A STRESS TEST: PASS');
  console.log(`  ${PARTICIPANTS} participants`);
  console.log(`  0 lost submissions, ≤1 lost vote (self-upvote)`);
  console.log(`  Submit burst: coalesced qa:questions (no qa:state regression)`);
  console.log(`  Vote burst: coalesced qa:scores`);
  console.log('═══════════════════════════════════════════\n');
}

main().catch((e) => {
  console.error('\n✗ STRESS TEST FAILED:', e.message ?? e);
  process.exit(1);
});
