-- Phase 5: pay-per-order payments — ledger fields, webhook idempotency,
-- invoices with gapless numbering, and billing details on User/Order.
--
-- DROP INDEX statements for the Phase 1 GIN/expression catalog indexes were
-- stripped from the generated diff again (schema.prisma cannot express them).





-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "billingCountry" TEXT,
ADD COLUMN     "displayCurrency" TEXT,
ADD COLUMN     "displayTotalMinor" INTEGER,
ADD COLUMN     "fxRateMicros" INTEGER,
ADD COLUMN     "paymentProvider" TEXT,
ADD COLUMN     "providerIntentId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "actorUserId" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "orderItemId" TEXT,
ADD COLUMN     "providerEventId" TEXT,
ADD COLUMN     "reason" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "billingAddress" TEXT,
ADD COLUMN     "billingCountry" TEXT,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "taxId" TEXT;

-- CreateTable
CREATE TABLE "ProcessedWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "orderId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "payloadDigest" TEXT,

    CONSTRAINT "ProcessedWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "buyerLegalName" TEXT NOT NULL,
    "buyerAddress" TEXT,
    "buyerTaxId" TEXT,
    "buyerCountry" TEXT,
    "subtotalMinor" INTEGER NOT NULL,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "pdfPath" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "pdfPath" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentCounter" (
    "key" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ProcessedWebhookEvent_orderId_idx" ON "ProcessedWebhookEvent"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedWebhookEvent_provider_providerEventId_key" ON "ProcessedWebhookEvent"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "Invoice_userId_issuedAt_idx" ON "Invoice"("userId", "issuedAt");

-- CreateIndex
CREATE INDEX "Invoice_orderId_idx" ON "Invoice"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_number_key" ON "CreditNote"("number");

-- CreateIndex
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_providerIntentId_key" ON "Order"("providerIntentId");

-- CreateIndex
CREATE INDEX "Transaction_orderId_createdAt_idx" ON "Transaction"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_orderItemId_idx" ON "Transaction"("orderItemId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

