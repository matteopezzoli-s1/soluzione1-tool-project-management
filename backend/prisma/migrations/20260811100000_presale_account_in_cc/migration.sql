-- Account di riferimento del cliente sempre in Cc alle mail di fase Presale,
-- con flag per escluderlo dalle Impostazioni. Solo config: nessun cambio di
-- schema. Se la chiave manca il backend legge 'true' (default), quindi questo
-- INSERT serve a rendere il valore visibile/editabile in Impostazioni.
INSERT INTO "app_config" ("chiave", "valore", "updated_at") VALUES
  ('presale_account_in_cc', 'true', CURRENT_TIMESTAMP)
ON CONFLICT ("chiave") DO NOTHING;
