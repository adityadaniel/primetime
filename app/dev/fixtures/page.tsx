import { notFound } from 'next/navigation';
import FixturesBrowser from './fixtures-browser';

export const dynamic = 'force-static';

export default function DevFixturesPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <FixturesBrowser />;
}
