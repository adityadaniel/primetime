import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

export default {
  pages: { signIn: "/signin" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
    async jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
  },
} satisfies NextAuthConfig;
