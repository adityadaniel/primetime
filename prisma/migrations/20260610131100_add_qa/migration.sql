-- CreateEnum
CREATE TYPE "QASessionStatus" AS ENUM ('OPEN', 'CLOSED', 'ENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "QAQuestionStatus" AS ENUM ('IN_REVIEW', 'LIVE', 'ANSWERED', 'ARCHIVED', 'DISMISSED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "QAPrivacyMode" AS ENUM ('ANONYMOUS_BY_DEFAULT', 'ALWAYS_ANONYMOUS', 'NAMED_BY_DEFAULT', 'NAME_REQUIRED');

-- CreateEnum
CREATE TYPE "QAVoteType" AS ENUM ('UP', 'DOWN');

-- CreateTable
CREATE TABLE "QASession" (
    "id" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "description" VARCHAR(200),
    "privacyMode" "QAPrivacyMode" NOT NULL DEFAULT 'ANONYMOUS_BY_DEFAULT',
    "moderationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "participantRepliesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "downvotesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "questionCharLimit" INTEGER NOT NULL DEFAULT 280,
    "status" "QASessionStatus" NOT NULL DEFAULT 'OPEN',
    "hostUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "QASession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QAParticipant" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "displayName" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QAParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QAQuestion" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "participantId" TEXT,
    "text" VARCHAR(500) NOT NULL,
    "originalText" VARCHAR(500),
    "isAnonymous" BOOLEAN NOT NULL DEFAULT true,
    "authorDisplayName" TEXT,
    "status" "QAQuestionStatus" NOT NULL DEFAULT 'LIVE',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QAQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QAVote" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "type" "QAVoteType" NOT NULL DEFAULT 'UP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QAVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QALabel" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "participantSelectable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QALabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QAQuestionLabel" (
    "questionId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QAQuestionLabel_pkey" PRIMARY KEY ("questionId","labelId")
);

-- CreateTable
CREATE TABLE "QAReply" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "participantId" TEXT,
    "isHostReply" BOOLEAN NOT NULL DEFAULT false,
    "text" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QAReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QAModerationEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "questionId" TEXT,
    "hostUserId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QAModerationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QASession_pin_key" ON "QASession"("pin");

-- CreateIndex
CREATE INDEX "QASession_hostUserId_createdAt_idx" ON "QASession"("hostUserId", "createdAt");

-- CreateIndex
CREATE INDEX "QASession_status_idx" ON "QASession"("status");

-- CreateIndex
CREATE INDEX "QAParticipant_sessionId_idx" ON "QAParticipant"("sessionId");

-- CreateIndex
CREATE INDEX "QAQuestion_sessionId_status_idx" ON "QAQuestion"("sessionId", "status");

-- CreateIndex
CREATE INDEX "QAQuestion_sessionId_submittedAt_idx" ON "QAQuestion"("sessionId", "submittedAt");

-- CreateIndex
CREATE INDEX "QAVote_questionId_idx" ON "QAVote"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "QAVote_questionId_participantId_key" ON "QAVote"("questionId", "participantId");

-- CreateIndex
CREATE INDEX "QALabel_sessionId_idx" ON "QALabel"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "QALabel_sessionId_name_key" ON "QALabel"("sessionId", "name");

-- CreateIndex
CREATE INDEX "QAQuestionLabel_labelId_idx" ON "QAQuestionLabel"("labelId");

-- CreateIndex
CREATE INDEX "QAReply_questionId_createdAt_idx" ON "QAReply"("questionId", "createdAt");

-- CreateIndex
CREATE INDEX "QAModerationEvent_sessionId_createdAt_idx" ON "QAModerationEvent"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "QASession" ADD CONSTRAINT "QASession_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QAParticipant" ADD CONSTRAINT "QAParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QASession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QAQuestion" ADD CONSTRAINT "QAQuestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QASession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QAQuestion" ADD CONSTRAINT "QAQuestion_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "QAParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QAVote" ADD CONSTRAINT "QAVote_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QAQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QAVote" ADD CONSTRAINT "QAVote_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "QAParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QALabel" ADD CONSTRAINT "QALabel_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QASession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QAQuestionLabel" ADD CONSTRAINT "QAQuestionLabel_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QAQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QAQuestionLabel" ADD CONSTRAINT "QAQuestionLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "QALabel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QAReply" ADD CONSTRAINT "QAReply_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QAQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QAReply" ADD CONSTRAINT "QAReply_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "QAParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QAModerationEvent" ADD CONSTRAINT "QAModerationEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QASession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QAModerationEvent" ADD CONSTRAINT "QAModerationEvent_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QAQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
