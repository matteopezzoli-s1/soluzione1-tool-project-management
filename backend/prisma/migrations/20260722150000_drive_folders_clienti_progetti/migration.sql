-- Cartelle Google Drive collegate a clienti e progetti (binding per ID).
-- Additiva e idempotente: solo colonne nullable, nessun dato toccato.

ALTER TABLE "clienti" ADD COLUMN IF NOT EXISTS "drive_folder_id" TEXT;
ALTER TABLE "clienti" ADD COLUMN IF NOT EXISTS "drive_folder_url" TEXT;

ALTER TABLE "progetti" ADD COLUMN IF NOT EXISTS "drive_folder_id" TEXT;
ALTER TABLE "progetti" ADD COLUMN IF NOT EXISTS "drive_folder_url" TEXT;
ALTER TABLE "progetti" ADD COLUMN IF NOT EXISTS "drive_analisi_folder_id" TEXT;
