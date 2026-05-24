// PIN-type lookup. Used by /join to decide whether to route the player to
// the quiz client or the word-cloud client BEFORE emitting any socket event
// (F1 from the codex review). Quiz wins ties, mirroring app/play/[pin]/page.tsx.

import { type NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const pin = (body as { pin?: unknown } | null)?.pin;
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
    return NextResponse.json({ error: 'invalid_pin' }, { status: 400 });
  }

  const [quiz, wc] = await Promise.all([
    prisma.gameSession.findUnique({ where: { pin }, select: { id: true } }),
    prisma.wordCloudSession.findUnique({ where: { pin }, select: { id: true, status: true } }),
  ]);

  if (quiz) return NextResponse.json({ type: 'quiz' as const });
  if (wc) {
    return NextResponse.json({ type: 'wordcloud' as const, status: wc.status });
  }
  // No DB row yet — most likely an in-memory quiz session created via the
  // anonymous /host flow. Default to quiz so the existing socket join flow
  // runs and the server returns a useful "Game not found" if it's truly bad.
  return NextResponse.json({ type: null });
}
