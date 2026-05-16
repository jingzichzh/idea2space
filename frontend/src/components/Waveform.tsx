import { memo, useEffect, useRef } from 'react'

type WaveformProps = {
  active?: boolean
  audioLevel?: number
}

export const Waveform = memo(function Waveform({ active = true, audioLevel }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioLevelRef = useRef(audioLevel)

  useEffect(() => {
    audioLevelRef.current = audioLevel
  }, [audioLevel])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    let frame = 0
    let raf = 0
    const draw = () => {
      const width = canvas.width
      const height = canvas.height
      context.clearRect(0, 0, width, height)
      context.strokeStyle = '#1A0E08'
      context.lineWidth = 1.2
      context.beginPath()

      const bars = 64
      const barWidth = width / bars
      const liveLevel = audioLevelRef.current ?? (active ? 0.5 : 0)
      for (let i = 0; i < bars; i += 1) {
        const envelope = active ? Math.sin(i * 0.3 + frame * 0.05) * 0.25 + 0.65 : 0.16
        const detail = active ? Math.sin(i * 1.7 + frame * 0.2) * 0.18 : 0
        const amplitude = Math.max(0.06, Math.min(1, (envelope + detail) * liveLevel))
        const barHeight = amplitude * height * 0.85
        const x = i * barWidth + barWidth / 2
        context.moveTo(x, height / 2 - barHeight / 2)
        context.lineTo(x, height / 2 + barHeight / 2)
      }

      context.stroke()
      frame += 1
      raf = window.requestAnimationFrame(draw)
    }

    const resize = () => {
      canvas.width = Math.max(1, canvas.offsetWidth * 2)
      canvas.height = Math.max(1, canvas.offsetHeight * 2)
    }

    resize()
    draw()
    window.addEventListener('resize', resize)
    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [active])

  return <canvas className="waveform-canvas" ref={canvasRef} aria-label="Audio level waveform" />
})
