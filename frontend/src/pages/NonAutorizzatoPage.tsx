import './NonAutorizzatoPage.css'

interface NonAutorizzatoPageProps {
  email?: string
  onBackToLogin: () => void
}

function IconLock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      width="32" height="32" aria-hidden="true">
      <rect x="4" y="10" width="16" height="10" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function NonAutorizzatoPage({ email, onBackToLogin }: NonAutorizzatoPageProps) {
  return (
    <main className="na-root">
      <div className="na-card">
        <div className="na-icon" aria-hidden="true">
          <IconLock />
        </div>
        <h1 className="na-title">Accesso non autorizzato</h1>
        <p className="na-desc">
          {email ? <>L'account <strong>{email}</strong> non</> : 'Il tuo account non'} risulta censito
          nell'anagrafica utenti di TPM. Contatta un referente Board per richiedere l'accesso.
        </p>
        <button className="na-btn" type="button" onClick={onBackToLogin}>
          Torna al login
        </button>
      </div>
    </main>
  )
}
