import { useCallback, useEffect, useMemo, useState } from 'react'
import { architectureNodes, transcriptSegments } from '../lib/mockData'

export type DemoState = 'idle' | 'recording' | 'generating' | 'complete'

const WORD_INTERVAL_MS = 105
const NODE_INTERVAL_MS = 520

export function useDemoTimeline(autoStart: boolean) {
  const transcriptWords = useMemo(
    () => transcriptSegments.flatMap((segment) => segment.text.split(/\s+/).filter(Boolean)),
    [],
  )
  const [demoState, setDemoState] = useState<DemoState>('idle')
  const [isPaused, setIsPaused] = useState(false)
  const [visibleWordCount, setVisibleWordCount] = useState(0)
  const [visibleNodeCount, setVisibleNodeCount] = useState(0)

  const reset = useCallback(() => {
    setDemoState('idle')
    setIsPaused(false)
    setVisibleWordCount(0)
    setVisibleNodeCount(0)
  }, [])

  const start = useCallback(() => {
    setDemoState('recording')
    setIsPaused(false)
    setVisibleWordCount(0)
    setVisibleNodeCount(1)
  }, [])

  const replay = useCallback(() => {
    start()
  }, [start])

  const togglePause = useCallback(() => {
    if (demoState !== 'idle' && demoState !== 'complete') {
      setIsPaused((paused) => !paused)
    }
  }, [demoState])

  useEffect(() => {
    if (!autoStart) return undefined

    const timer = window.setTimeout(start, 0)
    return () => window.clearTimeout(timer)
  }, [autoStart, start])

  useEffect(() => {
    if (isPaused || demoState !== 'recording') return undefined

    const timer = window.setInterval(() => {
      setVisibleWordCount((count) => {
        const next = Math.min(count + 1, transcriptWords.length)
        if (next >= transcriptWords.length) {
          setDemoState('generating')
        }
        return next
      })
    }, WORD_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [demoState, isPaused, transcriptWords.length])

  useEffect(() => {
    if (isPaused || demoState !== 'generating') return undefined

    const timer = window.setInterval(() => {
      setVisibleNodeCount((count) => {
        const next = Math.min(count + 1, architectureNodes.length)
        if (next >= architectureNodes.length) {
          setDemoState('complete')
        }
        return next
      })
    }, NODE_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [demoState, isPaused])

  const visibleNodeIds = architectureNodes.slice(0, visibleNodeCount).map((node) => node.id)
  const roadmapVisible = demoState === 'complete'
  const statusLabel = getStatusLabel(demoState, isPaused)

  return {
    demoState,
    isPaused,
    roadmapVisible,
    statusLabel,
    transcriptWords,
    visibleArchitectureNodeIds: visibleNodeIds,
    visibleTranscriptWords: transcriptWords.slice(0, visibleWordCount),
    wordCount: visibleWordCount,
    pauseOrResume: togglePause,
    replay,
    reset,
    start,
  }
}

function getStatusLabel(demoState: DemoState, isPaused: boolean) {
  if (isPaused) return 'PAUSED'
  if (demoState === 'idle') return 'READY'
  if (demoState === 'recording') return 'LISTENING / TRANSCRIBING'
  if (demoState === 'generating') return 'GENERATING HF ARCHITECTURE'
  return 'ROADMAP READY'
}
