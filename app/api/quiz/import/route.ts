import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { parseQuiz } from '@/lib/quiz-io';
import { createQuiz } from '@/lib/repos/quiz';

function getSessionUserId(session: { user?: { id?: string } } | null): string | null {
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function POST(req: NextRequest) {
  const userId = getSessionUserId(await auth());
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const contentType = req.headers.get('content-type') ?? '';
  let json: string;

  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'file field required' }, { status: 400 });
      }
      json = await file.text();
    } else {
      json = await req.text();
    }
  } catch {
    return NextResponse.json({ error: 'Could not read body' }, { status: 400 });
  }

  const parsed = parseQuiz(json);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  try {
    const quiz = await createQuiz(userId, parsed.data);
    return NextResponse.json({ id: quiz.id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'create failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
