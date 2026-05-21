import { auth } from "@/auth";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/db";

export async function getCurrentUser() {
  const session = await auth();
  if (!session?.user?.email) return null;
  return prisma.user.findUnique({ where: { email: session.user.email } });
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}

export async function createCredentialsUser(
  email: string,
  password: string,
  name?: string,
) {
  const passwordHash = await hash(password, 12);
  return prisma.user.create({
    data: { email: email.toLowerCase(), passwordHash, name: name ?? null },
  });
}
