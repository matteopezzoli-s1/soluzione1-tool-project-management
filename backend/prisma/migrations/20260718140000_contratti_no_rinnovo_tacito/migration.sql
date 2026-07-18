-- Rimozione del flag "rinnovo tacito" dai contratti assistenza/AMS: il
-- monitoraggio del rinnovo passa dalla sola data "disdetta entro" (che
-- resta e continua a concorrere al banner scadenze insieme a dataFine).

-- AlterTable
ALTER TABLE "contratti" DROP COLUMN "rinnovo_tacito";
