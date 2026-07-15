-- Il responsabile DevHub non è più un attributo della singola attività
-- roadmap (RoadmapItem): viene ereditato dal prodotto/progetto associato
-- (Progetto.responsabile_dev_hub_id, già esistente).

-- DropForeignKey
ALTER TABLE "roadmap_items" DROP CONSTRAINT IF EXISTS "roadmap_items_dev_hub_id_fkey";

-- DropIndex
DROP INDEX IF EXISTS "roadmap_items_dev_hub_id_idx";

-- AlterTable
ALTER TABLE "roadmap_items" DROP COLUMN IF EXISTS "dev_hub_id";
