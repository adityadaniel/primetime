import { z } from 'zod';
import type { QuestionInput } from '@/lib/types';

const QUIZ_SCHEMA_VERSION = 1;

const QuestionExport = z
  .object({
    type: z.enum(['multiple', 'truefalse']),
    text: z.string().min(1),
    options: z.array(z.string().min(1)).min(2).max(4),
    correct: z.number().int().nonnegative(),
    timeLimit: z.number().int().min(3).max(600),
    doublePoints: z.boolean(),
  })
  .refine((q) => q.correct < q.options.length, {
    message: 'correct index out of range',
    path: ['correct'],
  });

const QuizExport = z.object({
  $schema: z.string().optional(),
  version: z.literal(QUIZ_SCHEMA_VERSION),
  title: z.string().min(1),
  exportedAt: z.string().optional(),
  questions: z.array(QuestionExport).min(1),
});

export type QuizImport = {
  title: string;
  questions: QuestionInput[];
};

export interface ExportableQuiz {
  title: string;
  questions: Array<{
    type: string;
    text: string;
    options: string[];
    correct: number;
    timeLimit: number;
    doublePoints: boolean;
  }>;
}

export function serializeQuiz(quiz: ExportableQuiz): string {
  const payload = {
    $schema: 'https://theprimetime.id/quiz-v1.json',
    version: QUIZ_SCHEMA_VERSION,
    title: quiz.title,
    exportedAt: new Date().toISOString(),
    questions: quiz.questions.map((q) => ({
      type: q.type,
      text: q.text,
      options: q.options,
      correct: q.correct,
      timeLimit: q.timeLimit,
      doublePoints: q.doublePoints,
    })),
  };
  return JSON.stringify(payload, null, 2);
}

export type ParseResult = { ok: true; data: QuizImport } | { ok: false; error: string };

export function parseQuiz(json: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Invalid JSON' };
  }
  if (parsed && typeof parsed === 'object' && 'version' in parsed) {
    const v = (parsed as { version: unknown }).version;
    if (v !== QUIZ_SCHEMA_VERSION) {
      return { ok: false, error: `Unsupported version: ${String(v)}` };
    }
  }
  const result = QuizExport.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length ? issue.path.join('.') : 'root';
    return { ok: false, error: `${path}: ${issue.message}` };
  }
  return {
    ok: true,
    data: {
      title: result.data.title,
      questions: result.data.questions.map((q) => ({
        type: q.type,
        text: q.text,
        options: q.options,
        correct: q.correct as 0 | 1 | 2 | 3,
        timeLimit: q.timeLimit,
        doublePoints: q.doublePoints,
      })),
    },
  };
}

export function quizFilenameSlug(title: string, date: Date = new Date()): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-+/g, '-')
      .slice(0, 60) || 'quiz';
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${slug}-${yyyy}${mm}${dd}.json`;
}
