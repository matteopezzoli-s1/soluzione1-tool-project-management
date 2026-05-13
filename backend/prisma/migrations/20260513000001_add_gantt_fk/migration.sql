-- Drop redundant denormalized columns
ALTER TABLE "attivita" DROP COLUMN IF EXISTS "risorse_coinvolte";
ALTER TABLE "attivita" DROP COLUMN IF EXISTS "account";
ALTER TABLE "attivita" DROP COLUMN IF EXISTS "project_manager";

-- Add FK columns to attivita
ALTER TABLE "attivita"
  ADD COLUMN IF NOT EXISTS "cliente_id"  TEXT,
  ADD COLUMN IF NOT EXISTS "progetto_id" TEXT,
  ADD COLUMN IF NOT EXISTS "account_id"  TEXT;

-- FK constraints
ALTER TABLE "attivita"
  ADD CONSTRAINT "attivita_cliente_id_fkey"
    FOREIGN KEY ("cliente_id")  REFERENCES "clienti"("id")  ON DELETE SET NULL;

ALTER TABLE "attivita"
  ADD CONSTRAINT "attivita_progetto_id_fkey"
    FOREIGN KEY ("progetto_id") REFERENCES "progetti"("id") ON DELETE SET NULL;

ALTER TABLE "attivita"
  ADD CONSTRAINT "attivita_account_id_fkey"
    FOREIGN KEY ("account_id")  REFERENCES "accounts"("id") ON DELETE SET NULL;

-- Indexes on new FK columns
CREATE INDEX IF NOT EXISTS "attivita_cliente_id_idx"  ON "attivita"("cliente_id");
CREATE INDEX IF NOT EXISTS "attivita_progetto_id_idx" ON "attivita"("progetto_id");
CREATE INDEX IF NOT EXISTS "attivita_account_id_idx"  ON "attivita"("account_id");

-- attivita_pms junction table
CREATE TABLE IF NOT EXISTS "attivita_pms" (
    "attivita_id" TEXT NOT NULL,
    "pm_id"       TEXT NOT NULL,
    CONSTRAINT "attivita_pms_pkey" PRIMARY KEY ("attivita_id", "pm_id"),
    CONSTRAINT "attivita_pms_attivita_id_fkey"
        FOREIGN KEY ("attivita_id") REFERENCES "attivita"("id")         ON DELETE CASCADE,
    CONSTRAINT "attivita_pms_pm_id_fkey"
        FOREIGN KEY ("pm_id")       REFERENCES "project_managers"("id") ON DELETE CASCADE
);

-- gantt_milestones table
CREATE TABLE IF NOT EXISTS "gantt_milestones" (
    "id"          TEXT         NOT NULL,
    "activity_id" TEXT         NOT NULL,
    "title"       TEXT         NOT NULL,
    "date"        TIMESTAMP(3) NOT NULL,
    "color"       TEXT         NOT NULL DEFAULT '#F59E0B',
    "icon"        TEXT,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gantt_milestones_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "gantt_milestones_activity_id_fkey"
        FOREIGN KEY ("activity_id") REFERENCES "attivita"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "gantt_milestones_activity_id_idx" ON "gantt_milestones"("activity_id");
