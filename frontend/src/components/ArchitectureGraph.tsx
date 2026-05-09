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
import { useEffect, useMemo, useRef } from 'react'
import type { GeneratedArchitecture } from '../lib/api'
import { architectureEdges, architectureNodes } from '../lib/mockData'

type ArchitectureGraphProps = {
  generatedArchitecture?: GeneratedArchitecture | null
  visibleNodeIds: string[]
}

type ArchitectureNodeData = {
  label: string
  detail: string
  hfTag?: string
}

const nodeTypes = {
  hfArchitecture: HfArchitectureNode,
}

export function ArchitectureGraph({ generatedArchitecture, visibleNodeIds }: ArchitectureGraphProps) {
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
        position: node.position,
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
    window.requestAnimationFrame(() => {
      flowRef.current?.fitView({ padding: 0.22, duration: 220 })
    })
  }, [generatedLayout, visibleNodeIds])

  return (
    <div className="architecture-flow">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.22 }}
        onInit={(instance) => {
          flowRef.current = instance
          instance.fitView({ padding: 0.22 })
        }}
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
}

function layoutGeneratedArchitecture(architecture: GeneratedArchitecture) {
  const columns = Math.min(5, Math.max(2, Math.ceil(architecture.nodes.length / 2)))
  const columnGap = 210
  const rowGap = 160
  const topOffset = architecture.nodes.length > columns ? 36 : 112
  const nodes: Node<ArchitectureNodeData>[] = architecture.nodes.map((node, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)

    return {
      id: node.id,
      type: 'hfArchitecture',
      position: {
        x: column * columnGap,
        y: topOffset + row * rowGap,
      },
      data: {
        label: node.label,
        detail: node.role || node.type.replace(/_/g, ' '),
        hfTag: node.hf_component || node.hf_tag,
      },
      className: `hf-node ${node.hf_component || node.hf_tag ? 'hf-node-tagged' : ''}`,
    }
  })
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges: Edge[] = architecture.edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge, index) => ({
      id: `generated-edge-${index}-${edge.source}-${edge.target}`,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      animated: true,
      className: 'hf-edge',
    }))

  return { nodes, edges }
}

function HfArchitectureNode({ data }: NodeProps<Node<ArchitectureNodeData>>) {
  return (
    <div className="hf-node-shell">
      <Handle type="target" position={Position.Left} className="hf-handle" />
      <div>
        {data.hfTag && <span className="hf-tag">{data.hfTag}</span>}
        <strong>{data.label}</strong>
        <small>{data.detail}</small>
      </div>
      <Handle type="source" position={Position.Right} className="hf-handle" />
    </div>
  )
}
