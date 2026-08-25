-- Phase 3: cart, order idempotency, reference counter, and the item status audit trail.
--
-- The generated diff also emitted DROP INDEX for idx_cos_category_site,
-- idx_site_domain_trgm, idx_site_sens and idx_metric_dr_tr. Those were removed:
-- they are the Phase 1 GIN/composite catalog indexes, which schema.prisma cannot
-- express, so every diff reads them as drift. Strip them from generated SQL.





-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateTable
CREATE TABLE "Cart" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartLine" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CartLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderCounter" (
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderCounter_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "ItemStatusEvent" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "fromStatus" "ItemStatus",
    "toStatus" "ItemStatus" NOT NULL,
    "actorUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cart_userId_key" ON "Cart"("userId");

-- CreateIndex
CREATE INDEX "CartLine_cartId_idx" ON "CartLine"("cartId");

-- CreateIndex
CREATE INDEX "CartLine_siteId_idx" ON "CartLine"("siteId");

-- CreateIndex
CREATE INDEX "CartLine_projectId_idx" ON "CartLine"("projectId");

-- CreateIndex
CREATE INDEX "ItemStatusEvent_orderItemId_createdAt_idx" ON "ItemStatusEvent"("orderItemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderItem_assignedToId_status_idx" ON "OrderItem"("assignedToId", "status");

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartLine" ADD CONSTRAINT "CartLine_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartLine" ADD CONSTRAINT "CartLine_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartLine" ADD CONSTRAINT "CartLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemStatusEvent" ADD CONSTRAINT "ItemStatusEvent_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemStatusEvent" ADD CONSTRAINT "ItemStatusEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

