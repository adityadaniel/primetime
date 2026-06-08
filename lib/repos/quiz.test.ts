import { beforeEach, describe, expect, it, vi } from 'vitest';

const quizCreate = vi.fn();
const quizUpdate = vi.fn();
const quizFindFirst = vi.fn();
const questionDeleteMany = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    quiz: {
      create: (args: unknown) => quizCreate(args),
      update: (args: unknown) => quizUpdate(args),
      findFirst: (args: unknown) => quizFindFirst(args),
    },
    question: {
      deleteMany: (args: unknown) => questionDeleteMany(args),
    },
    // updateQuiz wraps its work in a transaction callback; invoke it with a
    // tx that proxies to the same mocked delegates.
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        quiz: {
          update: (args: unknown) => quizUpdate(args),
          findFirst: (args: unknown) => quizFindFirst(args),
        },
        question: { deleteMany: (args: unknown) => questionDeleteMany(args) },
      }),
  },
}));

import type { QuestionInput } from '@/lib/types';
import { createQuiz, updateQuiz } from './quiz';

beforeEach(() => {
  quizCreate.mockReset().mockResolvedValue({ id: 'quiz1', questions: [] });
  quizUpdate.mockReset().mockResolvedValue({ id: 'quiz1', questions: [] });
  quizFindFirst.mockReset().mockResolvedValue({ id: 'quiz1' });
  questionDeleteMany.mockReset().mockResolvedValue({ count: 0 });
});

function baseQuestion(overrides: Partial<QuestionInput> = {}): QuestionInput {
  return {
    type: 'multiple',
    text: 'Q1',
    options: ['a', 'b', 'c', 'd'],
    correct: 0,
    timeLimit: 10,
    doublePoints: false,
    ...overrides,
  };
}

function createdQuestions(mock: typeof quizCreate) {
  return mock.mock.calls[0][0].data.questions.create as Array<Record<string, unknown>>;
}

describe('quiz repo image persistence (MID-278)', () => {
  it('persists imageUrl on create when provided', async () => {
    await createQuiz('user1', {
      title: 'T',
      questions: [baseQuestion({ imageUrl: '/uploads/quiz-images/pic.png' })],
    });
    const qs = createdQuestions(quizCreate);
    expect(qs[0].imageUrl).toBe('/uploads/quiz-images/pic.png');
  });

  it('stores null imageUrl on create when omitted (text-only quiz)', async () => {
    await createQuiz('user1', { title: 'T', questions: [baseQuestion()] });
    const qs = createdQuestions(quizCreate);
    expect(qs[0].imageUrl).toBeNull();
  });

  it('persists imageUrl on update when provided', async () => {
    await updateQuiz('quiz1', 'user1', {
      title: 'T',
      questions: [baseQuestion({ imageUrl: '/uploads/quiz-images/updated.webp' })],
    });
    const qs = quizUpdate.mock.calls[0][0].data.questions.create as Array<Record<string, unknown>>;
    expect(qs[0].imageUrl).toBe('/uploads/quiz-images/updated.webp');
  });
});
