-- Copertura bucket: un'attività STANDARD può essere coperta da un ordine
-- bucket (riga `attivita` con tipo = 'BUCKET') dello stesso cliente, invece di
-- avere un proprio riferimento ordine di vendita.
-- Self-relation nullable: alla cancellazione del bucket le attività coperte
-- restano e perdono solo la copertura (ON DELETE SET NULL).

ALTER TABLE "attivita" ADD COLUMN IF NOT EXISTS "bucket_id" TEXT;

CREATE INDEX IF NOT EXISTS "attivita_bucket_id_idx" ON "attivita"("bucket_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attivita_bucket_id_fkey'
  ) THEN
    ALTER TABLE "attivita"
      ADD CONSTRAINT "attivita_bucket_id_fkey"
      FOREIGN KEY ("bucket_id") REFERENCES "attivita"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
