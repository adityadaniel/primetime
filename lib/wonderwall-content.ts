// WonderWall content-fetch worker. Mirrors the height-measurement worker in
// lib/wonderwall-repo.ts (measureAndStorePostHeight / measurePostHeightInBackground):
// fire-and-forget on approval, with a PENDING → OK/FAILED status on the 1:1
// WonderWallPostContent row.
//
// FLAG-GATED LinkedIn scraping (DECISIONS.md 2026-06-21 "WonderWall content
// analysis (Apify)"). Callers gate on config.wonderwallAnalysisEnabled; the
// Apify client additionally no-ops without APIFY_TOKEN. The fetched content is
// HOST-ONLY (insights surface) and never exposed on public/participant surfaces.

import { prisma } from './db';

export async function fetchAndStorePostContent(postId: string): Promise<void> {
  const post = await prisma.wonderWallPost.findUnique({
    where: { id: postId },
    select: { id: true, originalUrl: true },
  });
  if (!post) return;

  await prisma.wonderWallPostContent.upsert({
    where: { postId },
    create: { postId, status: 'PENDING' },
    update: { status: 'PENDING', failureReason: null },
  });

  // Dynamic import keeps the (network) Apify client out of any static graph that
  // imports this module; it's only loaded when a fetch actually runs.
  const { fetchLinkedInPost } = await import('./wonderwall-apify');
  const result = await fetchLinkedInPost(post.originalUrl);

  if (result.ok) {
    await prisma.wonderWallPostContent.update({
      where: { postId },
      data: {
        status: 'OK',
        text: result.data.text,
        authorName: result.data.authorName,
        authorHeadline: result.data.authorHeadline,
        numLikes: result.data.numLikes,
        numComments: result.data.numComments,
        numShares: result.data.numShares,
        postedAt: result.data.postedAt,
        fetchedAt: new Date(),
        failureReason: null,
      },
    });
  } else {
    await prisma.wonderWallPostContent.update({
      where: { postId },
      data: {
        status: 'FAILED',
        fetchedAt: new Date(),
        failureReason: result.error.slice(0, 240),
      },
    });
  }
}

// Fire-and-forget wrapper for the approval path: kicks off the fetch without
// blocking the host's HTTP response. The next insights poll surfaces the result.
export function fetchPostContentInBackground(postId: string): void {
  void fetchAndStorePostContent(postId).catch((err) => {
    console.error(`[wonderwall] background content fetch failed for ${postId}:`, err);
  });
}
