import type { NextAuthConfig } from 'next-auth';

// OSS default: no third-party OAuth providers. The runtime config in
// `auth.ts` adds Credentials (email + password), and conditionally adds
// Apple if `ENABLE_APPLE_SIGNIN=true` is set in the environment. Other
// providers can be wired in by self-hosters who need them — keep the OSS
// default friction-free.
export default {
  pages: { signIn: '/signin' },
  providers: [],
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
