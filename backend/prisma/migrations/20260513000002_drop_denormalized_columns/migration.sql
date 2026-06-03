-- Drop redundant denormalized columns (now resolved via FK relations)
ALTER TABLE "attivita" DROP COLUMN IF EXISTS "risorse_coinvolte";
ALTER TABLE "attivita" DROP COLUMN IF EXISTS "account";
ALTER TABLE "attivita" DROP COLUMN IF EXISTS "project_manager";
