import { randomBytes } from 'node:crypto';
import { PrismaAdapter } from '@auth/prisma-adapter';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Apple from 'next-auth/providers/apple';
import Credentials from 'next-auth/providers/credentials';
import authConfig from '@/auth.config';
import { getAppleClientSecret } from '@/lib/apple-secret';
import { verifyCredentials } from '@/lib/auth-helpers';
import { config } from '@/lib/config';
import { prisma } from '@/lib/db';

// DEV-ONLY: auto-generate AUTH_SECRET when missing in non-production.
// This lets `npm run dev` boot without any .env file on a fresh clone.
// Production deployments MUST set AUTH_SECRET explicitly.
if (!process.env.AUTH_SECRET && process.env.NODE_ENV !== 'production') {
  const devSecret = randomBytes(32).toString('hex');
  process.env.AUTH_SECRET = devSecret;
  console.warn(
    '[auth] AUTH_SECRET not set — generated a dev secret for this session. Set AUTH_SECRET in .env for persistent sessions.',
  );
}

// Apple is enabled only when AUTH_MODE=password+oauth AND ENABLE_APPLE_SIGNIN=true
// (see lib/config.ts). OSS default is password-only, so Apple stays off.
const enableApple = config.appleEnabled;

export const { handlers, signIn, signOut, auth } = NextAuth(async () => {
  const providers: NextAuthConfig['providers'] = [
    ...authConfig.providers,
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(creds) {
        return verifyCredentials(creds?.email, creds?.password);
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
    // Trust X-Forwarded-* headers from upstream proxies (Cloudflare Tunnel,
    // any reverse proxy in front of server.ts). Required for sign-in
    // callbacks to redirect to the public origin instead of localhost
    // when the app is reached through a tunnel/proxy. Set explicitly here
    // because the AUTH_TRUST_HOST env var is only auto-honored on Vercel.
    trustHost: true,
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
