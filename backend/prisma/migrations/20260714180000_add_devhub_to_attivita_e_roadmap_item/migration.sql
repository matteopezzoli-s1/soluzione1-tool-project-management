-- AlterTable
ALTER TABLE "attivita" ADD COLUMN     "dev_hub_id" TEXT;

-- AlterTable
ALTER TABLE "roadmap_items" ADD COLUMN     "dev_hub_id" TEXT;

-- CreateIndex
CREATE INDEX "attivita_dev_hub_id_idx" ON "attivita"("dev_hub_id");

-- CreateIndex
CREATE INDEX "roadmap_items_dev_hub_id_idx" ON "roadmap_items"("dev_hub_id");

-- AddForeignKey
ALTER TABLE "attivita" ADD CONSTRAINT "attivita_dev_hub_id_fkey" FOREIGN KEY ("dev_hub_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roadmap_items" ADD CONSTRAINT "roadmap_items_dev_hub_id_fkey" FOREIGN KEY ("dev_hub_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
