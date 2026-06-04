import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const RUN_INTEGRATION = process.env.INTEGRATION_DB === 'true';

const dbName = `primetime_test_${randomBytes(4).toString('hex')}`;
const baseUrl =
  process.env.DATABASE_URL ?? 'postgresql://primetime:primetime@localhost:5432/primetime_dev';
const maintenanceUrl = baseUrl.replace(/\/[^/?]+(\?|$)/, '/postgres$1');
const testUrl = baseUrl.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);

const describeIfIntegration = RUN_INTEGRATION ? describe : describe.skip;

describeIfIntegration('session-persistence integration', () => {
  let prisma: import('@prisma/client').PrismaClient;
  let createSessionRecord: typeof import('../session-repo').createSessionRecord;
  let recordPlayerJoin: typeof import('../session-repo').recordPlayerJoin;
  let recordAnswer: typeof import('../session-repo').recordAnswer;
  let finalizeSession: typeof import('../session-repo').finalizeSession;
  let createQuiz: typeof import('../repos/quiz').createQuiz;
  let getQuiz: typeof import('../repos/quiz').getQuiz;
  let listQuizzes: typeof import('../repos/quiz').listQuizzes;
  let deleteQuiz: typeof import('../repos/quiz').deleteQuiz;

  beforeAll(async () => {
    execSync(`createdb --maintenance-db="${maintenanceUrl}" ${dbName}`, { stdio: 'pipe' });
    process.env.DATABASE_URL = testUrl;
    execSync(`npx prisma migrate deploy`, {
      env: { ...process.env, DATABASE_URL: testUrl },
      stdio: 'pipe',
    });
    const dbModule = await import('../db');
    prisma = dbModule.prisma;
    const repo = await import('../session-repo');
    createSessionRecord = repo.createSessionRecord;
    recordPlayerJoin = repo.recordPlayerJoin;
    recordAnswer = repo.recordAnswer;
    finalizeSession = repo.finalizeSession;
    const quizRepo = await import('../repos/quiz');
    createQuiz = quizRepo.createQuiz;
    getQuiz = quizRepo.getQuiz;
    listQuizzes = quizRepo.listQuizzes;
    deleteQuiz = quizRepo.deleteQuiz;
  }, 60_000);

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    try {
      execSync(`dropdb --maintenance-db="${maintenanceUrl}" ${dbName}`, { stdio: 'pipe' });
    } catch {
      // best-effort cleanup
    }
  });

  it('end-to-end: create → join → answer → finalize → row counts > 0', async () => {
    const created = await createSessionRecord({
      pin: '987654',
      hostUserId: null,
      quizSnapshot: { title: 'Integration', questions: [] },
    });
    expect(created).not.toBeNull();
    if (!created) throw new Error('createSessionRecord returned null');
    const sessionId = created.id;

    await recordPlayerJoin({ sessionId, inGameId: 'p_a', nickname: 'Alice' });
    await recordPlayerJoin({ sessionId, inGameId: 'p_b', nickname: 'Bob' });
    await recordAnswer({
      sessionId,
      questionIndex: 0,
      playerInGameId: 'p_a',
      optionIndex: 1,
      correct: true,
      msFromStart: 100,
      awarded: 990,
    });
    await finalizeSession({
      sessionId,
      status: 'finished',
      finalLeaderboard: [
        { playerId: 'p_a', nickname: 'Alice', score: 990, rank: 1 },
        { playerId: 'p_b', nickname: 'Bob', score: 0, rank: 2 },
      ],
      playerFinalScores: [
        { inGameId: 'p_a', finalScore: 990, finalRank: 1 },
        { inGameId: 'p_b', finalScore: 0, finalRank: 2 },
      ],
    });

    const sessions = await prisma.gameSession.count();
    const players = await prisma.sessionPlayer.count();
    const answers = await prisma.sessionAnswer.count();
    expect(sessions).toBeGreaterThan(0);
    expect(players).toBe(2);
    expect(answers).toBe(1);

    const row = await prisma.gameSession.findUnique({ where: { id: sessionId } });
    expect(row?.status).toBe('finished');
    expect(row?.endedAt).toBeInstanceOf(Date);
  }, 30_000);

  it('isolates saved quizzes by owner for list, get, and delete', async () => {
    const alice = await prisma.user.create({ data: { email: 'alice@test' } });
    const bob = await prisma.user.create({ data: { email: 'bob@test' } });
    const input = (title: string) => ({
      title,
      questions: [
        {
          type: 'multiple' as const,
          text: `${title} question`,
          options: ['A', 'B'],
          correct: 0 as const,
          timeLimit: 10,
          doublePoints: false,
        },
      ],
    });

    const aliceQuiz = await createQuiz(alice.id, input('Alice quiz'));
    const bobQuiz = await createQuiz(bob.id, input('Bob quiz'));

    await expect(listQuizzes(alice.id)).resolves.toMatchObject([
      { id: aliceQuiz.id, title: 'Alice quiz' },
    ]);
    await expect(listQuizzes(bob.id)).resolves.toMatchObject([
      { id: bobQuiz.id, title: 'Bob quiz' },
    ]);

    await expect(getQuiz(aliceQuiz.id, bob.id)).resolves.toBeNull();
    await expect(deleteQuiz(aliceQuiz.id, bob.id)).resolves.toBe(false);
    await expect(prisma.quiz.findUnique({ where: { id: aliceQuiz.id } })).resolves.not.toBeNull();

    await expect(deleteQuiz(aliceQuiz.id, alice.id)).resolves.toBe(true);
    await expect(prisma.quiz.findUnique({ where: { id: aliceQuiz.id } })).resolves.toBeNull();
  }, 30_000);
});
