import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createTranscriptionSocket, type TranscriptSocketMessage } from '../lib/websocket'

type VoiceSessionState = 'idle' | 'connecting' | 'recording' | 'stopping' | 'error'

type UseVoiceSessionOptions = {
  onFallback?: () => void
  onRecordingStarted?: () => void
}

const CHUNK_INTERVAL_MS = 2500
const VOICE_DETECTED_THRESHOLD = 0.08

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

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setState('error')
      onFallback?.()
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
    const sessionId = sessionIdRef.current + 1
    sessionIdRef.current = sessionId

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      console.debug('microphone stream acquired')
      const socket = createTranscriptionSocket()

      streamRef.current = stream
      socketRef.current = socket
      startAudioLevelDetection(stream, sessionId)

      await new Promise<void>((resolve, reject) => {
        const fail = () => reject(new Error('Transcription WebSocket unavailable'))

        socket.addEventListener('open', () => resolve(), { once: true })
        socket.addEventListener('error', fail, { once: true })
        socket.addEventListener('close', fail, { once: true })
      })

      socket.addEventListener('message', (event) => {
        if (sessionIdRef.current !== sessionId) return

        const data = parseSocketMessage(event.data)
        if (!data) return

        if (data.type === 'transcript' && data.text.trim()) {
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

      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
          console.debug('audio chunk sent')
          setIsTranscribingChunk(true)
          socket.send(event.data)
        }
      })

      recorder.start(CHUNK_INTERVAL_MS)
      setState('recording')
      onRecordingStarted?.()
      return true
    } catch {
      cleanup()
      setState('error')
      onFallback?.()
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

function parseSocketMessage(data: unknown): TranscriptSocketMessage | null {
  if (typeof data !== 'string') return null

  try {
    const parsed = JSON.parse(data) as TranscriptSocketMessage
    if (parsed.type === 'transcript' || parsed.type === 'generation_status') {
      return parsed
    }
  } catch {
    return null
  }

  return null
}
