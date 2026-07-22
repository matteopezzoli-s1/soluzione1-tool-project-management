-- Progetto: rimozione del periodo (data inizio/fine, non più in anagrafica)
-- e aggiunta dell'archiviazione (flag + timestamp). Il DROP è definitivo.

ALTER TABLE "progetti" DROP COLUMN IF EXISTS "data_inizio";
ALTER TABLE "progetti" DROP COLUMN IF EXISTS "data_fine";

ALTER TABLE "progetti" ADD COLUMN IF NOT EXISTS "archiviato" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "progetti" ADD COLUMN IF NOT EXISTS "archiviato_at" TIMESTAMP(3);
