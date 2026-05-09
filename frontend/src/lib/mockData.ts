export type TranscriptSegment = {
  id: string
  text: string
  opacity?: number
}

export type ArchitectureNode = {
  id: string
  label: string
  detail: string
  position: {
    x: number
    y: number
  }
  hfTag?: string
}

export type ArchitectureEdge = {
  id: string
  source: string
  target: string
  label?: string
}

export type RoadmapItem = {
  label: string
  detail: string
  status: 'READY' | 'NEXT' | 'SOON'
}

export const transcriptSegments: TranscriptSegment[] = [
  {
    id: 'intent',
    text: 'I want to build a voice-first product studio where founders can describe an idea out loud and watch the system turn it into a working architecture.',
  },
  {
    id: 'constraints',
    text: 'The first version should transcribe the idea, detect product requirements, recommend Hugging Face models and Spaces, then generate a roadmap the team can actually follow.',
    opacity: 0.85,
  },
  {
    id: 'tone',
    text: 'Make it feel like an atelier for software: calm, precise, technical, and fast enough to demo in a room.',
    opacity: 0.72,
  },
]

export const transcriptTags = ['whisper-large-v3', 'mock-stream', 'no-mic']

export const specimenChips = [
  'voice-first studio',
  'HF Spaces planner',
  'architecture canvas',
  '+ 47 more',
]

export const navItems = ['WORK', 'STUDIO', 'MANIFESTO', 'CHANGELOG']

export const sheetMetadata = [
  { label: 'SHEET', value: '00 / HERO' },
  { label: 'REV', value: '2026.05.A' },
  { label: 'SCALE', value: '1:1' },
]

export const architectureNodes: ArchitectureNode[] = [
  {
    id: 'voice-input',
    label: 'Voice Input',
    detail: 'Mock audio intent',
    position: { x: 0, y: 118 },
  },
  {
    id: 'whisper-asr',
    label: 'Whisper ASR',
    detail: 'Speech to transcript',
    position: { x: 210, y: 118 },
    hfTag: 'HF ASR',
  },
  {
    id: 'idea-parser',
    label: 'Product Idea Parser',
    detail: 'Requirements, audience, constraints',
    position: { x: 430, y: 36 },
  },
  {
    id: 'hf-recommender',
    label: 'HF Ecosystem Recommender',
    detail: 'Models, Spaces, datasets',
    position: { x: 430, y: 198 },
    hfTag: 'HF HUB',
  },
  {
    id: 'architecture-json',
    label: 'Architecture JSON',
    detail: 'Typed graph contract',
    position: { x: 700, y: 36 },
  },
  {
    id: 'react-flow-canvas',
    label: 'React Flow Canvas',
    detail: 'Interactive architecture sheet',
    position: { x: 700, y: 198 },
  },
  {
    id: 'roadmap-generator',
    label: 'Roadmap Generator',
    detail: 'Build plan and milestones',
    position: { x: 960, y: 118 },
  },
  {
    id: 'hf-docker-space',
    label: 'HF Docker Space',
    detail: 'Deployable demo surface',
    position: { x: 1210, y: 118 },
    hfTag: 'HF SPACE',
  },
]

export const architectureEdges: ArchitectureEdge[] = [
  { id: 'voice-to-asr', source: 'voice-input', target: 'whisper-asr', label: 'audio' },
  { id: 'asr-to-parser', source: 'whisper-asr', target: 'idea-parser', label: 'transcript' },
  { id: 'asr-to-recommender', source: 'whisper-asr', target: 'hf-recommender', label: 'intent' },
  { id: 'parser-to-json', source: 'idea-parser', target: 'architecture-json', label: 'schema' },
  { id: 'recommender-to-canvas', source: 'hf-recommender', target: 'react-flow-canvas', label: 'components' },
  { id: 'json-to-roadmap', source: 'architecture-json', target: 'roadmap-generator' },
  { id: 'canvas-to-roadmap', source: 'react-flow-canvas', target: 'roadmap-generator' },
  { id: 'roadmap-to-space', source: 'roadmap-generator', target: 'hf-docker-space', label: 'ship' },
]

export const roadmapItems: RoadmapItem[] = [
  {
    label: 'Prototype Shell',
    detail: 'Lock landing, studio timeline, transcript replay, and React Flow architecture canvas.',
    status: 'READY',
  },
  {
    label: 'HF Planning Layer',
    detail: 'Mock model recommendations, Space template choices, and architecture JSON validation.',
    status: 'NEXT',
  },
  {
    label: 'Deployable Demo',
    detail: 'Package the studio as a Docker Space with mocked API seams ready for real integrations later.',
    status: 'SOON',
  },
]

export const studioMeta = [
  { label: 'VERSION', value: 'v0.5.0' },
  { label: 'ITERATION', value: '08 / 12' },
  { label: 'BUILD', value: 'phase-1' },
]
