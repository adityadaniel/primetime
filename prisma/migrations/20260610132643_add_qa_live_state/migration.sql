-- AlterTable
ALTER TABLE "QASession" ADD COLUMN     "highlightedQuestionId" TEXT,
ADD COLUMN     "votingOpen" BOOLEAN NOT NULL DEFAULT true;
