-- ============================================================
-- Migrazione dati: ProjectManager + Account -> users (con ruoli)
-- Atomica (un solo blocco DO = una sola transazione implicita),
-- idempotente (guard su _backup_project_managers), con backup.
-- ============================================================

DO $migration$
DECLARE
  backup_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = '_backup_project_managers'
  ) INTO backup_exists;

  IF backup_exists THEN
    RAISE NOTICE 'Migrazione utenti gia eseguita (trovata _backup_project_managers) - skip.';
    RETURN;
  END IF;

  RAISE NOTICE 'Avvio migrazione dati PM/Account -> users...';

  -- ── 1) Backup (prima di qualsiasi mutazione) ─────────────────
  CREATE TABLE _backup_project_managers AS SELECT * FROM project_managers;
  CREATE TABLE _backup_accounts         AS SELECT * FROM accounts;
  CREATE TABLE _backup_attivita_pms     AS SELECT * FROM attivita_pms;
  CREATE TABLE _backup_progetti_fk      AS SELECT id, po_id FROM progetti;
  CREATE TABLE _backup_clienti_fk       AS SELECT id, account_id FROM clienti;
  CREATE TABLE _backup_attivita_fk      AS SELECT id, account_id FROM attivita;

  -- ── 2) Drop vincoli FK verso le vecchie tabelle ──────────────
  ALTER TABLE progetti     DROP CONSTRAINT progetti_po_id_fkey;
  ALTER TABLE attivita_pms DROP CONSTRAINT attivita_pms_pm_id_fkey;
  ALTER TABLE clienti      DROP CONSTRAINT clienti_account_id_fkey;
  ALTER TABLE attivita     DROP CONSTRAINT attivita_account_id_fkey;

  -- ── 3) Mapping id-legacy -> id-utente-finale ─────────────────
  -- pm_target: riusa id del PM, salvo che esista gia' uno user con la stessa email
  -- (utente pre-esistente, es. da login OAuth futuro o seed) -> in quel caso vince
  -- l'id dello user esistente (upsert per email, come richiesto se `users` non e' vuota).
  CREATE TEMP TABLE _pm_target ON COMMIT DROP AS
  SELECT
    pm.id    AS pm_id,
    pm.first_name,
    pm.last_name,
    pm.email,
    COALESCE(
      (SELECT u.id FROM users u WHERE pm.email IS NOT NULL AND u.email = pm.email),
      pm.id
    ) AS target_user_id
  FROM project_managers pm;

  -- acct_target: se l'email combacia con un PM -> vince l'id del PM (merge PM+Account).
  -- Altrimenti se combacia con uno user pre-esistente -> vince quello. Altrimenti id legacy Account.
  CREATE TEMP TABLE _acct_target ON COMMIT DROP AS
  SELECT
    a.id     AS acct_id,
    a.first_name,
    a.last_name,
    a.email,
    COALESCE(
      (SELECT pt.target_user_id FROM _pm_target pt WHERE a.email IS NOT NULL AND pt.email = a.email),
      (SELECT u.id FROM users u WHERE a.email IS NOT NULL AND u.email = a.email),
      a.id
    ) AS target_user_id
  FROM accounts a;

  -- ── 4) Crea/aggiorna gli utenti ──────────────────────────────

  -- 4a. PM -> nuova riga users (nessun merge)
  INSERT INTO users (id, first_name, last_name, email, roles, created_at, updated_at)
  SELECT pt.pm_id, pt.first_name, pt.last_name, pt.email, ARRAY['PM']::"UserRole"[], now(), now()
  FROM _pm_target pt
  WHERE pt.target_user_id = pt.pm_id
  ON CONFLICT (id) DO NOTHING;

  -- 4b. PM il cui email combacia con uno user gia' esistente -> aggiungi ruolo PM (merge)
  UPDATE users u
  SET roles      = (SELECT array_agg(DISTINCT r) FROM unnest(u.roles || ARRAY['PM']::"UserRole"[]) r),
      first_name = COALESCE(u.first_name, pt.first_name),
      last_name  = COALESCE(u.last_name, pt.last_name)
  FROM _pm_target pt
  WHERE pt.target_user_id <> pt.pm_id AND u.id = pt.target_user_id;

  -- 4c. Account -> nuova riga users (nessun merge)
  INSERT INTO users (id, first_name, last_name, email, roles, created_at, updated_at)
  SELECT at.acct_id, at.first_name, at.last_name, at.email, ARRAY['ACCOUNT']::"UserRole"[], now(), now()
  FROM _acct_target at
  WHERE at.target_user_id = at.acct_id
  ON CONFLICT (id) DO NOTHING;

  -- 4d. Account il cui email combacia con un PM o uno user esistente -> aggiungi ruolo ACCOUNT (merge)
  UPDATE users u
  SET roles      = (SELECT array_agg(DISTINCT r) FROM unnest(u.roles || ARRAY['ACCOUNT']::"UserRole"[]) r),
      first_name = COALESCE(u.first_name, at.first_name),
      last_name  = COALESCE(u.last_name, at.last_name)
  FROM _acct_target at
  WHERE at.target_user_id <> at.acct_id AND u.id = at.target_user_id;

  -- ── 5) Ripunta le FK secondo il mapping (solo dove il target e' cambiato) ──
  UPDATE attivita_pms ap
  SET pm_id = pt.target_user_id
  FROM _pm_target pt
  WHERE ap.pm_id = pt.pm_id AND pt.target_user_id <> pt.pm_id;

  UPDATE progetti p
  SET po_id = pt.target_user_id
  FROM _pm_target pt
  WHERE p.po_id = pt.pm_id AND pt.target_user_id <> pt.pm_id;

  UPDATE clienti c
  SET account_id = at.target_user_id
  FROM _acct_target at
  WHERE c.account_id = at.acct_id AND at.target_user_id <> at.acct_id;

  UPDATE attivita t
  SET account_id = at.target_user_id
  FROM _acct_target at
  WHERE t.account_id = at.acct_id AND at.target_user_id <> at.acct_id;

  -- ── 6) Nuovi vincoli FK verso users ───────────────────────────
  ALTER TABLE progetti     ADD CONSTRAINT progetti_po_id_fkey
    FOREIGN KEY (po_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE attivita_pms ADD CONSTRAINT attivita_pms_pm_id_fkey
    FOREIGN KEY (pm_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE clienti      ADD CONSTRAINT clienti_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE attivita     ADD CONSTRAINT attivita_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;

  -- ── 7) Drop tabelle legacy (attivita_pms resta: cambia solo la FK) ──
  DROP TABLE project_managers;
  DROP TABLE accounts;

  -- ── 8) Verifica dati (solleva eccezione = rollback totale) ────
  IF (SELECT count(*) FROM users WHERE 'PM' = ANY(roles))
     < (SELECT count(DISTINCT target_user_id) FROM _pm_target) THEN
    RAISE EXCEPTION 'Verifica fallita: utenti con ruolo PM insufficienti rispetto ai PM di origine';
  END IF;

  IF (SELECT count(*) FROM users WHERE 'ACCOUNT' = ANY(roles))
     < (SELECT count(DISTINCT target_user_id) FROM _acct_target) THEN
    RAISE EXCEPTION 'Verifica fallita: utenti con ruolo ACCOUNT insufficienti rispetto agli Account di origine';
  END IF;

  IF EXISTS (
    SELECT 1 FROM progetti p
    WHERE p.po_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.po_id)
  ) THEN
    RAISE EXCEPTION 'Verifica fallita: FK orfana su progetti.po_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM progetti p
    WHERE p.responsabile_dev_hub_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.responsabile_dev_hub_id)
  ) THEN
    RAISE EXCEPTION 'Verifica fallita: FK orfana su progetti.responsabile_dev_hub_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM attivita_pms ap
    WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ap.pm_id)
  ) THEN
    RAISE EXCEPTION 'Verifica fallita: FK orfana su attivita_pms.pm_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM clienti c
    WHERE c.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.account_id)
  ) THEN
    RAISE EXCEPTION 'Verifica fallita: FK orfana su clienti.account_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM attivita t
    WHERE t.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.account_id)
  ) THEN
    RAISE EXCEPTION 'Verifica fallita: FK orfana su attivita.account_id';
  END IF;

  IF (SELECT count(*) FROM attivita_pms) <> (SELECT count(*) FROM _backup_attivita_pms) THEN
    RAISE EXCEPTION 'Verifica fallita: righe attivita_pms perse durante la migrazione (join table alterata)';
  END IF;

  RAISE NOTICE 'Migrazione dati PM/Account -> users completata con successo.';
END;
$migration$;
