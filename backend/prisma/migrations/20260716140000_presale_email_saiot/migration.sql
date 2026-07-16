-- Notifiche Presale via SAIOT: config key-value + tracking fasi già notificate.
-- Additivo. NB: in locale si usa `prisma db push` (non esegue questi INSERT) e i
-- default arrivano dal seed; in produzione `migrate deploy` esegue tutto, con
-- l'URL dell'ambiente di produzione.

-- AlterTable: fasi per cui la mail è già partita (dedup anti-doppioni)
ALTER TABLE "attivita" ADD COLUMN "presale_email_fasi_inviate" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateTable: configurazione applicativa key-value
CREATE TABLE "app_config" (
    "chiave" TEXT NOT NULL,
    "valore" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_config_pkey" PRIMARY KEY ("chiave")
);

-- Seed idempotente dei parametri SAIOT (valori di PRODUZIONE).
-- ON CONFLICT DO NOTHING: sicuro alle riesecuzioni e non sovrascrive modifiche
-- fatte dalla schermata Impostazioni.
INSERT INTO "app_config" ("chiave", "valore", "updated_at") VALUES
  ('saiot_url',             'https://api.saiot.it/saiot-rest/rest/events/express', CURRENT_TIMESTAMP),
  ('saiot_context_code',    'cc32fdbaad23866c91078445595096d6',                    CURRENT_TIMESTAMP),
  ('saiot_sender_code',     'e7478375a40f42043a00ed2d182019b9',                    CURRENT_TIMESTAMP),
  ('saiot_event_name',      'tpm',                                                 CURRENT_TIMESTAMP),
  ('presale_devhub_email',  'matteo.pezzoli@gmail.com',                            CURRENT_TIMESTAMP),
  ('presale_email_enabled', 'true',                                               CURRENT_TIMESTAMP)
ON CONFLICT ("chiave") DO NOTHING;
