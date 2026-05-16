const LOCAL_BACKEND_HOST = '127.0.0.1:7860'
const TRANSCRIBE_WS_PATH = '/ws/transcribe'

export type TranscriptSocketMessage =
  | {
      type: 'transcript'
      text: string
      is_final: boolean
      source?: 'hf_asr' | 'mock'
    }
  | {
      type: 'generation_status'
      status: string
    }
  | {
      type: 'error'
      message?: string
      detail?: string
    }

export function getTranscriptionSocketUrl() {
  if (import.meta.env.DEV) {
    return `ws://${LOCAL_BACKEND_HOST}${TRANSCRIBE_WS_PATH}`
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${TRANSCRIBE_WS_PATH}`
}

export function createTranscriptionSocket(url = getTranscriptionSocketUrl()) {
  return new WebSocket(url)
}
