// WonderWall room insights (host-only). Server component with the same auth +
// ownership guard as the control room. Builds the word-cloud frequencies from
// the scraped post text SERVER-SIDE (text never crosses to the client), and
// hands the client only the aggregated counts. Opt-in content analysis
// (DECISIONS.md 2026-06-21 "WonderWall content analysis (Apify)").

import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { textToWordCounts } from '@/lib/wonderwall-insights';
import { getRoomContentForInsights, WonderWallOwnershipError } from '@/lib/wonderwall-repo';
import WonderWallInsightsClient from './insights-client';

export const dynamic = 'force-dynamic';

export default async function WonderWallInsightsPage({
  params,
}: {
  params: Promise<{ pin: string }>;
}) {
  const { pin } = await params;
  if (!/^\d{6}$/.test(pin)) notFound();

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) notFound();

  let data: Awaited<ReturnType<typeof getRoomContentForInsights>>;
  try {
    data = await getRoomContentForInsights({ pin, hostUserId: userId });
  } catch (err) {
    if (err instanceof WonderWallOwnershipError) notFound();
    throw err;
  }
  if (!data) notFound();

  // Build frequencies on the server so raw post text is never shipped to the
  // browser; cap the words handed to the layout engine.
  const texts = data.posts.map((p) => p.text).filter((t): t is string => typeof t === 'string');
  const words = textToWordCounts(texts).slice(0, 150);

  return (
    <WonderWallInsightsClient
      pin={data.pin}
      title={data.title}
      analysisEnabled={data.analysisEnabled}
      words={words}
      counts={data.counts}
    />
  );
}
