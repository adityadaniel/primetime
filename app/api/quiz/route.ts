import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { createQuiz, listQuizzes } from '@/lib/repos/quiz';

function getSessionUserId(session: { user?: { id?: string } } | null): string | null {
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function POST(req: NextRequest) {
  const userId = getSessionUserId(await auth());
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  try {
    const body = await req.json();
    const quiz = await createQuiz(userId, body);
    return NextResponse.json({ id: quiz.id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'bad request';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function GET() {
  const userId = getSessionUserId(await auth());
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const list = await listQuizzes(userId);
  return NextResponse.json(list);
}
