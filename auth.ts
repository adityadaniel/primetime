import { PrismaAdapter } from '@auth/prisma-adapter';
import { compare } from 'bcryptjs';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Apple from 'next-auth/providers/apple';
import Credentials from 'next-auth/providers/credentials';
import authConfig from '@/auth.config';
import { getAppleClientSecret } from '@/lib/apple-secret';
import { prisma } from '@/lib/db';

const enableApple = process.env.ENABLE_APPLE_SIGNIN === 'true';

export const { handlers, signIn, signOut, auth } = NextAuth(async () => {
  const providers: NextAuthConfig['providers'] = [
    ...authConfig.providers,
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(creds) {
        if (!creds?.email || !creds?.password) return null;
        const user = await prisma.user.findUnique({
          where: { email: String(creds.email).toLowerCase() },
        });
        if (!user?.passwordHash) return null;
        const ok = await compare(String(creds.password), user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? null,
          image: user.image ?? null,
        };
      },
    }),
  ];

  if (enableApple) {
    providers.push(
      Apple({
        clientId: process.env.APPLE_ID,
        clientSecret: await getAppleClientSecret(),
      }),
    );
  }

  return {
    ...authConfig,
    adapter: PrismaAdapter(prisma),
    session: { strategy: 'jwt' },
    providers,
    callbacks: {
      ...authConfig.callbacks,
      async session({ session, token }) {
        if (token.id) (session.user as { id?: string }).id = token.id as string;
        if (session.user?.email) {
          const u = await prisma.user.findUnique({
            where: { email: session.user.email },
            select: { tier: true },
          });
          if (u) (session.user as { tier?: string }).tier = u.tier;
        }
        return session;
      },
    },
  } satisfies NextAuthConfig;
});
