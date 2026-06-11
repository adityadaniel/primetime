// Q&A host lifecycle e2e (MID-345): create session, participant submits in
// second context, moderation approve, highlight visible on display, CSV export.

import { expect, test } from '@playwright/test';
import type { Socket } from 'socket.io-client';
import { connectSocket, emitAck, sleep } from './helpers/socket';

test.describe('Q&A host lifecycle', () => {
  let host: Socket;
  let participant: Socket;
  let display: Socket;
  let pin: string;

  test.beforeAll(async () => {
    host = await connectSocket();
    participant = await connectSocket();
    display = await connectSocket();
  });

  test.afterAll(() => {
    host?.disconnect();
    participant?.disconnect();
    display?.disconnect();
  });

  test('full Q&A lifecycle: create → submit → moderate → highlight → display → export', async ({
    request,
  }) => {
    // 1. Create session via API
    const createRes = await request.post('/api/q-and-a', {
      data: {
        title: 'E2E Q&A Session',
        privacyMode: 'NAMED_BY_DEFAULT',
        moderationEnabled: true,
        participantRepliesEnabled: false,
        downvotesEnabled: false,
      },
    });
    // If auth is required, the route may 401. In that case, create via socket helpers.
    if (createRes.status() === 401) {
      // Fallback: use pin-allocator directly (same as smoke tests)
      const { allocatePin } = await import('../../lib/pin-allocator');
      const { createSession } = await import('../../lib/qa-repo');
      const allocated = await allocatePin();
      const session = await createSession({
        pin: allocated,
        title: 'E2E Q&A Session',
        privacyMode: 'NAMED_BY_DEFAULT',
        hostUserId: null,
        moderationEnabled: true,
        participantRepliesEnabled: false,
        downvotesEnabled: false,
      });
      pin = session.pin;
    } else {
      expect(createRes.status()).toBe(200);
      const body = await createRes.json();
      pin = body.pin;
    }
    expect(pin).toMatch(/^\d{6}$/);

    // 2. Host attaches
    const hostAck = await emitAck<{ pin: string; sessionId: string } | { error: string }>(
      host,
      'qa:host:attach',
      { pin },
    );
    expect(hostAck).toHaveProperty('pin', pin);

    // 3. Display attaches
    const displayState = new Promise<{ questions: { id: string; highlighted: boolean }[] }>(
      (resolve) => {
        display.on('qa:state', (s: { questions: { id: string; highlighted: boolean }[] }) =>
          resolve(s),
        );
      },
    );
    const displayAck = await emitAck<{ state: unknown } | { error: string }>(
      display,
      'qa:display:attach',
      { pin },
    );
    expect(displayAck).toHaveProperty('state');

    // 4. Participant joins
    const joinAck = await emitAck<{ participantId: string } | { error: string }>(
      participant,
      'qa:participant:join',
      { pin, displayName: 'E2E Alice' },
    );
    expect(joinAck).toHaveProperty('participantId');
    const participantId = (joinAck as { participantId: string }).participantId;

    // 5. Participant submits question (moderated → IN_REVIEW)
    const submitAck = await emitAck<{ ok: true; questionId: string } | { error: string }>(
      participant,
      'qa:participant:submit',
      { pin, participantId, text: 'When is the next release?', isAnonymous: false },
    );
    expect(submitAck).toHaveProperty('questionId');
    const questionId = (submitAck as { questionId: string }).questionId;

    // 6. Host approves (IN_REVIEW → LIVE)
    const approveAck = await emitAck<{ ok: true } | { error: string }>(host, 'qa:host:moderate', {
      pin,
      questionId,
      action: 'approve',
    });
    expect(approveAck).toHaveProperty('ok', true);

    await sleep(300);

    // 7. Host highlights the question
    const highlightAck = await emitAck<{ ok: true } | { error: string }>(
      host,
      'qa:host:highlight',
      { pin, questionId },
    );
    expect(highlightAck).toHaveProperty('ok', true);

    // 8. Verify display receives highlighted question
    const state = await Promise.race([
      displayState,
      sleep(3000).then(() => {
        throw new Error('display state timeout');
      }),
    ]);
    const highlightedQ = (
      state as { questions: { id: string; highlighted: boolean }[] }
    ).questions.find((q) => q.id === questionId);
    expect(highlightedQ?.highlighted).toBe(true);

    // 9. End session and verify CSV export
    const endAck = await emitAck<{ ok: true } | { error: string }>(
      host,
      'qa:host:set-session-status',
      { pin, status: 'ENDED' },
    );
    expect(endAck).toHaveProperty('ok', true);

    await sleep(500);

    // 10. Download CSV
    const csvRes = await request.get(`/host/q-and-a/${pin}/questions.csv`);
    expect(csvRes.status()).toBe(200);
    const csv = await csvRes.text();
    expect(csv).toContain('question_id');
    expect(csv).toContain('When is the next release?');
    expect(csv).toContain('E2E Alice');
  });
});
