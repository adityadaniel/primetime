-- AlterTable
ALTER TABLE "Quiz" ADD COLUMN     "userId" TEXT;

-- Backfill existing quizzes to the earliest-created user, treated as the deploying admin.
-- If no user exists, fail clearly rather than creating orphaned quiz ownership.
DO $$
DECLARE
  deploying_admin_id TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Quiz" WHERE "userId" IS NULL) THEN
    RETURN;
  END IF;

  SELECT "id"
    INTO deploying_admin_id
    FROM "User"
   ORDER BY "createdAt" ASC, "id" ASC
   LIMIT 1;

  IF deploying_admin_id IS NULL THEN
    RAISE EXCEPTION 'Cannot backfill Quiz.userId: no users exist to own existing quizzes';
  END IF;

  UPDATE "Quiz"
     SET "userId" = deploying_admin_id
   WHERE "userId" IS NULL;
END $$;

ALTER TABLE "Quiz" ALTER COLUMN "userId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Quiz_userId_idx" ON "Quiz"("userId");

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
