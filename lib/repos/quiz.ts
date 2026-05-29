import type { Question, Quiz } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { QuestionInput, QuizSummary } from '@/lib/types';

export type QuizWithQuestions = Quiz & { questions: Question[] };

function validateQuestionInput(q: QuestionInput, idx: number): string | null {
  if (q.type !== 'multiple' && q.type !== 'truefalse') return `Q${idx}: bad type`;
  if (typeof q.text !== 'string' || !q.text.trim()) return `Q${idx}: empty text`;
  if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4)
    return `Q${idx}: 2-4 options required`;
  if (q.options.some((o) => typeof o !== 'string' || !o.trim())) return `Q${idx}: empty option`;
  if (q.correct < 0 || q.correct >= q.options.length) return `Q${idx}: correct out of range`;
  if (typeof q.timeLimit !== 'number' || q.timeLimit < 3 || q.timeLimit > 600)
    return `Q${idx}: bad timeLimit`;
  if (typeof q.doublePoints !== 'boolean') return `Q${idx}: bad doublePoints`;
  return null;
}

export async function createQuiz(
  userId: string,
  input: {
    title: string;
    questions: QuestionInput[];
  },
): Promise<QuizWithQuestions> {
  if (!input.title?.trim()) throw new Error('Title required');
  if (!input.questions?.length) throw new Error('At least one question required');
  for (const [i, q] of input.questions.entries()) {
    const err = validateQuestionInput(q, i + 1);
    if (err) throw new Error(err);
  }
  return prisma.quiz.create({
    data: {
      userId,
      title: input.title.trim(),
      questions: {
        create: input.questions.map((q, ordinal) => ({
          ordinal,
          type: q.type,
          text: q.text,
          options: q.options,
          correct: q.correct,
          timeLimit: q.timeLimit,
          doublePoints: q.doublePoints,
        })),
      },
    },
    include: { questions: { orderBy: { ordinal: 'asc' } } },
  });
}

export async function getQuiz(id: string, userId: string): Promise<QuizWithQuestions | null> {
  return prisma.quiz.findFirst({
    where: { id, userId },
    include: { questions: { orderBy: { ordinal: 'asc' } } },
  });
}

export async function listQuizzes(userId: string): Promise<QuizSummary[]> {
  const rows = await prisma.quiz.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      _count: { select: { questions: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    questionCount: r._count.questions,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function updateQuiz(
  id: string,
  userId: string,
  input: { title: string; questions: QuestionInput[] },
): Promise<QuizWithQuestions | null> {
  if (!input.title?.trim()) throw new Error('Title required');
  if (!input.questions?.length) throw new Error('At least one question required');
  for (const [i, q] of input.questions.entries()) {
    const err = validateQuestionInput(q, i + 1);
    if (err) throw new Error(err);
  }
  return prisma.$transaction(async (tx) => {
    const existing = await tx.quiz.findFirst({ where: { id, userId }, select: { id: true } });
    if (!existing) return null;
    await tx.question.deleteMany({ where: { quizId: id } });
    return tx.quiz.update({
      where: { id },
      data: {
        title: input.title.trim(),
        questions: {
          create: input.questions.map((q, ordinal) => ({
            ordinal,
            type: q.type,
            text: q.text,
            options: q.options,
            correct: q.correct,
            timeLimit: q.timeLimit,
            doublePoints: q.doublePoints,
          })),
        },
      },
      include: { questions: { orderBy: { ordinal: 'asc' } } },
    });
  });
}

export async function deleteQuiz(id: string, userId: string): Promise<boolean> {
  const result = await prisma.quiz.deleteMany({ where: { id, userId } });
  return result.count > 0;
}
