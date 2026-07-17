import { useEffect, useState } from 'react'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

// ─── useDriveConfig ───────────────────────────────────────────────────────────
// Radici dei drive condivisi configurate in Impostazioni → Google Drive
// (GET /api/config/google-drive). null finché non caricata o in errore:
// le pagine mostrano solo l'input manuale.

export interface DriveConfig {
  devUrl: string
  devId: string
  commUrl: string
  commId: string
  contrattiUrl: string
  contrattiId: string
}

export function useDriveConfig(token: string): DriveConfig | null {
  const [cfg, setCfg] = useState<DriveConfig | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(`${API_URL}/api/config/google-drive`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (!cancelled && data) setCfg(data as DriveConfig) })
      .catch(() => { /* config assente: resta solo l'input manuale */ })
    return () => { cancelled = true }
  }, [token])
  return cfg
}
