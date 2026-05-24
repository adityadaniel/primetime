import type { Metadata } from 'next';
import './globals.css';
import Providers from './providers';

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:4321';
}

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: 'INPUT/OUTPUT — Live quizzes done well',
    template: '%s — INPUT/OUTPUT',
  },
  description:
    'INPUT/OUTPUT is a real-time quiz network for classrooms, conference rooms, and the back of any room with a projector. Editorial brutalist by design — no purple gradient.',
  applicationName: 'INPUT/OUTPUT',
  keywords: [
    'live quiz',
    'classroom quiz',
    'real-time quiz',
    'kahoot alternative',
    'input/output',
    'projector trivia',
  ],
  openGraph: {
    type: 'website',
    siteName: 'INPUT/OUTPUT',
    title: 'INPUT/OUTPUT — Live quizzes done well',
    description:
      'A real-time quiz broadcast for classrooms and conference rooms. Editorial brutalist by design.',
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'INPUT/OUTPUT — Live quizzes done well',
    description: 'A real-time quiz broadcast. Editorial brutalist by design.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;900&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,700;1,6..72,400;1,6..72,700&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
