import { Check, Copy, Mic, Square } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVoiceSession } from '../hooks/useVoiceSession'
import {
  generateArchitecture,
  type GeneratedArchitecture,
  type GeneratedArchitectureEdge,
  type GeneratedArchitectureNode,
} from '../lib/api'
import { studioMeta } from '../lib/mockData'
import { ArchitectureGraph } from './ArchitectureGraph'
import { LiveTranscript } from './LiveTranscript'

type StudioPageProps = {
  onBack?: () => void
}

type ArchitectureMeta = {
  source: 'hf_llm' | 'mock'
  promptVersion?: string
}

type StudioMode = 'idle' | 'recording' | 'finalizing_transcript' | 'generating' | 'complete' | 'error'

const STUDIO_GRAIN_CLASS = 'grain studio-grain'
const EMPTY_VISIBLE_NODE_IDS: string[] = []

export function StudioPage({ onBack }: StudioPageProps = {}) {
  const [mode, setMode] = useState<StudioMode>('idle')
  const [liveTranscript, setLiveTranscript] = useState('')
  const [generatedArchitecture, setGeneratedArchitecture] = useState<GeneratedArchitecture | null>(null)
  const [architectureMeta, setArchitectureMeta] = useState<ArchitectureMeta | null>(null)
  const generationInFlightRef = useRef(false)
  const generationRequestIdRef = useRef(0)

  const resetWorkspace = useCallback(() => {
    setLiveTranscript('')
    setGeneratedArchitecture(null)
    setArchitectureMeta(null)
    generationInFlightRef.current = false
    generationRequestIdRef.current += 1
    setMode('idle')
  }, [])

  const startFreshRecording = useCallback(() => {
    setLiveTranscript('')
    setGeneratedArchitecture(null)
    setArchitectureMeta(null)
    generationInFlightRef.current = false
    generationRequestIdRef.current += 1
  }, [])

  const generateFinalArchitecture = useCallback(async (transcript: string) => {
    if (generationInFlightRef.current) return

    const cleanTranscript = transcript.trim()
    if (!cleanTranscript) {
      setMode('idle')
      return
    }

    generationInFlightRef.current = true
    const requestId = generationRequestIdRef.current + 1
    generationRequestIdRef.current = requestId
    setMode('generating')
    console.debug('architecture generation started')

    try {
      const response = await generateArchitecture(cleanTranscript)
      if (generationRequestIdRef.current !== requestId) return
      setGeneratedArchitecture(response.architecture)
      setArchitectureMeta({ source: response.source, promptVersion: response.prompt_version })
      setMode('complete')
    } catch {
      if (generationRequestIdRef.current !== requestId) return
      setGeneratedArchitecture(null)
      setArchitectureMeta(null)
      setMode('idle')
    } finally {
      generationInFlightRef.current = false
    }
  }, [])

  return (
    <section className="studio">
      <div className={STUDIO_GRAIN_CLASS} aria-hidden="true" />
      <header className="studio-topbar">
        <div className="studio-brand">
          <div><i /></div>
          <span>idea2space</span>
        </div>
        <div className="studio-flow">
          <span>Speak your idea</span>
          <i>-&gt;</i>
          <span>Review the Space plan</span>
          <i>-&gt;</i>
          <span>Copy the build prompt</span>
        </div>
        <div className="studio-meta">
          {studioMeta.map((item) => (
            <div key={item.label}><span>{item.label}</span><b>{item.value}</b></div>
          ))}
          {onBack && (
            <button type="button" onClick={onBack} aria-label="Back">
              Back
            </button>
          )}
        </div>
      </header>

      <div className="studio-canvas">
        <VoicePanel
          mode={mode}
          onFinalTranscript={generateFinalArchitecture}
          onModeChange={setMode}
          onRecordingStart={startFreshRecording}
          onReset={resetWorkspace}
          onTranscriptChange={setLiveTranscript}
        />
        <BuildWorkspace
          architectureMeta={architectureMeta}
          generatedArchitecture={generatedArchitecture}
          mode={mode}
          transcript={liveTranscript}
        />
      </div>
    </section>
  )
}

type VoicePanelProps = {
  mode: StudioMode
  onFinalTranscript: (transcript: string) => void
  onModeChange: (mode: StudioMode) => void
  onRecordingStart: () => void
  onReset: () => void
  onTranscriptChange: (transcript: string) => void
}

const VoicePanel = memo(function VoicePanel({
  mode,
  onFinalTranscript,
  onModeChange,
  onRecordingStart,
  onReset,
  onTranscriptChange,
}: VoicePanelProps) {
  const voice = useVoiceSession({})
  const voiceStatus = getVoiceStatus(mode, voice)
  const transcriptWords = voice.transcriptWords
  const wordCount = transcriptWords.length

  useEffect(() => {
    onTranscriptChange(voice.transcriptText)
  }, [onTranscriptChange, voice.transcriptText])

  const reset = useCallback(() => {
    voice.reset()
    onReset()
  }, [onReset, voice])

  const startRecording = useCallback(async () => {
    if (mode === 'recording' || mode === 'finalizing_transcript' || mode === 'generating' || voice.isRecording || voice.isStarting) return

    voice.reset()
    onRecordingStart()
    onModeChange('recording')

    const started = await voice.start()
    if (!started) {
      onModeChange('error')
    }
  }, [mode, onModeChange, onRecordingStart, voice])

  const stopRecording = useCallback(async () => {
    if (mode !== 'recording') return

    onModeChange('finalizing_transcript')
    const transcript = await voice.stop()
    onFinalTranscript(transcript)
  }, [mode, onFinalTranscript, onModeChange, voice])

  const handleRecordingButton = useCallback(() => {
    if (mode === 'recording') {
      void stopRecording()
      return
    }
    void startRecording()
  }, [mode, startRecording, stopRecording])

  return (
    <section className="voice-panel">
      <div className="recording-controls">
        <div>
          <i className={`status-dot status-${voiceStatus.dotState}`} />
          <span>{voiceStatus.label}</span>
          <b>{mode}</b>
        </div>
        <div className="demo-controls">
          <button type="button" onClick={handleRecordingButton} disabled={voice.isStarting || mode === 'finalizing_transcript' || mode === 'generating'}>
            {mode === 'recording' ? <Square size={13} /> : <Mic size={14} />}
            {mode === 'recording' ? 'Stop recording' : voice.isStarting ? 'Starting mic' : mode === 'finalizing_transcript' ? 'Finalizing' : mode === 'generating' ? 'Generating' : 'Start recording'}
          </button>
          <button type="button" onClick={reset}>
            Reset studio
          </button>
        </div>
      </div>

      <LiveTranscript
        active={voiceStatus.waveformActive}
        audioLevel={voiceStatus.waveformActive ? voice.audioLevel : 0}
        statusLabel={voiceStatus.label}
        visibleWords={transcriptWords}
        wordCount={wordCount}
        waveformLabel={voiceStatus.waveformLabel}
      />
    </section>
  )
})

type BuildWorkspaceProps = {
  architectureMeta: ArchitectureMeta | null
  generatedArchitecture: GeneratedArchitecture | null
  mode: StudioMode
  transcript: string
}

const BuildWorkspace = memo(function BuildWorkspace({
  architectureMeta,
  generatedArchitecture,
  mode,
  transcript,
}: BuildWorkspaceProps) {
  const debouncedTranscript = useDebouncedValue(transcript, 1600)
  const previewArchitecture = useMemo(
    () => mode === 'recording' ? buildPreviewArchitecture(debouncedTranscript) : null,
    [debouncedTranscript, mode],
  )
  const displayedArchitecture = mode === 'complete' ? generatedArchitecture : previewArchitecture
  const buildPrompt = mode === 'complete' ? generatedArchitecture?.build_prompt?.trim() ?? '' : ''
  const architectureSourceLabel = displayedArchitecture ? `${displayedArchitecture.nodes.length} STEPS` : 'READY'
  const architectureModeLabel = architectureMeta && mode === 'complete'
    ? `source: ${architectureMeta.source} / prompt: ${architectureMeta.promptVersion ?? 'unknown'}`
    : mode === 'recording'
      ? 'preview: grows from your live transcript'
      : mode === 'generating'
        ? 'generating final architecture'
        : 'waiting for recording'

  return (
    <section className="architecture-sheet">
      <header>
        <div>
          <span>HF-NATIVE SYSTEM ARCHITECTURE</span>
          <h2>BUILD YOUR IDEA WITH HUGGING FACE</h2>
          <p>{architectureModeLabel}</p>
        </div>
        <div>
          <span>{architectureSourceLabel}</span>
          <strong>{mode === 'complete' ? 'FINAL' : 'PREVIEW'}</strong>
        </div>
      </header>

      <div className="workspace-split">
        <section className="workspace-graph-panel">
          <ArchitectureGraph
            generatedArchitecture={displayedArchitecture}
            visibleNodeIds={EMPTY_VISIBLE_NODE_IDS}
          />
          {!displayedArchitecture && (
            <div className="workspace-empty-state">
              <span>{mode === 'generating' ? 'Generating architecture...' : 'Start recording to sketch your Space flow.'}</span>
            </div>
          )}
        </section>
        <BuildPromptPanel key={buildPrompt || 'empty-prompt'} buildPrompt={buildPrompt} />
      </div>
    </section>
  )
})

const BuildPromptPanel = memo(function BuildPromptPanel({ buildPrompt }: { buildPrompt: string }) {
  const [copied, setCopied] = useState(false)
  const copyTimeoutRef = useRef<number | null>(null)
  const hasPrompt = Boolean(buildPrompt.trim())

  useEffect(() => () => {
    if (copyTimeoutRef.current !== null) {
      window.clearTimeout(copyTimeoutRef.current)
    }
  }, [])

  const copyPrompt = async () => {
    if (!hasPrompt) return
    await copyTextToClipboard(buildPrompt)
    setCopied(true)
    if (copyTimeoutRef.current !== null) {
      window.clearTimeout(copyTimeoutRef.current)
    }
    copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <section className="build-prompt-panel">
      <header>
        <div>
          <span>CODE AGENT HANDOFF</span>
          <h3>Build prompt for your code agent</h3>
        </div>
        <button type="button" onClick={() => void copyPrompt()} disabled={!hasPrompt}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy prompt'}
        </button>
      </header>
      <pre>{hasPrompt ? buildPrompt : 'Build prompt will appear after generation.'}</pre>
    </section>
  )
})

function useDebouncedValue(value: string, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [delayMs, value])

  return debouncedValue
}

function buildPreviewArchitecture(transcript: string): GeneratedArchitecture | null {
  const lower = transcript.toLowerCase()
  if (lower.trim().length < 8) return null

  const nodes: GeneratedArchitectureNode[] = []
  const addNode = (node: GeneratedArchitectureNode) => {
    if (!nodes.some((item) => item.id === node.id)) nodes.push(node)
  }

  if (hasAny(lower, ['voice', 'speak', 'speech', 'microphone', 'audio', 'talk'])) {
    addNode({ id: 'preview-microphone', label: 'Microphone input', type: 'input', role: 'Capture the spoken idea', hf_component: 'Browser microphone' })
    addNode({ id: 'preview-speech-to-text', label: 'Speech to text', type: 'hf_model', role: 'Turn speech into text for the app', hf_component: 'Whisper ASR' })
  }

  if (hasAny(lower, ['existing space', 'my space', 'i have', 'current app', 'existing app'])) {
    addNode({ id: 'preview-existing-space', label: 'Existing Space', type: 'deployment', role: 'Reuse the current app or Space', hf_component: 'Hugging Face Space' })
  }

  if (hasAny(lower, ['generate', 'generation', 'model', 'llm', 'recommend', 'agent', 'mcp', 'tool'])) {
    addNode({ id: 'preview-generator', label: 'Generator / agent', type: 'agent', role: 'Create the useful response or recommendation', hf_component: 'HF model or agent tool' })
  }

  if (hasAny(lower, ['image', 'photo', 'vision', 'visual'])) {
    addNode({ id: 'preview-vision', label: 'Vision model', type: 'hf_model', role: 'Understand uploaded images', hf_component: 'HF vision model' })
  }

  if (hasAny(lower, ['document', 'pdf', 'rag', 'knowledge', 'search'])) {
    addNode({ id: 'preview-retrieval', label: 'Knowledge search', type: 'data', role: 'Find relevant information from documents', hf_component: 'Embeddings / retrieval' })
  }

  if (hasAny(lower, ['space', 'deploy', 'hugging face', 'gradio', 'app'])) {
    addNode({ id: 'preview-space', label: 'Space deployment', type: 'deployment', role: 'Package the demo as a Hugging Face Space', hf_component: 'Hugging Face Spaces' })
  }

  if (!nodes.length) {
    addNode({ id: 'preview-idea', label: 'Product idea', type: 'input', role: 'Shape the workflow from the transcript', hf_component: 'User idea' })
  }

  const visibleNodes = nodes.slice(0, 7)
  const edges: GeneratedArchitectureEdge[] = visibleNodes.slice(0, -1).map((node, index) => ({
    source: node.id,
    target: visibleNodes[index + 1].id,
    label: 'next',
  }))

  return {
    assumptions: [],
    build_prompt: '',
    edges,
    next_steps: [],
    nodes: visibleNodes,
    one_liner: 'Preview architecture from the live transcript.',
    product_name: 'Live Space Preview',
    recommended_hf_stack: [],
    recommended_stack: [],
    recommended_hf_assets: [],
    roadmap: [],
    summary: 'Preview architecture from the live transcript.',
    user_input_summary: transcript,
  }
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

function getVoiceStatus(
  mode: StudioMode,
  voice: ReturnType<typeof useVoiceSession>,
) {
  if (mode === 'generating') {
    return { label: 'Generating architecture...', dotState: 'generating', waveformActive: false, waveformLabel: 'stopped' }
  }
  if (mode === 'finalizing_transcript') {
    return { label: 'Finalizing transcript...', dotState: 'generating', waveformActive: false, waveformLabel: 'stopped' }
  }
  if (mode === 'complete') {
    return { label: 'Complete', dotState: 'complete', waveformActive: false, waveformLabel: 'stopped' }
  }
  if (mode === 'error' || voice.state === 'error') {
    return { label: voice.errorMessage ?? 'Microphone unavailable', dotState: 'idle', waveformActive: false, waveformLabel: 'error' }
  }
  if (voice.state === 'connecting') {
    return { label: 'Requesting microphone permission...', dotState: 'generating', waveformActive: false, waveformLabel: 'armed' }
  }
  if (mode === 'recording') {
    if (isTranscriptDelayed(voice)) {
      return { label: 'Still transcribing your audio...', dotState: 'recording', waveformActive: true, waveformLabel: levelLabel(voice.audioLevel) }
    }
    if (voice.isTranscribingChunk) {
      return { label: 'Transcribing speech...', dotState: 'recording', waveformActive: true, waveformLabel: levelLabel(voice.audioLevel) }
    }
    if (voice.audioLevel >= 0.08) {
      return { label: 'Voice detected', dotState: 'recording', waveformActive: true, waveformLabel: levelLabel(voice.audioLevel) }
    }
    if (voice.hasDetectedVoice) {
      return { label: 'Listening...', dotState: 'recording', waveformActive: true, waveformLabel: levelLabel(voice.audioLevel) }
    }
    return { label: 'Recording - start speaking', dotState: 'recording', waveformActive: true, waveformLabel: levelLabel(voice.audioLevel) }
  }
  return { label: 'Ready to listen', dotState: 'idle', waveformActive: false, waveformLabel: 'armed' }
}

function isTranscriptDelayed(voice: ReturnType<typeof useVoiceSession>) {
  if (!voice.hasDetectedVoice || voice.transcriptWords.length > 0 || !voice.lastVoiceDetectedAt) return false
  return Date.now() - voice.lastVoiceDetectedAt > 8000
}

function levelLabel(audioLevel: number) {
  if (audioLevel >= 0.08) return `${Math.round(audioLevel * 100)}%`
  return 'quiet'
}

function hasAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term))
}
