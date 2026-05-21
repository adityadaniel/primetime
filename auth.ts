import NextAuth, { type NextAuthConfig } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import Apple from "next-auth/providers/apple";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/db";
import { getAppleClientSecret } from "@/lib/apple-secret";

const enableApple = process.env.ENABLE_APPLE_SIGNIN === "true";

export const { handlers, signIn, signOut, auth } = NextAuth(async () => {
  const providers: NextAuthConfig["providers"] = [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
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
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
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
    adapter: PrismaAdapter(prisma),
    session: { strategy: "jwt" },
    pages: { signIn: "/signin" },
    providers,
    callbacks: {
      authorized({ auth: session }) {
        return !!session?.user;
      },
      async jwt({ token, user }) {
        if (user) token.id = user.id;
        return token;
      },
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
