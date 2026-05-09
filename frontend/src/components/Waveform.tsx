import { useEffect, useRef } from 'react'

type WaveformProps = {
  active?: boolean
}

export function Waveform({ active = true }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    let frame = 0
    let raf = 0
    const draw = () => {
      const width = canvas.offsetWidth * 2
      const height = canvas.offsetHeight * 2
      canvas.width = width
      canvas.height = height
      context.clearRect(0, 0, width, height)
      context.strokeStyle = '#1A0E08'
      context.lineWidth = 1.2
      context.beginPath()

      const bars = 64
      const barWidth = width / bars
      for (let i = 0; i < bars; i += 1) {
        const envelope = active ? Math.sin(i * 0.3 + frame * 0.05) * 0.4 + 0.5 : 0.16
        const detail = active ? Math.sin(i * 1.7 + frame * 0.2) * 0.3 : 0
        const noise = active ? (Math.random() - 0.5) * 0.35 : 0
        const amplitude = Math.max(0.08, Math.min(1, envelope + detail + noise))
        const barHeight = amplitude * height * 0.85
        const x = i * barWidth + barWidth / 2
        context.moveTo(x, height / 2 - barHeight / 2)
        context.lineTo(x, height / 2 + barHeight / 2)
      }

      context.stroke()
      frame += 1
      raf = window.requestAnimationFrame(draw)
    }

    draw()
    return () => window.cancelAnimationFrame(raf)
  }, [active])

  return <canvas className="waveform-canvas" ref={canvasRef} aria-label="Mock live waveform" />
}
