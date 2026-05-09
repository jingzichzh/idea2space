import { ArrowLeft, Pause, Play, RotateCcw } from 'lucide-react'
import { useDemoTimeline } from '../hooks/useDemoTimeline'
import { studioMeta } from '../lib/mockData'
import { ArchitectureGraph } from './ArchitectureGraph'
import { LiveTranscript } from './LiveTranscript'

type StudioPageProps = {
  autoStart: boolean
  onBack: () => void
}

const STUDIO_GRAIN_CLASS = 'grain studio-grain'

export function StudioPage({ autoStart, onBack }: StudioPageProps) {
  const demo = useDemoTimeline(autoStart)

  return (
    <section className="studio">
      <div className={STUDIO_GRAIN_CLASS} aria-hidden="true" />
      <header className="studio-topbar">
        <div className="studio-brand">
          <div><i /></div>
          <span>bubble</span>
        </div>
        <div className="studio-flow">
          <span>VOICE</span>
          <i>→</i>
          <span>HF ARCHITECTURE</span>
          <i>→</i>
          <span>ROADMAP</span>
        </div>
        <div className="studio-meta">
          {studioMeta.map((item) => (
            <div key={item.label}><span>{item.label}</span><b>{item.value}</b></div>
          ))}
          <button type="button" onClick={onBack} aria-label="Back to landing">
            <ArrowLeft size={15} />
          </button>
        </div>
      </header>

      <div className="demo-status-bar">
        <div>
          <i className={`status-dot status-${demo.demoState}`} />
          <span>{demo.statusLabel}</span>
          <b>{demo.demoState}</b>
        </div>
        <div className="demo-controls">
          <button type="button" onClick={demo.replay}>
            <RotateCcw size={14} />
            Replay demo
          </button>
          <button type="button" onClick={demo.pauseOrResume} disabled={demo.demoState === 'idle' || demo.demoState === 'complete'}>
            {demo.isPaused ? <Play size={14} /> : <Pause size={14} />}
            {demo.isPaused ? 'Resume' : 'Pause'}
          </button>
          <button type="button" onClick={demo.reset}>
            Reset studio
          </button>
        </div>
      </div>

      <div className="studio-canvas">
        <LiveTranscript
          statusLabel={demo.statusLabel}
          visibleWords={demo.visibleTranscriptWords}
          wordCount={demo.wordCount}
        />
        <section className="architecture-sheet">
          <header>
            <div>
              <span>HF-NATIVE SYSTEM ARCHITECTURE</span>
              <h2>voice → product → Space</h2>
            </div>
            <div>
              <span>8 SERVICES · MOCK ONLY</span>
              <strong>SHEET 01 / 03</strong>
            </div>
          </header>
          <ArchitectureGraph visibleNodeIds={demo.visibleArchitectureNodeIds} />
        </section>
      </div>
    </section>
  )
}
