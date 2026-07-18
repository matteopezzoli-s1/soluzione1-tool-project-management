-- Registro contratti assistenza/AMS: migration mancante della feature
-- (in locale lo schema era arrivato via `prisma db push`, in produzione
-- `migrate deploy` non aveva nulla da applicare → tabelle assenti e
-- GET /api/contratti in errore). Additiva.
-- NB: include il seed degli stati contratto (in produzione il seed Prisma
-- non gira — stesso pattern della migration SAIOT).

-- CreateEnum
CREATE TYPE "TipoContratto" AS ENUM ('MANUTENZIONE', 'MANUTENZIONE_AMS');

-- AlterTable: allinea app_config allo schema Prisma (updatedAt gestito dal
-- client, il DEFAULT del DB non serve più)
ALTER TABLE "app_config" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "contratti" (
    "id" TEXT NOT NULL,
    "titolo" TEXT NOT NULL,
    "tipo" "TipoContratto" NOT NULL DEFAULT 'MANUTENZIONE',
    "anno" INTEGER NOT NULL,
    "stato" TEXT NOT NULL DEFAULT 'IN_DEFINIZIONE',
    "data_inizio" TIMESTAMP(3),
    "data_fine" TIMESTAMP(3),
    "rinnovo_tacito" BOOLEAN NOT NULL DEFAULT false,
    "disdetta_entro" TIMESTAMP(3),
    "importo_totale" DECIMAL(12,2),
    "fatturato" BOOLEAN NOT NULL DEFAULT false,
    "riferimento_ordine_vendita" TEXT,
    "giornate_consuntivate" DECIMAL(10,2),
    "drive_url" TEXT,
    "drive_folder_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "cliente_id" TEXT NOT NULL,

    CONSTRAINT "contratti_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contratto_applicazioni" (
    "contratto_id" TEXT NOT NULL,
    "progetto_id" TEXT NOT NULL,

    CONSTRAINT "contratto_applicazioni_pkey" PRIMARY KEY ("contratto_id","progetto_id")
);

-- CreateTable
CREATE TABLE "stato_contratto_config" (
    "id" TEXT NOT NULL,
    "chiave" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "colore" TEXT NOT NULL DEFAULT '#94a3b8',
    "is_chiuso" BOOLEAN NOT NULL DEFAULT false,
    "ordine" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stato_contratto_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contratti_cliente_id_idx" ON "contratti"("cliente_id");

-- CreateIndex
CREATE INDEX "contratti_anno_idx" ON "contratti"("anno");

-- CreateIndex
CREATE INDEX "contratti_stato_idx" ON "contratti"("stato");

-- CreateIndex
CREATE UNIQUE INDEX "stato_contratto_config_chiave_key" ON "stato_contratto_config"("chiave");

-- AddForeignKey
ALTER TABLE "contratti" ADD CONSTRAINT "contratti_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clienti"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratto_applicazioni" ADD CONSTRAINT "contratto_applicazioni_contratto_id_fkey" FOREIGN KEY ("contratto_id") REFERENCES "contratti"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratto_applicazioni" ADD CONSTRAINT "contratto_applicazioni_progetto_id_fkey" FOREIGN KEY ("progetto_id") REFERENCES "progetti"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed idempotente degli stati contratto (stessi valori del seed locale).
-- ON CONFLICT DO NOTHING: sicuro alle riesecuzioni e non sovrascrive
-- modifiche fatte da Impostazioni → stati contratto.
INSERT INTO "stato_contratto_config" ("id", "chiave", "label", "colore", "is_chiuso", "ordine", "updated_at") VALUES
  ('stato-contratto-in-definizione', 'IN_DEFINIZIONE', 'In via di definizione',         '#F59E0B', false, 1, CURRENT_TIMESTAMP),
  ('stato-contratto-ok',             'OK',             'OK, a posto',                   '#10B981', false, 2, CURRENT_TIMESTAMP),
  ('stato-contratto-con-problemi',   'CON_PROBLEMI',   'Con problemi, da attenzionare', '#EF4444', false, 3, CURRENT_TIMESTAMP),
  ('stato-contratto-chiuso',         'CHIUSO',         'Chiuso',                        '#94A3B8', true,  4, CURRENT_TIMESTAMP)
ON CONFLICT ("chiave") DO NOTHING;
