-- Dynamic-height masonry for WonderWall (DECISIONS.md 2026-06-19
-- "WonderWall dynamic-height"). All nullable; stores only layout-height
-- integers + measurement bookkeeping, never LinkedIn post content.

-- AlterTable
ALTER TABLE "WonderWallPost" ADD COLUMN     "measuredHeight" INTEGER,
ADD COLUMN     "overrideHeight" INTEGER,
ADD COLUMN     "measuredAt" TIMESTAMP(3),
ADD COLUMN     "measureStatus" VARCHAR(16);
