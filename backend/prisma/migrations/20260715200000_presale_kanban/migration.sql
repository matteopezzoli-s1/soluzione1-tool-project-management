-- Presale Kanban: flag "fase presale" sugli stati, campi presale sull'attività,
-- tabella dello storico passaggi, e seed idempotente delle 5 fasi di default.
--
-- NB: il diff automatico proponeva anche di droppare alcune tabelle "_backup_*"
-- (residui della migrazione ProjectManager/Account -> User): volutamente NON
-- incluse qui, non fanno parte di questa feature.

-- AlterTable: campi presale sull'attività (tutti nullable, additivi)
ALTER TABLE "attivita" ADD COLUMN     "presale_assegnatario_id" TEXT,
ADD COLUMN     "presale_giornate_stimate" DECIMAL(10,2),
ADD COLUMN     "presale_link_requisiti" TEXT,
ADD COLUMN     "presale_link_stima" TEXT,
ADD COLUMN     "presale_scadenza_stima" TIMESTAMP(3);

-- AlterTable: flag "fase presale" sugli stati attività
ALTER TABLE "stato_attivita_config" ADD COLUMN     "is_presale" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: storico dei passaggi di stato (timeline Presale)
CREATE TABLE "attivita_stato_log" (
    "id" TEXT NOT NULL,
    "attivita_id" TEXT NOT NULL,
    "stato_da" TEXT,
    "stato_a" TEXT NOT NULL,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attivita_stato_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attivita_stato_log_attivita_id_idx" ON "attivita_stato_log"("attivita_id");

-- CreateIndex
CREATE INDEX "attivita_presale_assegnatario_id_idx" ON "attivita"("presale_assegnatario_id");

-- AddForeignKey
ALTER TABLE "attivita" ADD CONSTRAINT "attivita_presale_assegnatario_id_fkey" FOREIGN KEY ("presale_assegnatario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attivita_stato_log" ADD CONSTRAINT "attivita_stato_log_attivita_id_fkey" FOREIGN KEY ("attivita_id") REFERENCES "attivita"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attivita_stato_log" ADD CONSTRAINT "attivita_stato_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed idempotente: 5 fasi Presale di default (colonne della board).
-- escludi_da_conteggio=true così le giornate in trattativa non entrano nei totali.
-- ON CONFLICT (chiave) DO NOTHING: sicuro se uno stato con quella chiave esiste già.
INSERT INTO "stato_attivita_config"
  ("id", "chiave", "label", "colore", "is_archiviato", "escludi_da_conteggio", "is_presale", "ordine", "created_at", "updated_at")
VALUES
  ('stato_presale_apertura',     'PRESALE_APERTURA',     'Analisi iniziale',       '#3B82F6', false, true, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('stato_presale_presa_carico', 'PRESALE_PRESA_CARICO', 'Presa in carico',        '#0D9488', false, true, true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('stato_presale_stima',        'PRESALE_STIMA',        'Stima',                  '#8B5CF6', false, true, true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('stato_presale_giornate',     'PRESALE_GIORNATE',     'Trattativa con cliente', '#F59E0B', false, true, true, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('stato_presale_conferma',     'PRESALE_CONFERMA',     'Conferma',               '#22C55E', false, true, true, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("chiave") DO NOTHING;
