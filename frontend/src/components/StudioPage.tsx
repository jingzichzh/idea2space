import { ArrowLeft, Mic, Pause, Play, RotateCcw, Square } from 'lucide-react'
import { useState } from 'react'
import { useDemoTimeline } from '../hooks/useDemoTimeline'
import { useVoiceSession } from '../hooks/useVoiceSession'
import { generateArchitecture, type GeneratedArchitecture } from '../lib/api'
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
  const [generatedArchitecture, setGeneratedArchitecture] = useState<GeneratedArchitecture | null>(null)
  const [isGeneratingArchitecture, setIsGeneratingArchitecture] = useState(false)
  const voice = useVoiceSession({
    onFallback: demo.replay,
    onRecordingStarted: demo.start,
  })
  const transcriptWords = voice.hasTranscript ? voice.transcriptWords : demo.visibleTranscriptWords
  const statusLabel = isGeneratingArchitecture
    ? 'GENERATING HF ARCHITECTURE'
    : getVoiceStatusLabel(voice.state, voice.generationStatus) ?? demo.statusLabel
  const statusState = isGeneratingArchitecture || voice.generationStatus === 'generating_architecture'
    ? 'generating'
    : voice.isRecording || voice.isStarting ? 'recording' : demo.demoState
  const wordCount = transcriptWords.length
  const architectureSourceLabel = generatedArchitecture ? `${generatedArchitecture.nodes.length} SERVICES · GENERATED` : '8 SERVICES · MOCK ONLY'

  const replay = () => {
    setGeneratedArchitecture(null)
    voice.reset()
    demo.replay()
  }

  const reset = () => {
    setGeneratedArchitecture(null)
    setIsGeneratingArchitecture(false)
    voice.reset()
    demo.reset()
  }

  const toggleRecording = async () => {
    if (!voice.isRecording) {
      setGeneratedArchitecture(null)
      await voice.start()
      return
    }

    const transcript = voice.transcriptText
    voice.stop()

    if (!transcript.trim()) return

    setIsGeneratingArchitecture(true)
    try {
      const response = await generateArchitecture(transcript)
      setGeneratedArchitecture(response.architecture)
    } catch {
      setGeneratedArchitecture(null)
    } finally {
      setIsGeneratingArchitecture(false)
    }
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
          <button type="button" onClick={toggleRecording} disabled={voice.isStarting || isGeneratingArchitecture}>
            {voice.isRecording ? <Square size={13} /> : <Mic size={14} />}
            {voice.isRecording ? 'Stop recording' : voice.isStarting ? 'Starting mic' : isGeneratingArchitecture ? 'Generating' : 'Start recording'}
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
              <span>{architectureSourceLabel}</span>
              <strong>SHEET 01 / 03</strong>
            </div>
          </header>
          <ArchitectureGraph
            generatedArchitecture={generatedArchitecture}
            visibleNodeIds={demo.visibleArchitectureNodeIds}
          />
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
