import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { listQuizzes } from '@/lib/repos/quiz';
import HostMenuClient from './HostMenuClient';

function getSessionUserId(session: { user?: { id?: string } } | null): string | null {
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export default async function HostMenu() {
  const userId = getSessionUserId(await auth());
  if (!userId) redirect('/signin');

  const quizzes = await listQuizzes(userId);
  return <HostMenuClient initialQuizzes={quizzes} />;
}
