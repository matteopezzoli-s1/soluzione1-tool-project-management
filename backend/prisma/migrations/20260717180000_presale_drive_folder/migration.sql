-- Integrazione Google Drive (presale): cartella Drive del file analisi
-- iniziale, memorizzata quando il file viene scelto con il picker. La fase
-- Stima apre il picker bloccato su questa cartella. Additivo.

-- AlterTable
ALTER TABLE "attivita" ADD COLUMN "presale_drive_folder_id" TEXT;
