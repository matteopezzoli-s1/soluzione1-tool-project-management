-- Convert Attivita.stato from enum to TEXT (drop default first to remove enum dependency)
ALTER TABLE "attivita" ALTER COLUMN "stato" DROP DEFAULT;
ALTER TABLE "attivita" ALTER COLUMN "stato" TYPE TEXT USING "stato"::TEXT;
ALTER TABLE "attivita" ALTER COLUMN "stato" SET DEFAULT 'IN_CORSO';

-- Convert Progetto.stato from enum to TEXT
ALTER TABLE "progetti" ALTER COLUMN "stato" DROP DEFAULT;
ALTER TABLE "progetti" ALTER COLUMN "stato" TYPE TEXT USING "stato"::TEXT;
ALTER TABLE "progetti" ALTER COLUMN "stato" SET DEFAULT 'ATTIVO';

-- Drop old enum types
DROP TYPE IF EXISTS "StatoAttivita";
DROP TYPE IF EXISTS "StatoProgetto";

-- Create stato_attivita_config table
CREATE TABLE "stato_attivita_config" (
    "id"           TEXT        NOT NULL,
    "chiave"       TEXT        NOT NULL,
    "label"        TEXT        NOT NULL,
    "colore"       TEXT        NOT NULL DEFAULT '#94a3b8',
    "is_archiviato" BOOLEAN    NOT NULL DEFAULT false,
    "ordine"       INTEGER     NOT NULL DEFAULT 0,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stato_attivita_config_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stato_attivita_config_chiave_key" ON "stato_attivita_config"("chiave");

-- Create stato_progetto_config table
CREATE TABLE "stato_progetto_config" (
    "id"           TEXT        NOT NULL,
    "chiave"       TEXT        NOT NULL,
    "label"        TEXT        NOT NULL,
    "colore"       TEXT        NOT NULL DEFAULT '#94a3b8',
    "is_archiviato" BOOLEAN    NOT NULL DEFAULT false,
    "ordine"       INTEGER     NOT NULL DEFAULT 0,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stato_progetto_config_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stato_progetto_config_chiave_key" ON "stato_progetto_config"("chiave");

-- Seed default stati attività
INSERT INTO "stato_attivita_config" ("id", "chiave", "label", "colore", "is_archiviato", "ordine", "updated_at") VALUES
('sac_in_corso',        'IN_CORSO',        'In corso',        '#3b82f6', false, 1, CURRENT_TIMESTAMP),
('sac_da_iniziare',     'DA_INIZIARE',     'Da iniziare',     '#94a3b8', false, 2, CURRENT_TIMESTAMP),
('sac_in_approvazione', 'IN_APPROVAZIONE', 'In approvazione', '#f59e0b', false, 3, CURRENT_TIMESTAMP),
('sac_analisi',         'ANALISI',         'Analisi',         '#8b5cf6', false, 4, CURRENT_TIMESTAMP),
('sac_fermi',           'FERMI',           'Fermi',           '#ef4444', false, 5, CURRENT_TIMESTAMP),
('sac_completato',      'COMPLETATO',      'Completato',      '#10b981', true,  6, CURRENT_TIMESTAMP),
('sac_rifiutato',       'RIFIUTATO',       'Rifiutato',       '#6b7280', true,  7, CURRENT_TIMESTAMP);

-- Seed default stati progetto
INSERT INTO "stato_progetto_config" ("id", "chiave", "label", "colore", "is_archiviato", "ordine", "updated_at") VALUES
('spc_attivo',     'ATTIVO',     'Attivo',     '#10b981', false, 1, CURRENT_TIMESTAMP),
('spc_in_pausa',   'IN_PAUSA',   'In pausa',   '#f59e0b', false, 2, CURRENT_TIMESTAMP),
('spc_completato', 'COMPLETATO', 'Completato', '#3b82f6', true,  3, CURRENT_TIMESTAMP),
('spc_annullato',  'ANNULLATO',  'Annullato',  '#ef4444', true,  4, CURRENT_TIMESTAMP);
