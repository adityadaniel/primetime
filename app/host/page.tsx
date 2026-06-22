import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { listSessionSummariesForUser as listQaSummaries } from '@/lib/qa-repo';
import { listQuizzes } from '@/lib/repos/quiz';
import { listSessionSummariesForUser } from '@/lib/wonderwall-repo';
import HostMenuClient from './HostMenuClient';

function getSessionUserId(session: { user?: { id?: string } } | null): string | null {
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export default async function HostMenu() {
  const userId = getSessionUserId(await auth());
  if (!userId) redirect('/signin');

  const [quizzes, rooms, qaRooms] = await Promise.all([
    listQuizzes(userId),
    listSessionSummariesForUser(userId),
    listQaSummaries(userId),
  ]);
  return <HostMenuClient initialQuizzes={quizzes} initialRooms={rooms} initialQaRooms={qaRooms} />;
}
