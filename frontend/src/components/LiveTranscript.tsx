import { transcriptTags } from '../lib/mockData'
import { Waveform } from './Waveform'

type LiveTranscriptProps = {
  active?: boolean
  statusLabel: string
  visibleWords: string[]
  wordCount: number
}

export function LiveTranscript({ active = false, statusLabel, visibleWords, wordCount }: LiveTranscriptProps) {
  return (
    <aside className="transcript-panel">
      <header>
        <div>
          <i className="rec-dot" />
          <span>{statusLabel}</span>
        </div>
        <span>{wordCount} W · EN-US</span>
      </header>

      <p className="transcript-copy live-copy">
        {visibleWords.join(' ')}
        <b className="cursor">█</b>
      </p>

      <div className="waveform-wrap">
        <div>
          <span>WAVEFORM</span>
          <span>{active || wordCount > 0 ? '-12 dB' : 'armed'}</span>
        </div>
        <Waveform active={active || wordCount > 0} />
      </div>

      <footer>
        {transcriptTags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </footer>
    </aside>
  )
}
