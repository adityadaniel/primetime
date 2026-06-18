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
    // NOTE: there is deliberately NO '/api/wonderwall/:path*' matcher. WonderWall
    // mixes public-by-PIN endpoints (GET /[pin] state, POST /[pin]/posts
    // submissions, GET /[pin]/my-posts feedback) with host-only ones
    // (/[pin]/posts/[postId], /[pin]/posts/reorder, /[pin]/export).
    // A blanket matcher would break the public/participant endpoints, so the
    // host-only routes enforce auth + ownership at the handler level instead.
    // See docs/wonderwall-iframe-plan.md §10.2 and MID-404.
  ],
};
