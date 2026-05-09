import { ArrowLeft, Mic, Pause, Play, RotateCcw, Square } from 'lucide-react'
import { useDemoTimeline } from '../hooks/useDemoTimeline'
import { useVoiceSession } from '../hooks/useVoiceSession'
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
  const voice = useVoiceSession({
    onFallback: demo.replay,
    onRecordingStarted: demo.start,
  })
  const transcriptWords = voice.hasTranscript ? voice.transcriptWords : demo.visibleTranscriptWords
  const statusLabel = getVoiceStatusLabel(voice.state, voice.generationStatus) ?? demo.statusLabel
  const statusState = voice.isRecording || voice.isStarting ? 'recording' : demo.demoState
  const wordCount = transcriptWords.length

  const replay = () => {
    voice.reset()
    demo.replay()
  }

  const reset = () => {
    voice.reset()
    demo.reset()
  }

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
          <i className={`status-dot status-${statusState}`} />
          <span>{statusLabel}</span>
          <b>{statusState}</b>
        </div>
        <div className="demo-controls">
          <button type="button" onClick={voice.isRecording ? voice.stop : voice.start} disabled={voice.isStarting}>
            {voice.isRecording ? <Square size={13} /> : <Mic size={14} />}
            {voice.isRecording ? 'Stop recording' : voice.isStarting ? 'Starting mic' : 'Start recording'}
          </button>
          <button type="button" onClick={replay}>
            <RotateCcw size={14} />
            Replay demo
          </button>
          <button type="button" onClick={demo.pauseOrResume} disabled={demo.demoState === 'idle' || demo.demoState === 'complete'}>
            {demo.isPaused ? <Play size={14} /> : <Pause size={14} />}
            {demo.isPaused ? 'Resume' : 'Pause'}
          </button>
          <button type="button" onClick={reset}>
            Reset studio
          </button>
        </div>
      </div>

      <div className="studio-canvas">
        <LiveTranscript
          active={voice.isRecording}
          statusLabel={statusLabel}
          visibleWords={transcriptWords}
          wordCount={wordCount}
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

function getVoiceStatusLabel(state: ReturnType<typeof useVoiceSession>['state'], generationStatus: string | null) {
  if (state === 'connecting') return 'REQUESTING MIC / CONNECTING'
  if (generationStatus === 'generating_architecture') return 'GENERATING HF ARCHITECTURE'
  if (state === 'recording') return 'LIVE MIC / MOCK TRANSCRIPT'
  return null
}
