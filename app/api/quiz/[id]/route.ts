import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { deleteQuiz, getQuiz, updateQuiz } from '@/lib/repos/quiz';

function getSessionUserId(session: { user?: { id?: string } } | null): string | null {
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getSessionUserId(await auth());
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { id } = await params;
  const quiz = await getQuiz(id, userId);
  if (!quiz) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(quiz);
}

async function update(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getSessionUserId(await auth());
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { id } = await params;
  try {
    const body = await req.json();
    const quiz = await updateQuiz(id, userId, body);
    if (!quiz) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ id: quiz.id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'bad request';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export const PUT = update;
export const PATCH = update;

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getSessionUserId(await auth());
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { id } = await params;
  const deleted = await deleteQuiz(id, userId);
  if (!deleted) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
