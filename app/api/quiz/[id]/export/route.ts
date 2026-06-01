import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { quizFilenameSlug, serializeQuiz } from '@/lib/quiz-io';
import { getQuiz } from '@/lib/repos/quiz';

function getSessionUserId(session: { user?: { id?: string } } | null): string | null {
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getSessionUserId(await auth());
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { id } = await params;
  const quiz = await getQuiz(id, userId);
  if (!quiz) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const json = serializeQuiz({
    title: quiz.title,
    questions: quiz.questions.map((q) => ({
      type: q.type,
      text: q.text,
      options: q.options,
      correct: q.correct,
      timeLimit: q.timeLimit,
      doublePoints: q.doublePoints,
    })),
  });
  const filename = quizFilenameSlug(quiz.title);

  return new NextResponse(json, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
