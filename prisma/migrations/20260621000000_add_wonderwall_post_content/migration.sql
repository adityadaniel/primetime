-- WonderWall content analysis (DECISIONS.md 2026-06-21 "WonderWall content
-- analysis (Apify)"). Flag-gated, host-only scraped post content; cascades on
-- post delete. Reverses the v1 "store no post content" boundary — opt-in only
-- via WONDERWALL_ANALYSIS_ENABLED.

-- CreateTable
CREATE TABLE "WonderWallPostContent" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "text" TEXT,
    "authorName" VARCHAR(160),
    "authorHeadline" VARCHAR(240),
    "numLikes" INTEGER,
    "numComments" INTEGER,
    "numShares" INTEGER,
    "postedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3),
    "failureReason" VARCHAR(240),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WonderWallPostContent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WonderWallPostContent_postId_key" ON "WonderWallPostContent"("postId");

-- AddForeignKey
ALTER TABLE "WonderWallPostContent" ADD CONSTRAINT "WonderWallPostContent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "WonderWallPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
