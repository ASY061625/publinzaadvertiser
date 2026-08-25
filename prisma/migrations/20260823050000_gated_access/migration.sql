-- Gated access: accounts must be approved by staff before the catalog is visible.
--
-- DROP INDEX statements for the Phase 1 GIN/expression catalog indexes were
-- stripped from the generated diff again (schema.prisma cannot express them).

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');





-- AlterTable
ALTER TABLE "User" ADD COLUMN     "companyName" TEXT,
ADD COLUMN     "companyWebsite" TEXT,
ADD COLUMN     "jobRole" TEXT,
ADD COLUMN     "promoting" TEXT,
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "statusDecidedAt" TIMESTAMP(3),
ADD COLUMN     "statusDecidedById" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_statusDecidedById_fkey" FOREIGN KEY ("statusDecidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: the column defaults to PENDING, which is right for new signups but
-- would lock out every account that already exists. Anyone here before gating
-- was introduced keeps the access they already had.
UPDATE "User" SET "status" = 'APPROVED' WHERE "createdAt" < NOW();
