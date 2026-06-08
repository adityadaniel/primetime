-- AlterTable
-- Optional per-question image URL (MID-278). Nullable so existing text-only
-- questions remain valid without a backfill.
ALTER TABLE "Question" ADD COLUMN     "imageUrl" TEXT;
