import { useState } from 'react'
import './App.css'
import { LandingHero } from './components/LandingHero'
import { StudioPage } from './components/StudioPage'

function App() {
  const [view, setView] = useState<'landing' | 'studio'>('landing')

  return (
    <main className="app-shell">
      {view === 'landing' ? (
        <LandingHero onEnterStudio={() => setView('studio')} />
      ) : (
        <StudioPage autoStart onBack={() => setView('landing')} />
      )}
    </main>
  )
}

export default App
