-- Ordini bucket su 0..N progetti.
--
-- Un ordine bucket (riga `attivita` con tipo = 'BUCKET') è capienza a livello
-- CLIENTE: i consuntivi Zoho si agganciano al suo codice ordine di vendita e la
-- copertura delle attività standard è validata sul solo cliente. Il progetto,
-- finora obbligatorio e singolo, diventa un'etichetta descrittiva ripetibile.
--
-- Migrazione data-preserving: il progetto già presente su ogni bucket viene
-- travasato nella join, quindi sganciato dalla colonna singola (che resta in
-- uso, invariata, per le righe STANDARD).

CREATE TABLE IF NOT EXISTS "attivita_progetti" (
  "attivita_id" TEXT NOT NULL,
  "progetto_id" TEXT NOT NULL,

  CONSTRAINT "attivita_progetti_pkey" PRIMARY KEY ("attivita_id", "progetto_id")
);

CREATE INDEX IF NOT EXISTS "attivita_progetti_progetto_id_idx"
  ON "attivita_progetti"("progetto_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attivita_progetti_attivita_id_fkey'
  ) THEN
    ALTER TABLE "attivita_progetti"
      ADD CONSTRAINT "attivita_progetti_attivita_id_fkey"
      FOREIGN KEY ("attivita_id") REFERENCES "attivita"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attivita_progetti_progetto_id_fkey'
  ) THEN
    ALTER TABLE "attivita_progetti"
      ADD CONSTRAINT "attivita_progetti_progetto_id_fkey"
      FOREIGN KEY ("progetto_id") REFERENCES "progetti"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill: il progetto singolo dei bucket esistenti diventa la prima (e per
-- ora unica) riga della join. Idempotente.
INSERT INTO "attivita_progetti" ("attivita_id", "progetto_id")
SELECT "id", "progetto_id"
FROM "attivita"
WHERE "tipo" = 'BUCKET' AND "progetto_id" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Travasato il dato, sui bucket la colonna singola non è più la fonte di
-- verità: si azzera per evitare due sorgenti divergenti. `progetto` (nome
-- denormalizzato) è NOT NULL, quindi si svuota invece di annullarlo.
UPDATE "attivita"
SET "progetto_id" = NULL, "progetto" = ''
WHERE "tipo" = 'BUCKET';
