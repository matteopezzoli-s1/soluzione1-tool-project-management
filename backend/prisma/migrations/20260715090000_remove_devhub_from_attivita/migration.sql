-- Il responsabile DevHub si sposta dal livello attività (Attivita) al
-- livello progetto (Progetto.responsabile_dev_hub_id, già esistente).

-- DropForeignKey
ALTER TABLE "attivita" DROP CONSTRAINT IF EXISTS "attivita_dev_hub_id_fkey";

-- DropIndex
DROP INDEX IF EXISTS "attivita_dev_hub_id_idx";

-- AlterTable
ALTER TABLE "attivita" DROP COLUMN IF EXISTS "dev_hub_id";
