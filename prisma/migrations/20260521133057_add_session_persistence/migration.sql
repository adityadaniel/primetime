-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('active', 'finished', 'abandoned');

-- CreateTable
CREATE TABLE "GameSession" (
    "id" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "hostUserId" TEXT,
    "quizSnapshot" JSONB NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "finalLeaderboard" JSONB,

    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionPlayer" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "inGameId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalScore" INTEGER NOT NULL DEFAULT 0,
    "finalRank" INTEGER,

    CONSTRAINT "SessionPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionAnswer" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "questionIndex" INTEGER NOT NULL,
    "playerInGameId" TEXT NOT NULL,
    "optionIndex" INTEGER NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "msFromStart" INTEGER NOT NULL,
    "awarded" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GameSession_pin_key" ON "GameSession"("pin");

-- CreateIndex
CREATE INDEX "GameSession_hostUserId_createdAt_idx" ON "GameSession"("hostUserId", "createdAt");

-- CreateIndex
CREATE INDEX "GameSession_status_idx" ON "GameSession"("status");

-- CreateIndex
CREATE INDEX "SessionPlayer_sessionId_idx" ON "SessionPlayer"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionPlayer_sessionId_inGameId_key" ON "SessionPlayer"("sessionId", "inGameId");

-- CreateIndex
CREATE INDEX "SessionAnswer_sessionId_questionIndex_idx" ON "SessionAnswer"("sessionId", "questionIndex");

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionPlayer" ADD CONSTRAINT "SessionPlayer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAnswer" ADD CONSTRAINT "SessionAnswer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
