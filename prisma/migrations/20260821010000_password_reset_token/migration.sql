-- Phase 2: password reset tokens.
--
-- NOTE: `prisma migrate diff` also emitted DROP INDEX for idx_cos_category_site,
-- idx_site_domain_trgm, idx_site_sens and idx_metric_dr_tr. Those drops were
-- removed deliberately. Those are the GIN and composite catalog indexes created
-- in 20260820000100; Prisma's schema language cannot express them, so every
-- future diff will read them as drift and try to drop them again. Strip the
-- DROP INDEX lines from any generated migration before applying it.

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
