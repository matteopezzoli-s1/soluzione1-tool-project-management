-- Seed binding cartelle Google Drive → clienti/progetti/prodotti (mappatura
-- validata 2026-07-22). Idempotente: match per nome canonico, ri-eseguibile.
-- NB: solo scrittura di ID cartella su TPM. NON tocca nulla su Drive.
BEGIN;

-- ── Ancore di creazione cartelle (AppConfig) ────────────────────────────────
INSERT INTO app_config (chiave, valore, updated_at) VALUES
  ('gdrive_gestione_url', 'https://drive.google.com/drive/folders/1gf39JNO9ZKhuKvzYyullA42F0b0zjp9G', now()),
  ('gdrive_gestione_id',  '1gf39JNO9ZKhuKvzYyullA42F0b0zjp9G', now()),
  ('gdrive_prodotti_url', 'https://drive.google.com/drive/folders/1MMHhEyx0KMgAdqrFmXfbHRhMGEk_E7yW', now()),
  ('gdrive_prodotti_id',  '1MMHhEyx0KMgAdqrFmXfbHRhMGEk_E7yW', now())
ON CONFLICT (chiave) DO UPDATE SET valore = EXCLUDED.valore, updated_at = now();

-- ── Cartelle cliente (Cliente.drive_folder_id) ──────────────────────────────
UPDATE clienti c SET drive_folder_id = v.fid,
  drive_folder_url = 'https://drive.google.com/drive/folders/' || v.fid, updated_at = now()
FROM (VALUES
  ('San Carlo','1Tpnv5pneTPGuJS2OvlwN6i-0_ilgjdPu'),
  ('Vimar','10WnUorRQRYY1axpjNCD-ZBNFm9CLESxt'),
  ('Tigros','1zPhNyntqcUU6uT-ottzLDzF8eauFzPCv'),
  ('Beltrame','1grHs_AmddvssZd8cWJ-6AOiG5tn878QR'),
  ('Beltrame GROUP','1xA1Neu6pGdvotd_fwmLwy5cUUsIKKcOx'),
  ('BMOVE','1cspXtlQAfwlqe2oLS4RyFCYbUTX14pn3'),
  ('Bloom&Bee','1_-X0cOHpvaBLdVrQFi5GkWeGA1X1JLnU'),
  ('Autoservizi Locatelli','1tzmM3GhrmHSNMFkYTyAN0ocHAO46RrwQ'),
  ('Milano Serravalle','1F2dH6mCMwHyzf6CDPBxG2SVv5M6Qp5V1'),
  ('Esselunga','1OiZ6OxaVTTkB5Z-BMwBaRCDCeOSo78Ea'),
  ('Digi','1UAKylO8xxl1qLx0x-jGoRGunr3fYeVGK'),
  ('Cisalfa','15Anu-pcYLbJshZsAqQTR0yf47jfeqCkQ'),
  ('Cellular Line','1pWdqt5fAElP5xO6ZMhfH5vBwfvtEG0cA'),
  ('Unicoop Firenze','1OCYpxTHSpRXj7mYCmsrasUl7a9aUG5N2'),
  ('Moncler','1YfLsnK0D5r7L02YxrNBWGjqOQBTVrMdU'),
  ('Unes','14PgjxgpXF_V25HOnNznblEDGZjVMb2u6'),
  ('Aquamore','1b5NZj7GsuY_0-Gk7y3csdh5WXRKcZ6L-'),
  ('Italtrans','1Kd6QrlzJHRdcJyThvakC3DOjTSJqsoQP'),
  ('Sacbo','1zIdkb60m08bAejevaScXy3o_DpaRR5ua'),
  ('Transmec','1uIWM9-p5mYM41FD00OFguqHJZiiCza5k'),
  ('ITS Move','1DOeZDpPoXg8IbWGZFR_HOCGblbCP7fGc'),
  ('Finiper','1ZaZi29tPA2QXGVtf-K8x2a4m6K1oqgHv'),
  ('Invidia Uomo','11b-PZjvYp0Goqhq-GKb1-YXVZ8A38Fy6'),
  ('Tobabo Salestrainer','1sk8ay4LUCuVjdpMtGpbDItQrHt0eSPaA'),
  ('Alltub','1wwh1rAHPWtF7T8pz3-DUUsN767zCEOiO'),
  ('Conai','1_vGT0LsPzskdPU9rtDqCAFQF1WH-YF2c'),
  ('ReMade','1rbbXOg-qEwJcMiWJNR6z4z1W9r6Kru_Z')
) AS v(nome, fid)
WHERE c.nome = v.nome;

-- ── Cartelle progetto: match esistenti (solo cartella, analisi = fallback) ───
UPDATE progetti p SET drive_folder_id = v.fid,
  drive_folder_url = 'https://drive.google.com/drive/folders/' || v.fid, updated_at = now()
FROM clienti c, (VALUES
  ('Moncler','MONCQ-Check','1YiarqM4OHNA4D8SnX0Sg-47Zp5CQEq-r'),
  ('Tigros','Registrazione TigrosCard','1bqyaqPfuQ3A70OAcd4OGH902eRYuTC1d'),
  ('Tigros','Buoni univoci','1WIRqD5UrosUfnS80pcesY-oYKxhfzf92'),
  ('Tigros','Gift Card','1rAIj55u1XoufPLat6Ds06r51qjINT5Wq'),
  ('Tigros','GESCON','147mIVUSAjwApJDXPOBWC8dJTTqW8NAcc'),
  ('Unicoop Firenze','Ordini PDV','1McQ48M9Z739Bitj2EpH2TpJ1xE2RN92M'),
  ('Unes','ETLUTIL - Etichette Elettroniche','1DSysdgoIxMf-O93Gb42pK4Dj9vZYHnj9'),
  ('Esselunga','PESAPP / INVPES','1EiQyh6gOYZg_WNN0ELHfbcvgXH0HKXAK'),
  ('Esselunga','Riordino','1xCDQaAlLSSWtrZzg3bLIrr5aTUmyaX5A'),
  ('Digi','Smartscale','1bO7_wRHfAdbOnNBbPoLYMLStK9JrZTRZ'),
  ('San Carlo','App SM','1tSs-sYOBSPvstJzHqEizNNRCRhGi-Jjg'),
  ('San Carlo','App M5','19B-9N3F6nA2yXsiK-IuZNr9BFjxaZgK5'),
  ('San Carlo','App Prevendita','1ZvXwLcwyRyBmbKwottopViJJw8_N2oCl'),
  ('San Carlo','App MES','1MyiWTQjH-SSXLYgmQlOMPrLfDadLUdz7'),
  ('Milano Serravalle','CAUTO','1G42tjw8k_Y3ixvLzM0kIjZSTxc7-fpBu'),
  ('Vimar','Fisarmonica','1RD5CQ8dc3l4Dru41YxtSif2PsA2QS7mA'),
  ('Vimar','App By Track','1ruIzKa4N81DHoW1nStGK1abFPwrvevp0'),
  ('Vimar','MES Light','1Oo4JNqh-kMRkXG0B9wguNCEbibZCkVwo'),
  ('Vimar','Pesa','10injY8W8JJ-oioEroRHDu8R1YAvzqKiY'),
  ('Vimar','App Documentale RPE','110mDj0eSDakY8sE3gkexIhZsUHHHs_Mb'),
  ('Vimar','App Articoli Speciali','1H-eg45rcZNl0GNnTq43sXIjMXYRD2-Mm'),
  ('Aquamore','Gestionale','14rMNFwkyJZQfTZUQCMtU2jd0CXIwuYGw'),
  ('Finiper','App Backoffice','11dIrUoZ0HoOmREpA-C52dKaWs1GExOIK'),
  ('Cellular Line','Gestione resi','1wSS9rvD5y0sdg9K-jse-LcFkHNDZbF92')
) AS v(cliente, progetto, fid)
WHERE p.cliente_id = c.id AND c.nome = v.cliente AND p.nome = v.progetto;

-- ── Cartelle progetto: create con alberatura (cartella + Analisi Requisiti) ──
UPDATE progetti p SET drive_folder_id = v.fid,
  drive_folder_url = 'https://drive.google.com/drive/folders/' || v.fid,
  drive_analisi_folder_id = v.aid, updated_at = now()
FROM clienti c, (VALUES
  ('Alltub','MPS','1ea4fr579sM26QBcIigBYju9UEpSZyPUr','1wwEVCTgngrVKT1cqkJ3Gt2BqGlzVHmDV'),
  ('Cisalfa','A4R','1EzdKCGdQ4cDTQul9WmTOiS3q_v-VUgP2','13_9V5-8XU8wW31OiE9A_arcyi5uUAXZi'),
  ('Conai','2FA','1J8USFVyDbfC7qGKYeA9hXRUETEz0q3RJ','1O0eZA9_x5-vdwHXdcig5piYXe5ZBeghz'),
  ('Conai','Vulnerabilità','1J06HIGvGpeYa7R0nqLNaaFTA8cYdpWwe','1q881iYVC8BXzWb92yEfIiJxLAlyKd9Wn'),
  ('Sacbo','MP','1t4x6P6YRg2pJqpE1RZhLACXK6HMfi24Y','1OHqlD0IR_uKXzIBMbjuXgFQ2-1iN-5xg'),
  ('ITS Move','ITS Move','1rEbagxfHP2iGXFRIjF2ACU7L3D-zfGfm','1JVxs_eAta7aJ38EoNSPRxZRO3PdXSRXl'),
  ('Invidia Uomo','IWR - Invidia web retail','1G6ulgCR0BFB4K6WWP7gznD2b4yCPgeCs','1q5n6A0PiTLWNShH2dukSvCi2kYUiNBdN'),
  ('Italtrans','Doc Flow Manager','1kf2zp99q6ue0z-NHsfgNdCuZiZPw3KR9','1gifFZG7czoSi-c6TEiJQBUBtJOBaG523'),
  ('Transmec','Progetto listini','1g3IUX2BHJK39qNWvAkS2BR3icGP5oqeG','1tn0wvd9sQgyb1KUisolo57mHk1R2mbrt'),
  ('Tobabo Salestrainer','Palestre','1Tn95ncrMKWT06tPxe72LBFh5dviYHEe_','16DpY5M55bJtdYIa6IUk9sB4N-qZCS3Zb'),
  ('Vimar','Body Rental - Mondo MES','170fgtwZbCw1LpYzJbseV6iWJZMYdzbI9','1IXZxxOSngnSE9orY5QSNSL52HHOI43W-'),
  ('BMOVE','BMOVE','19Uhj6a_MBy3i_YAtGEX4usi8tgARTgZw','1veBMVxnK_WsA0bwLEuXKtwbvKaQmlHQ4'),
  ('Autoservizi Locatelli','Bonus Trasporti','1jhDEAn6-q484vFWUw_9VaulC6YtSGBZI','1wWgzRaQBdDSiTvlpOZo7Kfy1IL7Q3XzI'),
  ('Autoservizi Locatelli','Conta passeggeri','1k83sQnSOKQoIpOnDQGuRAZTiRhtMHaOY','16CTBtBkxorTw9r9dJ2Flr_HSqjbZBCK2'),
  ('Autoservizi Locatelli','E-Commerce rinnovo abbonamenti','1EgMFnKtldRw58DCpdiRqD8tCRLqiAVjN','1nTK4-yGfKClTz5rwx6ejhC12M_JBylwE'),
  ('Autoservizi Locatelli','Turnazione autisti','1ddPNeXhpbBr0ZD55VkbN1wGrg4p7cOQs','1adJdUEsilVDoyuBdI9JAVQX5Kx7bjCei'),
  ('Beltrame GROUP','Gestionale Corsi','1MFcZzd4x8mti-asFV8Gn0ouLeou-GZCD','1QZKADwvPNaVyMsjqBX8pfduD81AScLiP'),
  ('Beltrame','Migrazione STG','1u9LTyexPLXySPMKnnIntDW4e273xaYQM','1cV2W0GrXsccO0VaS_YEUZFh2UzPGrqfp'),
  ('Beltrame','Modifiche portale Booking','1plyv7zyYT3r4T4uSNAYbAL_KPMB2axgI','1jPuQOF3fwa9ffMPHXrhYo3ymlmAqzc_y'),
  ('Beltrame','Secondo step di evolutive','1odzUOM5k5SRusWSmGzkglqDDEf-AfkXu','1GvQp1_f6phLAZtTZpDTBjfQ6ZzbYyliM'),
  ('Beltrame','Trasporeon','1_n5P4wq0tsVI9TNlYROzKtCpg2PPc0Ye','1voWv1-0S55Jft6bu3shik1iW657kcD3L'),
  ('Bloom&Bee','Portale gestione Manutenzione giardini','1tvZZr_XG3aejL9Fi-aMECVA_5Ft7zF1i','1ty5fdMUiHP6XgVG9FetUh_exTJV6sRPN')
) AS v(cliente, progetto, fid, aid)
WHERE p.cliente_id = c.id AND c.nome = v.cliente AND p.nome = v.progetto;

-- ── Prodotti (tipo PRODOTTO, senza cliente) ─────────────────────────────────
UPDATE progetti p SET drive_folder_id = v.fid,
  drive_folder_url = 'https://drive.google.com/drive/folders/' || v.fid,
  drive_analisi_folder_id = NULLIF(v.aid, ''), updated_at = now()
FROM (VALUES
  ('Smartilio','1VBnM5wcqKK23Ydexlhl_i-dh2Zo_9Qss',''),
  ('Praticko','161FPAbNcRFH9b4T5_Rdln_3fM9ZqgDUO',''),
  ('Servicepay','1jCu_YIlDqWzymPaiEwm2OJjlz5mRwPYA','1Pta5pGsWVLI8Hy1SqP6qsnOQQrbfqVw9')
) AS v(nome, fid, aid)
WHERE p.tipo = 'PRODOTTO' AND p.nome = v.nome;

COMMIT;
