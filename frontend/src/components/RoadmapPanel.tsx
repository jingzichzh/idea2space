import { roadmapItems } from '../lib/mockData'

type RoadmapPanelProps = {
  visible: boolean
}

export function RoadmapPanel({ visible }: RoadmapPanelProps) {
  return (
    <aside className={`roadmap-panel ${visible ? 'roadmap-panel-visible' : 'roadmap-panel-muted'}`}>
      <header>
        <span>ROADMAP</span>
        <strong>{visible ? 'READY' : 'WAITING'}</strong>
      </header>
      <div className="roadmap-list">
        {roadmapItems.map((step, index) => (
          <article key={step.label}>
            <div>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <b>{visible ? step.status : 'LOCKED'}</b>
            </div>
            <h3>{step.label}</h3>
            <p>{step.detail}</p>
          </article>
        ))}
      </div>
    </aside>
  )
}
