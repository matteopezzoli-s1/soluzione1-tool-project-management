-- Rinomina dello stato roadmap "Bloccato" (chiave BLOCCATO) in "Standby"
-- (chiave STANDBY). Gli stati roadmap sono dati configurabili
-- (stato_roadmap_config), non seed/codice; RoadmapItem.stato referenzia la
-- chiave come stringa (nessuna FK), quindi la migrazione degli item e della
-- config deve avvenire nella stessa transazione per non lasciare item orfani.
-- Idempotente: no-op se la chiave BLOCCATO non esiste (es. ambiente già migrato).

-- Prima gli item che puntano alla vecchia chiave...
UPDATE "roadmap_items" SET "stato" = 'STANDBY' WHERE "stato" = 'BLOCCATO';

-- ...poi la riga di configurazione (chiave = codice, label = descrizione).
UPDATE "stato_roadmap_config"
SET "chiave" = 'STANDBY', "label" = 'Standby'
WHERE "chiave" = 'BLOCCATO';
