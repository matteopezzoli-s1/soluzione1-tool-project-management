-- CreateEnum
CREATE TYPE "StatoProgetto" AS ENUM ('ATTIVO', 'IN_PAUSA', 'COMPLETATO', 'ANNULLATO');

-- CreateTable
CREATE TABLE "clienti" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "referente" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clienti_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progetti" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descrizione" TEXT,
    "stato" "StatoProgetto" NOT NULL DEFAULT 'ATTIVO',
    "data_inizio" TIMESTAMP(3),
    "data_fine" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "cliente_id" TEXT,

    CONSTRAINT "progetti_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "progetti_cliente_id_idx" ON "progetti"("cliente_id");

-- AddForeignKey
ALTER TABLE "progetti" ADD CONSTRAINT "progetti_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clienti"("id") ON DELETE SET NULL ON UPDATE CASCADE;
