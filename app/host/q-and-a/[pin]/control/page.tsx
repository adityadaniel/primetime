// Q&A host control surface (MID-337). Server wrapper: validates the PIN,
// requires the authenticated host to own the session (middleware already
// requires a host session for /host/* — this adds per-session ownership),
// and hands pin + sessionId to the client control room. The socket layer
// re-checks ownership on qa:host:attach, so a forged page load still cannot
// drive the session.

import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import QAndAControlClient from './control-client';

export default async function QAndAControlPage({ params }: { params: Promise<{ pin: string }> }) {
  const { pin } = await params;
  if (!/^\d{6}$/.test(pin)) notFound();
  const [session, authSession] = await Promise.all([
    prisma.qASession.findUnique({
      where: { pin },
      select: { id: true, hostUserId: true },
    }),
    auth(),
  ]);
  if (!session) notFound();
  const userId = (authSession?.user as { id?: string } | undefined)?.id ?? null;
  // Anonymous sessions (hostUserId null — smoke/dev flows) are attachable by
  // any signed-in host; owned sessions only by their owner.
  if (session.hostUserId !== null && session.hostUserId !== userId) notFound();

  return <QAndAControlClient pin={pin} sessionId={session.id} />;
}
