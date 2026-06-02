import { compare, hash } from 'bcryptjs';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';

/** Safe user shape returned to Auth.js after a successful credential check. */
export interface AuthedUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

/**
 * Verify an email/password pair against the credentials store. Returns the
 * safe user shape on success, or `null` on any failure — unknown email, an
 * account with no password set (e.g. OAuth-only), or a wrong password. Never
 * throws on malformed input and never reveals which check failed, so the
 * caller can surface a single generic "invalid credentials" message.
 */
export async function verifyCredentials(
  email: unknown,
  password: unknown,
): Promise<AuthedUser | null> {
  if (typeof email !== 'string' || typeof password !== 'string') return null;
  if (!email || !password) return null;
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (!user?.passwordHash) return null;
  const ok = await compare(password, user.passwordHash);
  if (!ok) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    image: user.image ?? null,
  };
}

export async function getCurrentUser() {
  const session = await auth();
  if (!session?.user?.email) return null;
  return prisma.user.findUnique({ where: { email: session.user.email } });
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error('UNAUTHENTICATED');
  return user;
}

export async function createCredentialsUser(email: string, password: string, name?: string) {
  const passwordHash = await hash(password, 12);
  return prisma.user.create({
    data: { email: email.toLowerCase(), passwordHash, name: name ?? null },
  });
}
