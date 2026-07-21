-- Prodotti interni: un'attività può nascere dalla roadmap (seme 1:1). Aggiunge
-- l'economia sull'item roadmap (copertura assorbita/co-investimento, cliente
-- pagante, giornate vendute a carico cliente, ordine di vendita) e sull'attività
-- le giornate di investimento a carico nostro + il link al seme roadmap.
-- Include la dismissione dello stato roadmap STANDBY (item -> BACKLOG) e il
-- flag isCompletato sullo stato terminale. Additiva; le UPDATE/DELETE sui dati
-- sono no-op se gli stati non esistono (roadmap states = dati, non seed).

-- AlterTable
ALTER TABLE "attivita" ADD COLUMN     "giornate_investimento" DECIMAL(10,2),
ADD COLUMN     "roadmap_item_id" TEXT;

-- AlterTable
ALTER TABLE "roadmap_items" ADD COLUMN     "cliente_pagante_id" TEXT,
ADD COLUMN     "copertura" TEXT NOT NULL DEFAULT 'ASSORBITA',
ADD COLUMN     "giornate_vendute" DECIMAL(10,2),
ADD COLUMN     "riferimento_ordine_vendita" TEXT;

-- AlterTable
ALTER TABLE "stato_roadmap_config" ADD COLUMN     "is_completato" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "attivita_roadmap_item_id_key" ON "attivita"("roadmap_item_id");

-- AddForeignKey
ALTER TABLE "attivita" ADD CONSTRAINT "attivita_roadmap_item_id_fkey" FOREIGN KEY ("roadmap_item_id") REFERENCES "roadmap_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roadmap_items" ADD CONSTRAINT "roadmap_items_cliente_pagante_id_fkey" FOREIGN KEY ("cliente_pagante_id") REFERENCES "clienti"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Dismissione dello stato STANDBY: gli item parcheggiati tornano in BACKLOG.
UPDATE "roadmap_items" SET "stato" = 'BACKLOG' WHERE "stato" = 'STANDBY';
DELETE FROM "stato_roadmap_config" WHERE "chiave" = 'STANDBY';

-- Stato terminale "completato": alimentato dalla chiusura dell'attività collegata.
UPDATE "stato_roadmap_config" SET "is_completato" = true WHERE "chiave" = 'COMPLETATO';
