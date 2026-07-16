// ─── Notifiche Presale via SAIOT ────────────────────────────────────────────
// A ogni passaggio di fase Presale inviamo una mail tramite SAIOT (software
// interno Soluzione1): SAIOT ha i testi pre-confezionati con placeholder
// {{cusN}} e li compila con i valori che passiamo qui. Il body/oggetto NON
// vivono in questo codice: qui costruiamo solo i campi (email, subject, cusN).
//
// La condizione di invio lato SAIOT è su `language` (sempre "IT") + `cus2`
// (codice fase). Vedi la mappatura cusN in buildEvent().

import type { PrismaClient } from '@prisma/client'

// ─── Config (letta da app_config, editabile in Impostazioni) ────────────────

export interface PresaleEmailConfig {
  url: string
  contextCode: string
  senderCode: string
  eventName: string
  devhubEmail: string
  enabled: boolean
}

const CONFIG_KEYS = {
  url: 'saiot_url',
  contextCode: 'saiot_context_code',
  senderCode: 'saiot_sender_code',
  eventName: 'saiot_event_name',
  devhubEmail: 'presale_devhub_email',
  enabled: 'presale_email_enabled',
} as const

export async function getPresaleEmailConfig(prisma: PrismaClient): Promise<PresaleEmailConfig> {
  const rows = await prisma.appConfig.findMany({
    where: { chiave: { in: Object.values(CONFIG_KEYS) } },
  })
  const map = new Map(rows.map(r => [r.chiave, r.valore]))
  return {
    url: map.get(CONFIG_KEYS.url) ?? '',
    contextCode: map.get(CONFIG_KEYS.contextCode) ?? '',
    senderCode: map.get(CONFIG_KEYS.senderCode) ?? '',
    eventName: map.get(CONFIG_KEYS.eventName) ?? 'tpm',
    devhubEmail: map.get(CONFIG_KEYS.devhubEmail) ?? '',
    enabled: (map.get(CONFIG_KEYS.enabled) ?? 'false') === 'true',
  }
}

export async function savePresaleEmailConfig(
  prisma: PrismaClient,
  cfg: PresaleEmailConfig,
): Promise<void> {
  const entries: Array<[string, string]> = [
    [CONFIG_KEYS.url, cfg.url.trim()],
    [CONFIG_KEYS.contextCode, cfg.contextCode.trim()],
    [CONFIG_KEYS.senderCode, cfg.senderCode.trim()],
    [CONFIG_KEYS.eventName, cfg.eventName.trim() || 'tpm'],
    [CONFIG_KEYS.devhubEmail, cfg.devhubEmail.trim()],
    [CONFIG_KEYS.enabled, cfg.enabled ? 'true' : 'false'],
  ]
  await prisma.$transaction(
    entries.map(([chiave, valore]) =>
      prisma.appConfig.upsert({
        where: { chiave },
        create: { chiave, valore },
        update: { valore },
      }),
    ),
  )
}

// ─── Fasi ───────────────────────────────────────────────────────────────────

// Codici fase (= cus2, condizione SAIOT).
export type PresaleFaseCode =
  | 'ANALISI_INIZIALE'
  | 'PRESA_IN_CARICO'
  | 'STIMA'
  | 'TRATTATIVA_CLIENTE'
  | 'PROGETTO_CONFERMATO'

// Chiave stato (StatoAttivitaConfig.chiave) → codice fase mail.
export const STATO_TO_FASE: Record<string, PresaleFaseCode> = {
  PRESALE_APERTURA: 'ANALISI_INIZIALE',
  PRESALE_PRESA_CARICO: 'PRESA_IN_CARICO',
  PRESALE_STIMA: 'STIMA',
  PRESALE_GIORNATE: 'TRATTATIVA_CLIENTE',
}

// Oggetto (compilato lato backend: SAIOT non espande i placeholder nel subject).
const SUBJECT_PREFIX: Record<PresaleFaseCode, string> = {
  ANALISI_INIZIALE: 'Nuova richiesta di stima',
  PRESA_IN_CARICO: 'Presa in carico',
  STIMA: 'Stima pronta',
  TRATTATIVA_CLIENTE: 'In trattativa',
  PROGETTO_CONFERMATO: 'Progetto confermato',
}

// ─── Dati attività necessari a comporre la mail ─────────────────────────────

export interface AttivitaMailData {
  cliente: string
  attivita: string
  pmNome: string
  pmEmail: string | null
  assegnatarioNome: string
  tipoInterventoLabel: string
  giornateStimate: string
  giornateVendute: string
  scadenzaStima: string
  linkRequisiti: string
  linkStima: string
  linkOfferta: string
}

const DASH = '—'

function nomeUtente(u: { firstName: string | null; lastName: string | null } | null): string {
  return u ? [u.firstName, u.lastName].filter(Boolean).join(' ') : ''
}

function formatData(d: Date | null): string {
  if (!d) return DASH
  const gg = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${gg}/${mm}/${d.getUTCFullYear()}`
}

async function loadAttivitaMailData(
  prisma: PrismaClient,
  attivitaId: string,
): Promise<AttivitaMailData | null> {
  const a = await prisma.attivita.findUnique({
    where: { id: attivitaId },
    include: {
      clienteRel: { select: { nome: true } },
      pms: { include: { pm: { select: { firstName: true, lastName: true, email: true } } } },
      presaleAssegnatario: { select: { firstName: true, lastName: true } },
    },
  })
  if (!a) return null
  const pm = a.pms[0]?.pm ?? null
  return {
    cliente: a.clienteRel?.nome ?? a.cliente,
    attivita: a.attivita,
    pmNome: nomeUtente(pm),
    pmEmail: pm?.email ?? null,
    assegnatarioNome: nomeUtente(a.presaleAssegnatario) || DASH,
    tipoInterventoLabel:
      a.presaleTipoIntervento === 'NUOVO_PROGETTO'
        ? 'Nuovo progetto'
        : a.presaleTipoIntervento === 'MODIFICA'
          ? 'Modifica ad applicativo esistente'
          : DASH,
    giornateStimate: a.presaleGiornateStimate != null ? String(a.presaleGiornateStimate) : DASH,
    giornateVendute: a.giornateVendute != null ? String(a.giornateVendute) : DASH,
    scadenzaStima: formatData(a.presaleScadenzaStima),
    linkRequisiti: a.presaleLinkRequisiti?.trim() || DASH,
    linkStima: a.presaleLinkStima?.trim() || DASH,
    linkOfferta: a.presaleLinkOfferta?.trim() || DASH,
  }
}

// ─── Costruzione evento SAIOT ────────────────────────────────────────────────

interface SaiotEvent {
  language: 'IT'
  email: string
  subject: string
  cus1: string
  cus2: PresaleFaseCode
  cus3: string
  cus4: string
  cus5: string
  cus6?: string
  cus7?: string
  cus8?: string
}

// Ritorna l'evento SAIOT + il destinatario "obbligatorio" (email principale):
// se manca (es. PM senza email) l'invio va saltato.
export function buildEvent(
  fase: PresaleFaseCode,
  d: AttivitaMailData,
  devhubEmail: string,
): SaiotEvent | null {
  const pmEmail = d.pmEmail?.trim() || ''
  const subject = `[Presale] ${SUBJECT_PREFIX[fase]} – ${d.cliente} / ${d.attivita}`
  // Ancore comuni a tutte le fasi.
  const base = {
    language: 'IT' as const,
    subject,
    cus3: d.cliente,
    cus4: d.attivita,
    cus5: d.pmNome || DASH,
  }

  switch (fase) {
    case 'ANALISI_INIZIALE': // → DevHub, Cc PM
      if (!devhubEmail) return null
      return {
        ...base, email: devhubEmail, cus1: pmEmail, cus2: fase,
        cus6: d.tipoInterventoLabel, cus7: d.scadenzaStima, cus8: d.linkRequisiti,
      }
    case 'PRESA_IN_CARICO': // → PM, Cc DevHub
      if (!pmEmail) return null
      return {
        ...base, email: pmEmail, cus1: devhubEmail, cus2: fase,
        cus6: d.assegnatarioNome,
      }
    case 'STIMA': // → PM, Cc DevHub
      if (!pmEmail) return null
      return {
        ...base, email: pmEmail, cus1: devhubEmail, cus2: fase,
        cus6: d.assegnatarioNome, cus7: d.giornateStimate, cus8: d.linkStima,
      }
    case 'TRATTATIVA_CLIENTE': // → DevHub, Cc PM
      if (!devhubEmail) return null
      return {
        ...base, email: devhubEmail, cus1: pmEmail, cus2: fase,
        cus6: d.giornateStimate, cus7: d.giornateVendute, cus8: d.linkOfferta,
      }
    case 'PROGETTO_CONFERMATO': // → DevHub, Cc PM
      if (!devhubEmail) return null
      return {
        ...base, email: devhubEmail, cus1: pmEmail, cus2: fase,
        cus6: d.tipoInterventoLabel, cus7: d.giornateVendute, cus8: d.assegnatarioNome,
      }
  }
}

// ─── Invio ───────────────────────────────────────────────────────────────────

// Manda la mail della fase per l'attività indicata. "Best effort":
//  - non lancia mai (gli errori vengono loggati) così non blocca il cambio stato;
//  - dedup via Attivita.presaleEmailFasiInviate (una mail per fase per attività).
export async function sendPresaleFaseEmail(
  prisma: PrismaClient,
  attivitaId: string,
  fase: PresaleFaseCode,
): Promise<void> {
  try {
    const cfg = await getPresaleEmailConfig(prisma)
    if (!cfg.enabled) return
    if (!cfg.url) { console.warn('[presaleEmail] URL SAIOT non configurato, invio saltato'); return }

    // Dedup: già inviata per questa fase?
    const row = await prisma.attivita.findUnique({
      where: { id: attivitaId },
      select: { presaleEmailFasiInviate: true },
    })
    if (!row) return
    if (row.presaleEmailFasiInviate.includes(fase)) return

    const data = await loadAttivitaMailData(prisma, attivitaId)
    if (!data) return

    const event = buildEvent(fase, data, cfg.devhubEmail.trim())
    if (!event) {
      console.warn(`[presaleEmail] destinatario mancante per fase ${fase} (attività ${attivitaId}), invio saltato`)
      return
    }

    const payload = {
      contextCode: cfg.contextCode,
      senderCode: cfg.senderCode,
      event_name: cfg.eventName,
      events: [event],
    }

    console.log(`[presaleEmail] invio ${fase} →`, JSON.stringify(payload))
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[presaleEmail] SAIOT ha risposto ${res.status} per fase ${fase}: ${body}`)
      return // non marco come inviata: si ritenta al prossimo salvataggio
    }

    // Marca la fase come notificata (append idempotente).
    await prisma.attivita.update({
      where: { id: attivitaId },
      data: { presaleEmailFasiInviate: { push: fase } },
    })
  } catch (err) {
    console.error(`[presaleEmail] errore invio fase ${fase} (attività ${attivitaId}):`, err)
  }
}
