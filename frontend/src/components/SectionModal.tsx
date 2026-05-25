import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './SectionModal.css'

interface SectionModalProps {
  onClose: () => void
  children: ReactNode
  labelledBy?: string
}

/**
 * Modal overlay scoped to the main content area only (sidebar excluded).
 * Uses createPortal to escape any stacking context, but the overlay's
 * left edge starts at 64px (sidebar width) so the sidebar is never dimmed.
 */
export function SectionModal({ onClose, children, labelledBy }: SectionModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return createPortal(
    <div
      className="sm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {children}
    </div>,
    document.body
  )
}
