import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { exportSubmissionsCsv, promptSlug } from '@/lib/wordcloud-csv';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ pin: string }> },
): Promise<NextResponse> {
  const { pin } = await ctx.params;
  if (!/^\d{6}$/.test(pin)) {
    return NextResponse.json({ error: 'invalid_pin' }, { status: 400 });
  }

  const session = await prisma.wordCloudSession.findUnique({
    where: { pin },
    select: { id: true, hostUserId: true, prompt: true, status: true },
  });
  if (!session) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  if (session.hostUserId !== null) {
    const authSession = await auth();
    const userId = (authSession?.user as { id?: string } | undefined)?.id;
    if (!userId) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    if (userId !== session.hostUserId) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
  }

  if (session.status !== 'ENDED' && session.status !== 'ARCHIVED') {
    return NextResponse.json(
      { error: 'session_not_ended', status: session.status },
      { status: 409 },
    );
  }

  const rows = await prisma.wordCloudSubmission.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: 'asc' },
    select: {
      createdAt: true,
      rawText: true,
      normalized: true,
      removed: true,
      player: { select: { nickname: true } },
    },
  });

  const body = exportSubmissionsCsv(rows);
  const filename = `wordcloud-${promptSlug(session.prompt)}-${pin}.csv`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
