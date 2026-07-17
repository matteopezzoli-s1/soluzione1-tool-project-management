-- Dettaglio mensile delle attività (ordini bucket): giornate consuntivate per
-- mese (alimentate dall'import Zoho) e giornate fatturate per mese (compilate
-- dal PM per il rapportino). Additivo.

-- CreateTable
CREATE TABLE "attivita_consuntivi_mese" (
    "id" TEXT NOT NULL,
    "attivita_id" TEXT NOT NULL,
    "mese" TEXT NOT NULL,
    "giornate_consuntivate" DECIMAL(10,2),
    "giornate_fatturate" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attivita_consuntivi_mese_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attivita_consuntivi_mese_attivita_id_mese_key" ON "attivita_consuntivi_mese"("attivita_id", "mese");

-- AddForeignKey
ALTER TABLE "attivita_consuntivi_mese" ADD CONSTRAINT "attivita_consuntivi_mese_attivita_id_fkey" FOREIGN KEY ("attivita_id") REFERENCES "attivita"("id") ON DELETE CASCADE ON UPDATE CASCADE;
