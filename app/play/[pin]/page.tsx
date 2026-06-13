import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import QuizClient from './quiz-client';

async function detectSessionType(pin: string): Promise<'quiz' | 'wordcloud' | 'q-and-a' | null> {
  if (!/^\d{6}$/.test(pin)) return null;
  // Quiz lookup runs first — quiz is the older system, so on the (defensive)
  // chance a PIN exists in multiple tables we keep the quiz route.
  const [quiz, wc, qa] = await Promise.all([
    prisma.gameSession.findUnique({ where: { pin }, select: { id: true } }),
    prisma.wordCloudSession.findUnique({ where: { pin }, select: { id: true } }),
    prisma.qASession.findUnique({ where: { pin }, select: { id: true } }),
  ]);
  if (quiz) return 'quiz';
  if (wc) return 'wordcloud';
  if (qa) return 'q-and-a';
  return null;
}

export default async function PlayPage({ params }: { params: Promise<{ pin: string }> }) {
  const { pin } = await params;
  const kind = await detectSessionType(pin);
  if (kind === 'wordcloud') {
    redirect(`/play/${pin}/wordcloud`);
  }
  if (kind === 'q-and-a') {
    redirect(`/play/${pin}/q-and-a`);
  }
  // Either a quiz session, or no DB record yet (in-memory game without persistence).
  // The quiz client handles the no-record case as it always has — it asks the
  // socket server, which is the authoritative source.
  return <QuizClient pin={pin} />;
}
