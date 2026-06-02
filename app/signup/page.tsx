import { prisma } from '@/lib/db';
import SignUpClient from './SignUpClient';

export const dynamic = 'force-dynamic';

export default async function SignUpPage() {
  const requireInviteCode = (process.env.REQUIRE_INVITE_CODE ?? 'false').toLowerCase() === 'true';

  // First-run detector: if no users exist, this is a fresh install.
  const userCount = await prisma.user.count();
  const isFirstRun = userCount === 0;

  return <SignUpClient requireInviteCode={requireInviteCode} isFirstRun={isFirstRun} />;
}
