-- Add escludi_da_conteggio to stato_attivita_config
ALTER TABLE "stato_attivita_config" ADD COLUMN "escludi_da_conteggio" BOOLEAN NOT NULL DEFAULT false;

-- Set IN_APPROVAZIONE as excluded from budget count by default
UPDATE "stato_attivita_config" SET "escludi_da_conteggio" = true WHERE "chiave" = 'IN_APPROVAZIONE';
