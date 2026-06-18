-- CreateEnum
CREATE TYPE "WonderWallStatus" AS ENUM ('DRAFT', 'LIVE', 'ENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WonderWallPostStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'HIDDEN', 'FAILED');

-- CreateTable
CREATE TABLE "WonderWallSession" (
    "id" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "description" VARCHAR(200),
    "instructions" VARCHAR(240),
    "status" "WonderWallStatus" NOT NULL DEFAULT 'DRAFT',
    "hostUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "WonderWallSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WonderWallPost" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "urn" VARCHAR(120) NOT NULL,
    "embedUrl" TEXT NOT NULL,
    "status" "WonderWallPostStatus" NOT NULL DEFAULT 'PENDING',
    "canDisplay" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER,
    "submitterName" VARCHAR(40),
    "submitterKey" VARCHAR(120),
    "rejectionReason" VARCHAR(240),
    "failureReason" VARCHAR(240),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByHostUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "hiddenAt" TIMESTAMP(3),
    "restoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WonderWallPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WonderWallSession_pin_key" ON "WonderWallSession"("pin");

-- CreateIndex
CREATE INDEX "WonderWallSession_hostUserId_createdAt_idx" ON "WonderWallSession"("hostUserId", "createdAt");

-- CreateIndex
CREATE INDEX "WonderWallSession_status_idx" ON "WonderWallSession"("status");

-- CreateIndex
CREATE INDEX "WonderWallPost_sessionId_position_idx" ON "WonderWallPost"("sessionId", "position");

-- CreateIndex
CREATE INDEX "WonderWallPost_sessionId_status_idx" ON "WonderWallPost"("sessionId", "status");

-- CreateIndex
CREATE INDEX "WonderWallPost_sessionId_canDisplay_position_idx" ON "WonderWallPost"("sessionId", "canDisplay", "position");

-- AddForeignKey
ALTER TABLE "WonderWallSession" ADD CONSTRAINT "WonderWallSession_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WonderWallPost" ADD CONSTRAINT "WonderWallPost_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WonderWallSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
