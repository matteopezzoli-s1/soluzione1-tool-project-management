-- PM di riferimento del progetto (un solo PM). Additivo, nullable.

-- AlterTable
ALTER TABLE "progetti" ADD COLUMN "pm_riferimento_id" TEXT;

-- CreateIndex
CREATE INDEX "progetti_pm_riferimento_id_idx" ON "progetti"("pm_riferimento_id");

-- AddForeignKey
ALTER TABLE "progetti" ADD CONSTRAINT "progetti_pm_riferimento_id_fkey" FOREIGN KEY ("pm_riferimento_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
