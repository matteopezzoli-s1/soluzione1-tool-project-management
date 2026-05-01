-- AlterTable
ALTER TABLE "clienti" ADD COLUMN     "account_id" TEXT;

-- CreateIndex
CREATE INDEX "clienti_account_id_idx" ON "clienti"("account_id");

-- AddForeignKey
ALTER TABLE "clienti" ADD CONSTRAINT "clienti_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
