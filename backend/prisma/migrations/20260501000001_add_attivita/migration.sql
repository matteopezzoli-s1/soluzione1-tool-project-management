-- CreateEnum
CREATE TYPE "StatoAttivita" AS ENUM ('IN_CORSO', 'COMPLETATO', 'DA_INIZIARE', 'IN_APPROVAZIONE', 'ANALISI', 'FERMI', 'RIFIUTATO');

-- CreateTable
CREATE TABLE "attivita" (
    "id" TEXT NOT NULL,
    "cliente" TEXT NOT NULL,
    "progetto" TEXT NOT NULL,
    "attivita" TEXT NOT NULL,
    "risorse_coinvolte" TEXT NOT NULL DEFAULT '',
    "account" TEXT NOT NULL DEFAULT '',
    "project_manager" TEXT NOT NULL DEFAULT '',
    "giornate_vendute" DECIMAL(10,2),
    "giornate_consuntivate" DECIMAL(10,2),
    "riferimento_ordine_vendita" TEXT,
    "stato" "StatoAttivita" NOT NULL DEFAULT 'IN_CORSO',
    "inizio" TIMESTAMP(3),
    "deadline" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attivita_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attivita_cliente_progetto_idx" ON "attivita"("cliente", "progetto");

-- CreateIndex
CREATE INDEX "attivita_stato_idx" ON "attivita"("stato");
