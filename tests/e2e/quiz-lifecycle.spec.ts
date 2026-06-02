import { Buffer } from 'node:buffer';
import { expect, test } from '@playwright/test';
import { E2E_PLAYER_CAP } from './e2e-env';
import { signupViaUi, uniqueEmail } from './helpers/auth';
import { db, resetDatabase, seedWordCloud } from './helpers/db';
import { connectSocket, emitAck, type HostCreateAck, type JoinAck, sleep } from './helpers/socket';

// A minimal valid 1x1 transparent PNG (the upload route validates MIME + size,
// not pixels, so this is enough to exercise the local-disk upload path).
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const gameQuiz = {
  title: 'E2E Game Quiz',
  questions: [
    {
      id: 'q1',
      type: 'multiple',
      text: 'What is 2 + 2?',
      options: ['3', '4', '5', '6'],
      correct: 1,
      timeLimit: 10,
      doublePoints: false,
    },
  ],
};

test.describe('quiz + game lifecycle', () => {
  test.beforeEach(async () => {
    await resetDatabase();
  });

  test.afterAll(async () => {
    await db.$disconnect();
  });

  test('authenticated user creates a quiz and sees it in the library', async ({ page }) => {
    await signupViaUi(page, { email: uniqueEmail('quiz'), password: 'quiz-author-pass' });

    const title = `Capitals Quiz ${Date.now()}`;
    const res = await page.request.post('/api/quiz', {
      data: {
        title,
        questions: [
          {
            type: 'multiple',
            text: 'Capital of France?',
            options: ['Paris', 'Lyon', 'Nice', 'Brest'],
            correct: 0,
            timeLimit: 20,
            doublePoints: false,
          },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { id: string };
    expect(body.id).toBeTruthy();

    // Library page (server-rendered from listQuizzes) shows the new quiz.
    await page.goto('/host');
    await expect(page.getByText(title)).toBeVisible();
  });

  test('runs a full game over Socket.IO and persists a finished session', async () => {
    const host = await connectSocket();
    const alice = await connectSocket();
    const bob = await connectSocket();

    try {
      const { pin } = await emitAck<HostCreateAck>(host, 'host:create', gameQuiz);
      expect(pin).toMatch(/^\d{6}$/);

      // The session row is written asynchronously after host:create; player
      // joins are only persisted once it exists (as in real use, where players
      // join seconds later). Wait for it before joining.
      await expect
        .poll(async () => (await db.gameSession.findUnique({ where: { pin } })) !== null, {
          timeout: 5_000,
        })
        .toBe(true);

      const ja = await emitAck<JoinAck>(alice, 'player:join', pin, 'Alice');
      const jb = await emitAck<JoinAck>(bob, 'player:join', pin, 'Bob');
      expect(ja.ok).toBeTruthy();
      expect(jb.ok).toBeTruthy();

      host.emit('host:start', pin);
      await sleep(150);

      await emitAck(alice, 'player:answer', pin, 1); // correct
      await emitAck(bob, 'player:answer', pin, 0); // wrong
      await sleep(200);

      host.emit('host:advance', pin); // question → reveal
      await sleep(150);
      host.emit('host:advance', pin); // reveal → final
      await sleep(300);

      // Session persisted: created on host:create, finalized on game end.
      await expect
        .poll(async () => (await db.gameSession.findUnique({ where: { pin } }))?.status, {
          timeout: 5_000,
        })
        .toBe('finished');

      const session = await db.gameSession.findUnique({
        where: { pin },
        include: { players: true },
      });
      expect(session?.finalLeaderboard).not.toBeNull();
      expect(session?.players.length).toBe(2);
    } finally {
      host.disconnect();
      alice.disconnect();
      bob.disconnect();
    }
  });

  test('rejects the player past PLAYER_CAP', async () => {
    const host = await connectSocket();
    const players = await Promise.all(
      Array.from({ length: E2E_PLAYER_CAP }, () => connectSocket()),
    );
    const overflow = await connectSocket();

    try {
      const { pin } = await emitAck<HostCreateAck>(host, 'host:create', gameQuiz);

      for (let i = 0; i < players.length; i++) {
        const ack = await emitAck<JoinAck>(players[i], 'player:join', pin, `Player${i + 1}`);
        expect(ack.ok, `player ${i + 1} should join within cap`).toBeTruthy();
      }

      const rejected = await emitAck<JoinAck>(overflow, 'player:join', pin, 'Overflow');
      expect(rejected.ok).toBeFalsy();
      expect(rejected.code).toBe('full');
    } finally {
      host.disconnect();
      overflow.disconnect();
      for (const p of players) p.disconnect();
    }
  });

  test('uploads an image to local storage (MID-217)', async ({ page }) => {
    await signupViaUi(page, { email: uniqueEmail('upload'), password: 'uploader-pass-123' });

    const res = await page.request.post('/api/upload', {
      multipart: {
        file: {
          name: 'pixel.png',
          mimeType: 'image/png',
          buffer: Buffer.from(PNG_1X1_BASE64, 'base64'),
        },
      },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { url: string; mimeType: string };
    expect(body.url).toMatch(/^\/uploads\/.+\.png$/);
    expect(body.mimeType).toBe('image/png');
  });

  test('exports word-cloud answers as CSV with one row per submission', async ({ request }) => {
    const pin = '424242';
    const { submissionCount } = await seedWordCloud(pin, ['apples', 'bananas', 'cherries']);

    const res = await request.get(`/host/wordcloud/${pin}/answers.csv`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/csv');

    const rows = (await res.text()).split(/\r\n|\n/).filter((line) => line.length > 0);
    // header + one row per seeded submission
    expect(rows.length).toBe(submissionCount + 1);
    expect(rows[0]).toBe('timestamp,nickname,raw_text,normalized,removed');
    for (const word of ['apples', 'bananas', 'cherries']) {
      expect(rows.some((r) => r.includes(`,${word},`))).toBeTruthy();
    }
  });
});
