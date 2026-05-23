-- CreateEnum
CREATE TYPE "WordCloudStatus" AS ENUM ('LOBBY', 'LIVE', 'PAUSED', 'ENDED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "WordCloudSession" (
    "id" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "prompt" VARCHAR(200) NOT NULL,
    "wordsPerPlayer" INTEGER NOT NULL DEFAULT 3,
    "profanityFilter" BOOLEAN NOT NULL DEFAULT true,
    "hostUserId" TEXT,
    "status" "WordCloudStatus" NOT NULL DEFAULT 'LOBBY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "WordCloudSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WordCloudPlayer" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WordCloudPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WordCloudSubmission" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "rawText" VARCHAR(40) NOT NULL,
    "normalized" VARCHAR(40) NOT NULL,
    "removed" BOOLEAN NOT NULL DEFAULT false,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WordCloudSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WordCloudModeration" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "hostUserId" TEXT,
    "word" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WordCloudModeration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WordCloudSession_pin_key" ON "WordCloudSession"("pin");

-- CreateIndex
CREATE INDEX "WordCloudSession_hostUserId_createdAt_idx" ON "WordCloudSession"("hostUserId", "createdAt");

-- CreateIndex
CREATE INDEX "WordCloudSession_status_idx" ON "WordCloudSession"("status");

-- CreateIndex
CREATE INDEX "WordCloudPlayer_sessionId_idx" ON "WordCloudPlayer"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "WordCloudPlayer_sessionId_nickname_key" ON "WordCloudPlayer"("sessionId", "nickname");

-- CreateIndex
CREATE INDEX "WordCloudSubmission_sessionId_normalized_idx" ON "WordCloudSubmission"("sessionId", "normalized");

-- CreateIndex
CREATE INDEX "WordCloudSubmission_sessionId_removed_idx" ON "WordCloudSubmission"("sessionId", "removed");

-- CreateIndex
CREATE INDEX "WordCloudModeration_sessionId_createdAt_idx" ON "WordCloudModeration"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "WordCloudSession" ADD CONSTRAINT "WordCloudSession_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordCloudPlayer" ADD CONSTRAINT "WordCloudPlayer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WordCloudSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordCloudSubmission" ADD CONSTRAINT "WordCloudSubmission_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WordCloudSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordCloudSubmission" ADD CONSTRAINT "WordCloudSubmission_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "WordCloudPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordCloudModeration" ADD CONSTRAINT "WordCloudModeration_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WordCloudSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
