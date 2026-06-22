/**
 * Backfill WonderWall content for a room's already-approved posts.
 *
 * The approval flow auto-fetches content for NEW approvals (when
 * WONDERWALL_ANALYSIS_ENABLED=true); this script fetches it for posts approved
 * before the feature, so a room's insights word cloud has data. Real Apify
 * calls — costs credits. Opt-in feature (DECISIONS.md 2026-06-21).
 *
 * Usage: npx tsx scripts/fetch-wonderwall-content.ts <6-digit-pin>
 */
import { loadEnvConfig } from '@next/env';

// Load .env + .env.local exactly like Next, so APIFY_TOKEN (in .env.local) is
// available. Must run before importing modules that read env at load time.
loadEnvConfig(process.cwd());

async function main() {
  const pin = process.argv[2] ?? '517237';
  if (!/^\d{6}$/.test(pin)) {
    console.error('Usage: npx tsx scripts/fetch-wonderwall-content.ts <6-digit-pin>');
    process.exit(1);
  }
  if (!process.env.APIFY_TOKEN) {
    console.error('APIFY_TOKEN is not set (expected in .env.local).');
    process.exit(1);
  }

  const { prisma } = await import('../lib/db');
  const { fetchAndStorePostContent } = await import('../lib/wonderwall-content');
  const { textToWordCounts } = await import('../lib/wonderwall-insights');

  try {
    const session = await prisma.wonderWallSession.findUnique({
      where: { pin },
      include: {
        posts: {
          where: { status: 'APPROVED', canDisplay: true },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (!session) {
      console.error(`No WonderWall found for pin ${pin}.`);
      process.exit(1);
    }

    console.log(`\nFetching content for ${session.posts.length} approved post(s) in ${pin}…\n`);
    for (const post of session.posts) {
      await fetchAndStorePostContent(post.id);
      const c = await prisma.wonderWallPostContent.findUnique({ where: { postId: post.id } });
      if (c?.status === 'OK') {
        const snippet = (c.text ?? '').replace(/\s+/g, ' ').slice(0, 70);
        console.log(`  ✓ ${(c.authorName ?? post.urn).padEnd(28)} ${snippet}…`);
      } else {
        console.log(`  ✗ ${post.urn.padEnd(40)} ${c?.status} (${c?.failureReason ?? ''})`);
      }
    }

    const contents = await prisma.wonderWallPostContent.findMany({
      where: { post: { sessionId: session.id }, status: 'OK' },
      select: { text: true },
    });
    const words = textToWordCounts(
      contents.map((c) => c.text).filter((t): t is string => typeof t === 'string'),
    );
    console.log(
      `\nTop words (${words.length} unique): ` +
        words
          .slice(0, 20)
          .map((w) => `${w.normalized}·${w.count}`)
          .join('  '),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('fetch-wonderwall-content failed:', err);
  process.exit(1);
});
