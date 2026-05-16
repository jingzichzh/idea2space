import { memo } from 'react'
import { transcriptTags } from '../lib/mockData'
import { Waveform } from './Waveform'

type LiveTranscriptProps = {
  active?: boolean
  audioLevel?: number
  statusLabel: string
  visibleWords: string[]
  wordCount: number
  waveformLabel?: string
}

export const LiveTranscript = memo(function LiveTranscript({
  active = false,
  audioLevel = 0,
  statusLabel,
  visibleWords,
  wordCount,
  waveformLabel,
}: LiveTranscriptProps) {
  return (
    <aside className="transcript-panel">
      <header>
        <div>
          <i className="rec-dot" />
          <span>Live transcript</span>
        </div>
        <span>{wordCount} W / {statusLabel}</span>
      </header>

      <div className="transcript-scroll">
        <p className="transcript-copy live-copy">
          {visibleWords.length > 0 ? visibleWords.join(' ') : <span>{statusLabel}</span>}
          {active && <b className="cursor">|</b>}
        </p>
      </div>

      <div className="waveform-wrap">
        <div>
          <span>WAVEFORM</span>
          <span>{waveformLabel ?? (active || wordCount > 0 ? '-12 dB' : 'armed')}</span>
        </div>
        <Waveform active={active} audioLevel={audioLevel} />
      </div>

      <footer>
        {transcriptTags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </footer>
    </aside>
  )
})
