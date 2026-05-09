import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Icosahedron, PointMaterial, Points } from '@react-three/drei'
import { Mic } from 'lucide-react'
import type { Points as ThreePoints } from 'three'
import * as THREE from 'three'
import { navItems, sheetMetadata, specimenChips } from '../lib/mockData'

type LandingHeroProps = {
  onEnterStudio: () => void
}

const THREE_COLORS = {
  ink: '#1A0E08',
  paper: '#E8C5AF',
  accent: '#E85D24',
} as const

const GRAIN_CLASS = 'grain land-grain'
const HERO_CANVAS_CLASS = 'hero-three'

function GrainCanvas({ className }: { className: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const paint = () => {
      const width = canvas.offsetWidth
      const height = canvas.offsetHeight
      canvas.width = width
      canvas.height = height
      const image = ctx.createImageData(width, height)
      for (let i = 0; i < image.data.length; i += 4) {
        const value = Math.floor(Math.random() * 255)
        image.data[i] = value
        image.data[i + 1] = value
        image.data[i + 2] = value
        image.data[i + 3] = 255
      }
      ctx.putImageData(image, 0, 0)
    }

    paint()
    const timer = window.setInterval(paint, 130)
    return () => window.clearInterval(timer)
  }, [])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}

function HeroSculpture({ active }: { active: boolean }) {
  const groupRef = useRef<THREE.Group>(null)
  const pointsRef = useRef<ThreePoints>(null)
  const particlePositions = useRef<Float32Array | null>(null)

  if (!particlePositions.current) {
    const count = 220
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i += 1) {
      const radius = 1.55 + Math.random() * 0.85
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta)
      positions[i * 3 + 2] = radius * Math.cos(phi)
    }
    particlePositions.current = positions
  }

  useFrame(({ clock, pointer }) => {
    const t = clock.elapsedTime
    if (groupRef.current) {
      groupRef.current.rotation.y = t * 0.15 + pointer.x * 0.45
      groupRef.current.rotation.x = pointer.y * 0.2
      groupRef.current.scale.setScalar(1 + Math.sin(t * 1.4) * 0.025 + (active ? 0.08 : 0))
    }
    if (pointsRef.current) {
      pointsRef.current.rotation.y = t * 0.18
      pointsRef.current.rotation.x = -t * 0.06
    }
  })

  return (
    <group ref={groupRef} position={[1.55, -0.05, 0]}>
      <Icosahedron args={[0.86, 1]}>
        <meshBasicMaterial color={THREE_COLORS.ink} transparent opacity={0.92} />
      </Icosahedron>
      <Icosahedron args={[1.08, 2]}>
        <meshBasicMaterial color={THREE_COLORS.ink} wireframe transparent opacity={0.48} />
      </Icosahedron>
      <Icosahedron args={[1.42, 1]}>
        <meshBasicMaterial color={THREE_COLORS.accent} wireframe transparent opacity={0.32} />
      </Icosahedron>
      <Points ref={pointsRef} positions={particlePositions.current ?? new Float32Array()} stride={3}>
        <PointMaterial color={THREE_COLORS.ink} size={0.025} transparent opacity={0.72} sizeAttenuation />
      </Points>
    </group>
  )
}

function MiniLogo() {
  return (
    <Canvas camera={{ position: [0, 0, 2.4], fov: 45 }} dpr={[1, 2]}>
      <mesh rotation={[0.3, 0.6, 0]}>
        <icosahedronGeometry args={[0.7, 0]} />
        <meshBasicMaterial color={THREE_COLORS.paper} wireframe />
      </mesh>
    </Canvas>
  )
}

export function LandingHero({ onEnterStudio }: LandingHeroProps) {
  const [clock, setClock] = useState('')
  const [micHover, setMicHover] = useState(false)

  useEffect(() => {
    const update = () => {
      const date = new Date()
      setClock(`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`)
    }
    update()
    const timer = window.setInterval(update, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <section className="landing">
      <GrainCanvas className={GRAIN_CLASS} />
      <div className={HERO_CANVAS_CLASS} aria-hidden="true">
        <Canvas camera={{ position: [0, 0, 4.2], fov: 45 }} dpr={[1, 2]}>
          <HeroSculpture active={micHover} />
        </Canvas>
      </div>
      <div className="draft-grid" aria-hidden="true" />

      <nav className="landing-nav">
        <div className="brand-lockup">
          <div className="logo-mini">
            <MiniLogo />
          </div>
          <span>bubble</span>
        </div>
        <div className="nav-links" aria-label="Sections">
          {navItems.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
        <div className="nav-actions">
          <span>PARIS · {clock}</span>
          <button type="button" onClick={onEnterStudio}>
            ENTER STUDIO →
          </button>
        </div>
      </nav>

      <div className="metadata-strip">
        <div>
          {sheetMetadata.map((item) => (
            <span key={item.label}><em>{item.label}</em> {item.value}</span>
          ))}
        </div>
        <div>
          <span className="live-label"><i /> STUDIO LIVE</span>
          <span><em>FPS</em> 60</span>
        </div>
      </div>

      <div className="landing-content">
        <div className="hero-copy">
          <div className="eyebrow">
            <i />
            <span>A QUIET PLACE FOR HALF-FORMED IDEAS</span>
          </div>
          <h1>
            <span>tell</span> <span>me</span>{' '}
            <span className="italic">what</span>
            <br />
            <span>you</span> <span>build.</span>
          </h1>
          <p>
            Press the mic and speak like you'd speak to a co-founder. We sketch the architecture,
            live, as the words come out.
          </p>
          <div className="landing-cta">
            <button
              type="button"
              className="mic-cta"
              onClick={onEnterStudio}
              onMouseEnter={() => setMicHover(true)}
              onMouseLeave={() => setMicHover(false)}
            >
              <span className="mic-orb">
                <Mic size={14} strokeWidth={2.4} />
                <i />
              </span>
              <span>Press to talk</span>
              <kbd>SPACE</kbd>
            </button>
            <div>
              <span>OR TYPE</span>
              <strong>just describe it →</strong>
            </div>
          </div>
          <div className="specimens">
            <span>SPECIMENS · BUILT IN STUDIO</span>
            <div>
              {specimenChips.map((chip) => (
                <button type="button" key={chip}>{chip}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="hero-annotation" aria-hidden="true">
          <svg viewBox="0 0 160 82">
            <line x1="0" y1="40" x2="100" y2="40" />
            <circle cx="0" cy="40" r="2" />
            <text x="106" y="36">FIG. A</text>
            <text x="106" y="50">voice → form</text>
            <text x="106" y="64">(move cursor)</text>
          </svg>
        </div>
      </div>
    </section>
  )
}
