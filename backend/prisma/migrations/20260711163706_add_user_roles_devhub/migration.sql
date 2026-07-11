-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ACCOUNT', 'PM', 'BOARD', 'DEVHUB');

-- AlterTable
ALTER TABLE "progetti" ADD COLUMN     "responsabile_dev_hub_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "first_name" TEXT,
ADD COLUMN     "last_name" TEXT,
ADD COLUMN     "roles" "UserRole"[] DEFAULT ARRAY[]::"UserRole"[],
ALTER COLUMN "google_id" DROP NOT NULL,
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "name" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "progetti_responsabile_dev_hub_id_idx" ON "progetti"("responsabile_dev_hub_id");

-- AddForeignKey
ALTER TABLE "progetti" ADD CONSTRAINT "progetti_responsabile_dev_hub_id_fkey" FOREIGN KEY ("responsabile_dev_hub_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
