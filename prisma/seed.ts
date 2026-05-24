// prisma/seed.ts — small starter content for fresh installs.
//
// Wired via package.json `prisma.seed = "tsx prisma/seed.ts"` so the install
// flow can run `npx prisma db seed` without arguments.
//
// Idempotent: if a quiz titled "Welcome — Sample Quiz" already exists we skip
// re-inserting so re-running the seed never duplicates rows.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SAMPLE_QUIZ_TITLE = 'Welcome — Sample Quiz';

interface SeedQuestion {
  ordinal: number;
  type: 'multiple';
  text: string;
  options: string[];
  correct: number;
  timeLimit: number;
  doublePoints?: boolean;
}

const sampleQuestions: SeedQuestion[] = [
  {
    ordinal: 0,
    type: 'multiple',
    text: 'Which planet is closest to the Sun?',
    options: ['Mercury', 'Venus', 'Earth', 'Mars'],
    correct: 0,
    timeLimit: 20,
  },
  {
    ordinal: 1,
    type: 'multiple',
    text: 'What is 12 × 8?',
    options: ['86', '96', '104', '112'],
    correct: 1,
    timeLimit: 20,
  },
  {
    ordinal: 2,
    type: 'multiple',
    text: 'Which ocean is the largest by surface area?',
    options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'],
    correct: 3,
    timeLimit: 20,
  },
];

async function main() {
  const existing = await prisma.quiz.findFirst({
    where: { title: SAMPLE_QUIZ_TITLE },
    select: { id: true },
  });

  if (existing) {
    console.log(`[seed] '${SAMPLE_QUIZ_TITLE}' already exists (id=${existing.id}); skipping.`);
    return;
  }

  const created = await prisma.quiz.create({
    data: {
      title: SAMPLE_QUIZ_TITLE,
      questions: {
        create: sampleQuestions.map((q) => ({
          ordinal: q.ordinal,
          type: q.type,
          text: q.text,
          options: q.options,
          correct: q.correct,
          timeLimit: q.timeLimit,
          doublePoints: q.doublePoints ?? false,
        })),
      },
    },
    select: { id: true, title: true, _count: { select: { questions: true } } },
  });

  console.log(
    `[seed] created '${created.title}' (id=${created.id}) with ${created._count.questions} questions.`,
  );
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
