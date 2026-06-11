import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { exportQACsv, sessionSlug } from '@/lib/qa-csv';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ pin: string }> },
): Promise<NextResponse> {
  const { pin } = await ctx.params;
  if (!/^\d{6}$/.test(pin)) {
    return NextResponse.json({ error: 'invalid_pin' }, { status: 400 });
  }

  const session = await prisma.qASession.findUnique({
    where: { pin },
    select: { id: true, hostUserId: true, title: true },
  });
  if (!session) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Host ownership check — anonymous sessions (null hostUserId) allow any
  // authenticated host; owned sessions require the owner.
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

  // PRD §4.11: export works mid-session and after end (unlike wordcloud's
  // ENDED-only gate). No status restriction here.

  const questions = await prisma.qAQuestion.findMany({
    where: { sessionId: session.id },
    orderBy: { submittedAt: 'asc' },
    select: {
      id: true,
      text: true,
      originalText: true,
      isAnonymous: true,
      authorDisplayName: true,
      status: true,
      submittedAt: true,
      approvedAt: true,
      answeredAt: true,
      archivedAt: true,
      dismissedAt: true,
      withdrawnAt: true,
      votes: { select: { type: true } },
      replies: {
        select: { isHostReply: true, text: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
      labels: { select: { label: { select: { name: true } } } },
    },
  });

  const body = exportQACsv(questions);
  const filename = `q-and-a-${sessionSlug(session.title)}-${pin}.csv`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
