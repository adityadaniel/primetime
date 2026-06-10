import NextAuth from 'next-auth';
import authConfig from '@/auth.config';

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: [
    '/host/((?!.*\\.csv$).*)',
    '/api/quiz/:path*',
    '/api/wordcloud/:path*',
    '/api/q-and-a/:path*',
    '/api/stripe/:path*',
  ],
};
