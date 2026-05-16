import {
  Handle,
  Position,
  ReactFlow,
  type ReactFlowInstance,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { memo, type MouseEvent, useEffect, useMemo, useRef } from 'react'
import type { GeneratedArchitecture, GeneratedArchitectureNode, RecommendedHfAsset } from '../lib/api'
import { architectureEdges, architectureNodes } from '../lib/mockData'

type ArchitectureGraphProps = {
  generatedArchitecture?: GeneratedArchitecture | null
  visibleNodeIds: string[]
}

type ArchitectureNodeData = {
  label: string
  detail: string
  hfTag?: string
  linkedAsset?: RecommendedHfAsset
  stageLabel?: string
  stageIndex?: number
}

const nodeTypes = {
  hfArchitecture: HfArchitectureNode,
}

export const ArchitectureGraph = memo(function ArchitectureGraph({ generatedArchitecture, visibleNodeIds }: ArchitectureGraphProps) {
  const flowRef = useRef<ReactFlowInstance<Node<ArchitectureNodeData>, Edge> | null>(null)
  const visibleIds = useMemo(() => new Set(visibleNodeIds), [visibleNodeIds])
  const generatedLayout = useMemo(
    () => generatedArchitecture ? layoutGeneratedArchitecture(generatedArchitecture) : null,
    [generatedArchitecture],
  )
  const nodes: Node<ArchitectureNodeData>[] = useMemo(
    () => {
      if (generatedLayout) return generatedLayout.nodes

      return architectureNodes
        .filter((node) => visibleIds.has(node.id))
        .map((node) => ({
        id: node.id,
        type: 'hfArchitecture',
        position: {
          x: node.position.x * 1.55,
          y: node.position.y * 1.45,
        },
        data: {
          label: node.label,
          detail: node.detail,
          hfTag: node.hfTag,
        },
        className: `hf-node ${node.hfTag ? 'hf-node-tagged' : ''}`,
        }))
    },
    [generatedLayout, visibleIds],
  )

  const edges: Edge[] = useMemo(
    () => {
      if (generatedLayout) return generatedLayout.edges

      return architectureEdges
        .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
        .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        animated: true,
        className: 'hf-edge',
        }))
    },
    [generatedLayout, visibleIds],
  )

  useEffect(() => {
    const fit = () => flowRef.current?.fitView({ padding: 0.24, duration: 220, maxZoom: 0.92 })
    const firstFrame = window.requestAnimationFrame(() => {
      fit()
      window.setTimeout(fit, 80)
    })
    return () => window.cancelAnimationFrame(firstFrame)
  }, [generatedLayout, visibleNodeIds])

  return (
    <div className="architecture-flow">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.24, maxZoom: 0.92 }}
        onInit={(instance) => {
          flowRef.current = instance
          instance.fitView({ padding: 0.24, maxZoom: 0.92 })
        }}
        minZoom={0.45}
        maxZoom={1.35}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
      />
      <div className="flow-legend">
        <span>{nodes.length} / {generatedLayout ? nodes.length : architectureNodes.length} NODES</span>
        <span>{edges.length} LIVE EDGES</span>
      </div>
    </div>
  )
})

function layoutGeneratedArchitecture(architecture: GeneratedArchitecture) {
  const displayNodes = selectDisplayNodes(architecture.nodes)
  const stageCounts = new Map<number, number>()
  const columnGap = 315
  const rowGap = 176
  const nodes: Node<ArchitectureNodeData>[] = displayNodes.map((node, index) => {
    const linkedAsset = findAssetForNode(node, architecture.recommended_hf_assets ?? [])
    const stageIndex = inferStageIndex(node, index, displayNodes.length)
    const stageRow = stageCounts.get(stageIndex) ?? 0
    stageCounts.set(stageIndex, stageRow + 1)

    return {
      id: node.id,
      type: 'hfArchitecture',
      position: {
        x: stageIndex * columnGap,
        y: 78 + stageRow * rowGap,
      },
      data: {
        label: node.label,
        detail: conciseDetail(node.role || node.why || node.type.replace(/_/g, ' ')),
        hfTag: node.hf_component || node.hf_tag,
        linkedAsset,
        stageLabel: stageLabel(stageIndex),
        stageIndex,
      },
      className: `hf-node hf-node-stage-${stageIndex} ${node.hf_component || node.hf_tag ? 'hf-node-tagged' : ''} ${linkedAsset ? 'hf-node-linked' : ''}`,
    }
  })
  const nodeIds = new Set(nodes.map((node) => node.id))
  const sourceEdges = architecture.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
  const edgesToRender = sourceEdges.length >= Math.max(1, nodes.length - 2)
    ? sourceEdges
    : nodes.slice(0, -1).map((node, index) => ({
      source: node.id,
      target: nodes[index + 1].id,
      label: 'next',
    }))
  const edges: Edge[] = edgesToRender
    .map((edge, index) => ({
      id: `generated-edge-${index}-${edge.source}-${edge.target}`,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type: 'smoothstep',
      animated: false,
      className: 'hf-edge',
    }))

  return { nodes, edges }
}

function HfArchitectureNode({ data }: NodeProps<Node<ArchitectureNodeData>>) {
  const linkedAsset = hasValidAssetUrl(data.linkedAsset) ? data.linkedAsset : undefined
  const stopFlowClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation()
  }
  const openAsset = () => {
    if (!linkedAsset) return
    window.open(linkedAsset.url, '_blank', 'noopener,noreferrer')
  }
  const content = (
    <>
      <Handle type="target" position={Position.Left} className="hf-handle" />
      <div>
        <span className="hf-stage-label">{data.stageLabel}</span>
        <strong>{data.label}</strong>
        <small>{data.detail}</small>
        {linkedAsset && (
          <span className="hf-asset-chip">
            <b>{linkedAsset.source === 'hf_hub_search' ? 'HUB SEARCH' : 'CURATED'}</b>
            <em>{linkedAsset.type}</em>
            <i>{linkedAsset.name}</i>
            <a
              href={linkedAsset.url}
              target="_blank"
              rel="noreferrer"
              onClick={stopFlowClick}
              onMouseDown={stopFlowClick}
              title={`Open ${linkedAsset.name} on Hugging Face`}
            >
              OPEN
            </a>
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="hf-handle" />
    </>
  )

  return (
    <div
      className={`hf-node-shell hf-node-shell-stage-${data.stageIndex ?? 0} ${linkedAsset ? 'hf-node-shell-linked' : ''}`}
      onClick={openAsset}
      role={linkedAsset ? 'link' : undefined}
      tabIndex={linkedAsset ? 0 : undefined}
      onKeyDown={(event) => {
        if (linkedAsset && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          openAsset()
        }
      }}
    >
      {content}
    </div>
  )
}

function selectDisplayNodes(nodes: GeneratedArchitectureNode[]) {
  const selected: GeneratedArchitectureNode[] = []
  const addFirst = (predicate: (node: GeneratedArchitectureNode) => boolean) => {
    const match = nodes.find((node) => predicate(node) && !selected.some((selectedNode) => selectedNode.id === node.id))
    if (match) selected.push(match)
  }

  addFirst((node) => node.type === 'input')
  addFirst((node) => containsAny(nodeText(node), ['whisper', 'asr', 'transcrib', 'convert', 'speech']))
  addFirst((node) => node.type === 'hf_model' || node.type === 'hf_inference')
  addFirst((node) => node.type === 'agent' || containsAny(nodeText(node), ['agent', 'mcp', 'tool']))
  addFirst((node) => node.type === 'backend' || node.type === 'data')
  addFirst((node) => node.type === 'frontend')
  addFirst((node) => node.type === 'deployment')

  for (const node of nodes) {
    if (selected.length >= 7) break
    if (!selected.some((selectedNode) => selectedNode.id === node.id)) selected.push(node)
  }

  return selected.slice(0, 7)
}

function inferStageIndex(node: GeneratedArchitectureNode, index: number, total: number) {
  const text = nodeText(node)
  if (node.type === 'input' || containsAny(text, ['microphone', 'input', 'upload'])) return 0
  if (containsAny(text, ['whisper', 'asr', 'transcrib', 'convert', 'speech'])) return 1
  if (node.type === 'hf_model' || node.type === 'hf_inference' || node.type === 'backend' || node.type === 'agent' || node.type === 'data') return 2
  if (node.type === 'frontend' || node.type === 'deployment') return 3
  if (node.type === 'guardrail') return 4
  return Math.min(3, Math.floor((index / Math.max(1, total - 1)) * 4))
}

function stageLabel(index: number) {
  return ['A / Input', 'B / Convert', 'C / Generate', 'D / Deliver', 'Utility'][index] ?? 'Flow'
}

function conciseDetail(value: string) {
  const cleaned = value.trim()
  if (cleaned.length <= 86) return cleaned
  return `${cleaned.slice(0, 83).trim()}...`
}

function nodeText(node: GeneratedArchitectureNode) {
  return [node.id, node.label, node.type, node.hf_component, node.role, node.why, node.hf_tag].join(' ').toLowerCase()
}

function hasValidAssetUrl(asset: RecommendedHfAsset | undefined): asset is RecommendedHfAsset {
  return Boolean(asset?.url?.trim())
}

function findAssetForNode(node: GeneratedArchitectureNode, assets: RecommendedHfAsset[]) {
  const directAsset = firstAsset([
    ...(node.recommended_assets ?? []),
    ...assets.filter((asset) => asset.attach_to_node_id === node.id),
  ])
  if (directAsset) return directAsset

  const scored = assets
    .map((asset) => ({ asset, score: scoreAssetForNode(asset, node) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)

  return scored[0]?.asset
}

function firstAsset(assets: RecommendedHfAsset[]) {
  return assets.find((asset) => Boolean(asset.url))
}

function scoreAssetForNode(asset: RecommendedHfAsset, node: GeneratedArchitectureNode) {
  const nodeText = [
    node.id,
    node.label,
    node.type,
    node.hf_component,
    node.role,
    node.why,
    node.hf_tag,
  ].join(' ').toLowerCase()
  const assetText = [
    asset.name,
    asset.hf_id,
    asset.type,
    asset.role,
    asset.why_relevant,
    asset.use_mode,
    ...(asset.tags ?? []),
  ].join(' ').toLowerCase()

  let score = 0
  if (asset.type === 'model' && node.type === 'hf_model') score += 5
  if (asset.type === 'space' && node.type === 'deployment') score += 4
  if (asset.type === 'doc' && (node.type === 'deployment' || node.type === 'agent')) score += 2
  if (asset.type === 'tool' && node.type === 'agent') score += 5
  if (containsAny(nodeText, ['whisper', 'asr', 'speech', 'transcrib', 'audio']) && containsAny(assetText, ['whisper', 'speech', 'transcription', 'asr'])) score += 8
  if (containsAny(nodeText, ['text generation', 'generator', 'prompt', 'llm']) && containsAny(assetText, ['text-generation', 'text generation', 'qwen', 'llm', 'instruct'])) score += 6
  if (containsAny(nodeText, ['space', 'deployment', 'hosted app']) && containsAny(assetText, ['space', 'spaces', 'gradio'])) score += 5
  if (containsAny(nodeText, ['mcp', 'agent', 'tool']) && containsAny(assetText, ['mcp', 'agent', 'tool'])) score += 8
  if (containsAny(nodeText, ['rag', 'retrieval', 'document', 'pdf']) && containsAny(assetText, ['rag', 'retrieval', 'document', 'pdf', 'sentence-transformers'])) score += 7
  if (containsAny(nodeText, ['image', 'vision', 'visual']) && containsAny(assetText, ['vision', 'image', 'vl', 'visual'])) score += 7

  return score
}

function containsAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term))
}
