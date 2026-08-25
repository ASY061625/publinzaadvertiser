-- Phase 4: internal admin — price history, admin audit log, import log,
-- publisher correspondence, per-item correspondence, reliability breakdown.
--
-- DROP INDEX statements for the Phase 1 GIN/composite catalog indexes were
-- stripped from the generated diff again (schema.prisma cannot express them,
-- so every diff reads them as drift).





-- AlterTable
ALTER TABLE "Publisher" ADD COLUMN     "avgDaysOverQuoted" INTEGER,
ADD COLUMN     "deadLinkCount" INTEGER,
ADD COLUMN     "onTimeRate" INTEGER,
ADD COLUMN     "rejectionRate" INTEGER,
ADD COLUMN     "reliabilityComputedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "PublisherNote" (
    "id" TEXT NOT NULL,
    "publisherId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublisherNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemCorrespondence" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemCorrespondence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SitePriceHistory" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "oldCostCents" INTEGER NOT NULL,
    "newCostCents" INTEGER NOT NULL,
    "oldPriceCents" INTEGER NOT NULL,
    "newPriceCents" INTEGER NOT NULL,
    "actorUserId" TEXT,
    "overrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SitePriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "fileName" TEXT NOT NULL,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublisherNote_publisherId_createdAt_idx" ON "PublisherNote"("publisherId", "createdAt");

-- CreateIndex
CREATE INDEX "ItemCorrespondence_orderItemId_createdAt_idx" ON "ItemCorrespondence"("orderItemId", "createdAt");

-- CreateIndex
CREATE INDEX "SitePriceHistory_siteId_createdAt_idx" ON "SitePriceHistory"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_entityType_entityId_createdAt_idx" ON "AdminAuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_actorUserId_createdAt_idx" ON "AdminAuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportLog_createdAt_idx" ON "ImportLog"("createdAt");

-- AddForeignKey
ALTER TABLE "PublisherNote" ADD CONSTRAINT "PublisherNote_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "Publisher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublisherNote" ADD CONSTRAINT "PublisherNote_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCorrespondence" ADD CONSTRAINT "ItemCorrespondence_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCorrespondence" ADD CONSTRAINT "ItemCorrespondence_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePriceHistory" ADD CONSTRAINT "SitePriceHistory_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePriceHistory" ADD CONSTRAINT "SitePriceHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportLog" ADD CONSTRAINT "ImportLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

