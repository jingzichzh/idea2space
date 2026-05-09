export const TRANSCRIBE_WS_URL = 'ws://127.0.0.1:7860/ws/transcribe'

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

export function createTranscriptionSocket(url = TRANSCRIBE_WS_URL) {
  return new WebSocket(url)
}
