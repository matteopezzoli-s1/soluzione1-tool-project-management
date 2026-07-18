-- Rimozione di "disdetta entro" dai contratti assistenza/AMS: il banner
-- scadenze (finestra 60 giorni) resta alimentato dalla sola dataFine.

-- AlterTable
ALTER TABLE "contratti" DROP COLUMN "disdetta_entro";
