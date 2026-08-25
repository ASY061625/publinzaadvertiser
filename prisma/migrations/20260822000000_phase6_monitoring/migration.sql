-- Phase 6: metrics refresh cadence + link verification.
--
-- DROP INDEX statements for the Phase 1 GIN/expression catalog indexes were
-- stripped from the generated diff again (schema.prisma cannot express them).

-- CreateEnum
CREATE TYPE "LinkCheckOutcome" AS ENUM ('OK', 'LINK_ABSENT', 'REL_CHANGED', 'ANCHOR_CHANGED', 'ARTICLE_DELETED', 'ARTICLE_MOVED', 'URL_CHANGED', 'DEINDEXED', 'BLOCKED', 'FETCH_ERROR');





-- AlterTable
ALTER TABLE "LinkCheck" ADD COLUMN     "anchorTextSeen" TEXT,
ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "finalUrl" TEXT,
ADD COLUMN     "manualReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "outcome" "LinkCheckOutcome" NOT NULL DEFAULT 'OK',
ADD COLUMN     "redirectCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "lastViewedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LinkAlert" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "outcome" "LinkCheckOutcome" NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "refundEligibleAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,

    CONSTRAINT "LinkAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricsSpend" (
    "day" TEXT NOT NULL,
    "lookups" INTEGER NOT NULL DEFAULT 0,
    "spentMinor" INTEGER NOT NULL DEFAULT 0,
    "capMinor" INTEGER NOT NULL,
    "capHitAt" TIMESTAMP(3),
    "alertedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetricsSpend_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "MetricsRefreshLog" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "costMinor" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricsRefreshLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LinkAlert_orderItemId_openedAt_idx" ON "LinkAlert"("orderItemId", "openedAt");

-- CreateIndex
CREATE INDEX "LinkAlert_resolvedAt_idx" ON "LinkAlert"("resolvedAt");

-- CreateIndex
CREATE INDEX "MetricsRefreshLog_siteId_createdAt_idx" ON "MetricsRefreshLog"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "LinkCheck_outcome_checkedAt_idx" ON "LinkCheck"("outcome", "checkedAt");

-- AddForeignKey
ALTER TABLE "LinkAlert" ADD CONSTRAINT "LinkAlert_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

