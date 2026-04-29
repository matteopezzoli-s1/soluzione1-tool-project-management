import { useState } from 'react'
import LoginPage from './pages/LoginPage'
import './App.css'

function App() {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem('auth_token')
  )

  const handleLogin = (t: string) => setToken(t)

  const handleLogout = () => {
    localStorage.removeItem('auth_token')
    setToken(null)
  }

  if (!token) {
    return <LoginPage onLogin={handleLogin} />
  }

  // Dashboard placeholder — verrà implementata separatamente
  return (
    <div className="dashboard-placeholder">
      <div className="dashboard-card">
        <svg viewBox="0 0 28 28" fill="none" width="32" height="32" aria-hidden="true">
          <rect x="2" y="5" width="16" height="4" rx="2" fill="#C9A84C" />
          <rect x="7" y="12" width="14" height="4" rx="2" fill="#6AADFF" />
          <rect x="4" y="19" width="18" height="4" rx="2" fill="#C9A84C" opacity="0.75" />
        </svg>
        <h1>s1 Gantt</h1>
        <p>Dashboard in costruzione.</p>
        <button className="logout-btn" onClick={handleLogout} type="button">
          Esci
        </button>
      </div>
    </div>
  )
}

export default App
