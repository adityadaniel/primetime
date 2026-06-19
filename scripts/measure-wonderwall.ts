/**
 * Batch-measure WonderWall card heights for a wall.
 *
 * Loads the APPROVED + displayable posts for a PIN, renders each official embed
 * headless (collapsed), and writes the measured height back to the row. This is
 * the reusable core that POC 3 will call automatically on approval; as a CLI it
 * also seeds the masonry wall so the variable-height display is visible.
 *
 * Per DECISIONS.md (2026-06-19 "WonderWall dynamic-height"): official embed URLs
 * only, no login, stores only the height integer + measurement bookkeeping.
 *
 * Usage:
 *   npx tsx scripts/measure-wonderwall.ts <pin>
 *
 * Requires the 20260619000000_add_wonderwall_post_height migration to be applied.
 */
import { PrismaClient } from '@prisma/client';
import { measureEmbedHeight } from '../lib/wonderwall-measure';

async function main() {
  const pin = process.argv[2];
  if (!pin || !/^\d{6}$/.test(pin)) {
    console.error('Usage: npx tsx scripts/measure-wonderwall.ts <6-digit-pin>');
    process.exit(1);
  }

  const prisma = new PrismaClient();
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
    if (session.posts.length === 0) {
      console.log(`Wall ${pin} has no approved/displayable posts to measure.`);
      return;
    }

    console.log(`\nMeasuring ${session.posts.length} post(s) on wall ${pin}…\n`);
    let ok = 0;
    let failed = 0;
    // Sequential: one headless Chromium at a time keeps memory bounded.
    for (const post of session.posts) {
      const result = await measureEmbedHeight(post.embedUrl);
      await prisma.wonderWallPost.update({
        where: { id: post.id },
        data: {
          measuredHeight: result.status === 'OK' ? result.height : null,
          measureStatus: result.status,
          measuredAt: new Date(),
          ...(result.status === 'OK' ? { authorName: result.author } : {}),
        },
      });
      if (result.status === 'OK') {
        ok += 1;
        console.log(`  ✓ ${(result.author ?? post.urn).padEnd(36)} ${result.height}px`);
      } else {
        failed += 1;
        console.log(`  ✗ ${post.urn.padEnd(36)} FAILED (${result.reason}) → default height`);
      }
    }
    console.log(`\nDone: ${ok} measured, ${failed} fell back to default.\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('measure-wonderwall failed:', err);
  process.exit(1);
});
