import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createTranscriptionSocket, getTranscriptionSocketUrl, type TranscriptSocketMessage } from '../lib/websocket'

type VoiceSessionState = 'idle' | 'connecting' | 'recording' | 'stopping' | 'error'

type UseVoiceSessionOptions = {
  onFallback?: () => void
  onRecordingStarted?: () => void
}

const CHUNK_INTERVAL_MS = 2500
const VOICE_DETECTED_THRESHOLD = 0.08
const MEDIA_RECORDER_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
]

export function useVoiceSession({ onFallback, onRecordingStarted }: UseVoiceSessionOptions) {
  const socketRef = useRef<WebSocket | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const levelRafRef = useRef(0)
  const sessionIdRef = useRef(0)
  const transcriptRef = useRef('')
  const voiceDetectedLoggedRef = useRef(false)
  const [state, setState] = useState<VoiceSessionState>('idle')
  const [transcript, setTranscript] = useState('')
  const [audioLevel, setAudioLevel] = useState(0)
  const [hasDetectedVoice, setHasDetectedVoice] = useState(false)
  const [isTranscribingChunk, setIsTranscribingChunk] = useState(false)
  const [lastVoiceDetectedAt, setLastVoiceDetectedAt] = useState<number | null>(null)
  const [lastTranscriptReceivedAt, setLastTranscriptReceivedAt] = useState<number | null>(null)
  const [generationStatus, setGenerationStatus] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const cleanup = useCallback(() => {
    window.cancelAnimationFrame(levelRafRef.current)
    levelRafRef.current = 0
    analyserRef.current = null
    audioContextRef.current?.close().catch(() => undefined)
    audioContextRef.current = null
    recorderRef.current = null
    socketRef.current?.close()
    socketRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setAudioLevel(0)
    setIsTranscribingChunk(false)
  }, [])

  const reset = useCallback(() => {
    cleanup()
    setState('idle')
    sessionIdRef.current += 1
    transcriptRef.current = ''
    setTranscript('')
    setAudioLevel(0)
    setHasDetectedVoice(false)
    voiceDetectedLoggedRef.current = false
    setIsTranscribingChunk(false)
    setLastVoiceDetectedAt(null)
    setLastTranscriptReceivedAt(null)
    setGenerationStatus(null)
    setErrorMessage(null)
  }, [cleanup])

  const stop = useCallback(async (finalizeMs = 1600) => {
    setState('stopping')
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.requestData()
      recorder.stop()
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    window.cancelAnimationFrame(levelRafRef.current)
    levelRafRef.current = 0
    setAudioLevel(0)
    console.debug('stop recording')
    await wait(finalizeMs)
    const finalTranscript = transcriptRef.current
    sessionIdRef.current += 1
    cleanup()
    setState('idle')
    return finalTranscript
  }, [cleanup])

  const startAudioLevelDetection = useCallback((stream: MediaStream, sessionId: number) => {
    const audioWindow = window as Window & {
      webkitAudioContext?: typeof AudioContext
    }
    const AudioContextClass = window.AudioContext || audioWindow.webkitAudioContext
    if (!AudioContextClass) return

    const audioContext = new AudioContextClass()
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 1024
    audioContext.createMediaStreamSource(stream).connect(analyser)
    audioContextRef.current = audioContext
    analyserRef.current = analyser

    const samples = new Uint8Array(analyser.fftSize)
    const tick = () => {
      if (sessionIdRef.current !== sessionId || !analyserRef.current) return

      analyserRef.current.getByteTimeDomainData(samples)
      let sum = 0
      for (let index = 0; index < samples.length; index += 1) {
        const normalized = (samples[index] - 128) / 128
        sum += normalized * normalized
      }
      const rms = Math.sqrt(sum / samples.length)
      const level = Math.min(1, Math.max(0, rms * 4))
      setAudioLevel(level)

      if (level >= VOICE_DETECTED_THRESHOLD) {
        if (!voiceDetectedLoggedRef.current) {
          console.debug('voice detected threshold reached')
          voiceDetectedLoggedRef.current = true
        }
        setHasDetectedVoice(true)
        setLastVoiceDetectedAt(Date.now())
      }

      levelRafRef.current = window.requestAnimationFrame(tick)
    }

    tick()
  }, [])

  const start = useCallback(async () => {
    if (state === 'connecting' || state === 'recording') return false

    console.info('REAL_RECORDING_ENV', getRecordingEnvironment())

    if (!navigator.mediaDevices?.getUserMedia) {
      const message = 'Microphone capture is not available in this browser or context.'
      console.info('REAL_RECORDING_ERROR', message)
      console.error('[recording] microphone capture is not available in this browser or context')
      setErrorMessage(message)
      setState('error')
      return false
    }

    if (typeof MediaRecorder === 'undefined') {
      const message = 'MediaRecorder is not supported in this browser.'
      console.info('REAL_RECORDING_ERROR', message)
      console.error('[recording] MediaRecorder is not supported in this browser')
      setErrorMessage(message)
      setState('error')
      return false
    }

    setState('connecting')
    transcriptRef.current = ''
    setTranscript('')
    setAudioLevel(0)
    setHasDetectedVoice(false)
    voiceDetectedLoggedRef.current = false
    setIsTranscribingChunk(false)
    setLastVoiceDetectedAt(null)
    setLastTranscriptReceivedAt(null)
    setGenerationStatus(null)
    setErrorMessage(null)
    const sessionId = sessionIdRef.current + 1
    sessionIdRef.current = sessionId

    try {
      let stream: MediaStream
      try {
        console.info('REAL_MIC_REQUEST_START')
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (error) {
        const message = describeMicrophoneError(error)
        console.info('REAL_RECORDING_ERROR', message)
        console.error(`[recording] ${message}`, error)
        throw new RecordingStartError(message)
      }

      console.info('REAL_MIC_STREAM_ACQUIRED', {
        audioTracks: stream.getAudioTracks().map((track) => ({
          enabled: track.enabled,
          id: track.id,
          label: track.label,
          muted: track.muted,
          readyState: track.readyState,
        })),
      })
      console.debug('microphone stream acquired')
      const socketUrl = getTranscriptionSocketUrl()
      console.info('REAL_WS_CONNECTING', { url: socketUrl })
      console.debug(`connecting transcription WebSocket: ${socketUrl}`)
      const socket = createTranscriptionSocket()

      streamRef.current = stream
      socketRef.current = socket
      startAudioLevelDetection(stream, sessionId)

      await new Promise<void>((resolve, reject) => {
        const fail = (event: Event) => {
          const message = event instanceof CloseEvent && event.reason
            ? `Transcription WebSocket closed before recording started: ${event.reason}`
            : `Transcription WebSocket unavailable at ${socketUrl}`
          console.info('REAL_RECORDING_ERROR', message)
          console.error('[recording] WebSocket connection failed', { url: socketUrl, event })
          reject(new RecordingStartError(message))
        }

        socket.addEventListener('open', () => {
          console.info('REAL_WS_CONNECTED', { url: socketUrl })
          resolve()
        }, { once: true })
        socket.addEventListener('error', fail, { once: true })
        socket.addEventListener('close', fail, { once: true })
      })

      socket.addEventListener('message', (event) => {
        if (sessionIdRef.current !== sessionId) return

        const data = parseSocketMessage(event.data)
        if (!data) return

        if (data.type === 'error') {
          const message = data.message ?? data.detail ?? 'Backend reported an unknown transcription error.'
          console.error(`[recording] backend error message: ${message}`)
          setErrorMessage(message)
          setState('error')
          return
        }

        if (data.type === 'transcript' && data.text.trim()) {
          console.info('REAL_TRANSCRIPT_RECEIVED', {
            chars: data.text.length,
            source: data.source,
          })
          console.debug('transcript message received')
          setIsTranscribingChunk(false)
          setLastTranscriptReceivedAt(Date.now())
          setTranscript((current) => {
            const merged = mergeTranscriptSegment(current, data.text)
            transcriptRef.current = merged
            console.debug('transcript state updated')
            return merged
          })
        }

        if (data.type === 'generation_status') {
          setGenerationStatus(data.status)
        }
      })

      const mimeType = chooseMediaRecorderMimeType()
      console.info('REAL_MEDIA_RECORDER_CREATED', { mimeType: mimeType || '<browser-default>' })
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder

      recorder.addEventListener('dataavailable', (event) => {
        console.info('REAL_AUDIO_CHUNK_AVAILABLE', {
          size: event.data.size,
          type: event.data.type,
          socketReadyState: socket.readyState,
        })
        if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
          console.info('REAL_AUDIO_CHUNK_SENT', { size: event.data.size })
          console.debug('audio chunk sent')
          setIsTranscribingChunk(true)
          socket.send(event.data)
        }
      })

      recorder.start(CHUNK_INTERVAL_MS)
      console.info('REAL_MEDIA_RECORDER_STARTED', {
        intervalMs: CHUNK_INTERVAL_MS,
        mimeType: recorder.mimeType || '<browser-default>',
        state: recorder.state,
      })
      setState('recording')
      onRecordingStarted?.()
      return true
    } catch (error) {
      const message = error instanceof RecordingStartError
        ? error.message
        : `Recording failed: ${getErrorMessage(error)}`
      console.info('REAL_RECORDING_ERROR', message)
      console.error('[recording] start failed', error)
      setErrorMessage(message)
      cleanup()
      setState('error')
      return false
    }
  }, [cleanup, onFallback, onRecordingStarted, startAudioLevelDetection, state])

  useEffect(
    () => () => {
      sessionIdRef.current += 1
      cleanup()
    },
    [cleanup],
  )

  const transcriptWords = useMemo(
    () => transcript.split(/\s+/).filter(Boolean),
    [transcript],
  )
  const transcriptText = useMemo(() => transcript.trim(), [transcript])

  return {
    generationStatus,
    errorMessage,
    audioLevel,
    hasDetectedVoice,
    isTranscribingChunk,
    isRecording: state === 'recording',
    isStarting: state === 'connecting',
    lastTranscriptReceivedAt,
    lastVoiceDetectedAt,
    state,
    transcriptText,
    transcriptWords,
    hasTranscript: transcriptWords.length > 0,
    reset,
    start,
    stop,
  }
}

export function mergeTranscriptSegment(currentTranscript: string, newSegment: string) {
  const current = normalizeWhitespace(currentTranscript)
  const incoming = normalizeWhitespace(newSegment)

  if (!incoming) return current
  if (!current) return incoming
  if (canonicalText(current) === canonicalText(incoming)) return current

  const currentWords = splitWords(current)
  const incomingWords = splitWords(incoming)
  const currentCanonical = currentWords.map(canonicalWord)
  const incomingCanonical = incomingWords.map(canonicalWord)

  if (startsWithWords(incomingCanonical, currentCanonical) && currentCanonical.length >= 3) {
    return incoming
  }

  if (startsWithWords(currentCanonical, incomingCanonical) && incomingCanonical.length >= 3) {
    return current
  }

  const overlap = findWordOverlap(currentCanonical, incomingCanonical)
  if (overlap >= 4) {
    return normalizeWhitespace(`${current} ${incomingWords.slice(overlap).join(' ')}`)
  }

  return normalizeWhitespace(`${current} ${incoming}`)
}

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function splitWords(value: string) {
  return normalizeWhitespace(value).split(/\s+/).filter(Boolean)
}

function canonicalText(value: string) {
  return splitWords(value).map(canonicalWord).join(' ')
}

function canonicalWord(value: string) {
  return value.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
}

function startsWithWords(words: string[], prefix: string[]) {
  if (prefix.length > words.length) return false
  return prefix.every((word, index) => word === words[index])
}

function findWordOverlap(currentWords: string[], incomingWords: string[]) {
  const max = Math.min(currentWords.length, incomingWords.length)
  for (let size = max; size > 0; size -= 1) {
    const currentSuffix = currentWords.slice(currentWords.length - size)
    const incomingPrefix = incomingWords.slice(0, size)
    if (currentSuffix.every((word, index) => word === incomingPrefix[index])) {
      return size
    }
  }
  return 0
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

class RecordingStartError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecordingStartError'
  }
}

function getRecordingEnvironment() {
  return {
    href: window.location.href,
    origin: window.location.origin,
    isSecureContext: window.isSecureContext,
    hasMediaDevices: Boolean(navigator.mediaDevices),
    hasGetUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
    hasMediaRecorder: typeof MediaRecorder !== 'undefined',
    documentHasFocus: document.hasFocus(),
    isTopWindow: getIsTopWindow(),
  }
}

function getIsTopWindow() {
  try {
    return window.top === window.self
  } catch (error) {
    return `blocked: ${getErrorMessage(error)}`
  }
}

function chooseMediaRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return ''
  }

  return MEDIA_RECORDER_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? ''
}

function describeMicrophoneError(error: unknown) {
  if (error instanceof DOMException) {
    const details = `${error.name}: ${error.message || 'No browser message provided.'}`
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return `Microphone permission denied (${details})`
    }
    if (error.name === 'NotFoundError') {
      return `No microphone device was found (${details})`
    }
    if (error.name === 'NotReadableError') {
      return `Microphone is unavailable, possibly because another app is using it (${details})`
    }
    return `Microphone capture failed (${details})`
  }

  return `Microphone capture failed: ${getErrorMessage(error)}`
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function parseSocketMessage(data: unknown): TranscriptSocketMessage | null {
  if (typeof data !== 'string') return null

  try {
    const parsed = JSON.parse(data) as TranscriptSocketMessage
    if (parsed.type === 'transcript' || parsed.type === 'generation_status' || parsed.type === 'error') {
      return parsed
    }
  } catch {
    return null
  }

  return null
}
