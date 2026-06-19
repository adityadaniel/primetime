-- Host-only author label for WonderWall (DECISIONS.md 2026-06-19 "WonderWall
-- author label"). Nullable display name captured during height measurement,
-- shown only on the host control surface. No other profile data is stored.

-- AlterTable
ALTER TABLE "WonderWallPost" ADD COLUMN     "authorName" VARCHAR(120);
