-- PM singolo per attività: da tabella di join AttivitaPM (many-to-many) a FK
-- diretta pm_id su attivita. I dati esistenti hanno al massimo un PM per
-- attività, quindi il backfill è 1:1 (LIMIT 1 difensivo).

-- 1. Nuova colonna FK
ALTER TABLE "attivita" ADD COLUMN "pm_id" TEXT;

-- 2. Backfill dal join table (il PM assegnato, se presente)
UPDATE "attivita" a
SET "pm_id" = (
  SELECT ap."pm_id" FROM "attivita_pms" ap WHERE ap."attivita_id" = a."id" LIMIT 1
);

-- 3. Vincolo FK + indice
ALTER TABLE "attivita" ADD CONSTRAINT "attivita_pm_id_fkey"
  FOREIGN KEY ("pm_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "attivita_pm_id_idx" ON "attivita"("pm_id");

-- 4. Via la tabella di join
DROP TABLE "attivita_pms";
