import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createTranscriptionSocket, type TranscriptSocketMessage } from '../lib/websocket'

type VoiceSessionState = 'idle' | 'connecting' | 'recording' | 'stopping' | 'error'

type UseVoiceSessionOptions = {
  onFallback: () => void
  onRecordingStarted?: () => void
}

const CHUNK_INTERVAL_MS = 2500

export function useVoiceSession({ onFallback, onRecordingStarted }: UseVoiceSessionOptions) {
  const socketRef = useRef<WebSocket | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [state, setState] = useState<VoiceSessionState>('idle')
  const [segments, setSegments] = useState<string[]>([])
  const [generationStatus, setGenerationStatus] = useState<string | null>(null)

  const cleanup = useCallback(() => {
    recorderRef.current = null
    socketRef.current?.close()
    socketRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const reset = useCallback(() => {
    cleanup()
    setState('idle')
    setSegments([])
    setGenerationStatus(null)
  }, [cleanup])

  const stop = useCallback(() => {
    setState('stopping')
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
    cleanup()
    setState('idle')
  }, [cleanup])

  const start = useCallback(async () => {
    if (state === 'connecting' || state === 'recording') return

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setState('error')
      onFallback()
      return
    }

    setState('connecting')
    setSegments([])
    setGenerationStatus(null)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const socket = createTranscriptionSocket()

      streamRef.current = stream
      socketRef.current = socket

      await new Promise<void>((resolve, reject) => {
        const fail = () => reject(new Error('Transcription WebSocket unavailable'))

        socket.addEventListener('open', () => resolve(), { once: true })
        socket.addEventListener('error', fail, { once: true })
        socket.addEventListener('close', fail, { once: true })
      })

      socket.addEventListener('message', (event) => {
        const data = parseSocketMessage(event.data)
        if (!data) return

        if (data.type === 'transcript' && data.text.trim()) {
          setSegments((current) => [...current, data.text])
        }

        if (data.type === 'generation_status') {
          setGenerationStatus(data.status)
        }
      })

      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
          socket.send(event.data)
        }
      })

      recorder.start(CHUNK_INTERVAL_MS)
      setState('recording')
      onRecordingStarted?.()
    } catch {
      cleanup()
      setState('error')
      onFallback()
    }
  }, [cleanup, onFallback, onRecordingStarted, state])

  useEffect(() => cleanup, [cleanup])

  const transcriptWords = useMemo(
    () => segments.join(' ').split(/\s+/).filter(Boolean),
    [segments],
  )
  const transcriptText = useMemo(() => transcriptWords.join(' '), [transcriptWords])

  return {
    generationStatus,
    isRecording: state === 'recording',
    isStarting: state === 'connecting',
    state,
    transcriptText,
    transcriptWords,
    hasTranscript: transcriptWords.length > 0,
    reset,
    start,
    stop,
  }
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
