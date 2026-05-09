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
import { architectureEdges, architectureNodes } from '../lib/mockData'

type ArchitectureGraphProps = {
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

export function ArchitectureGraph({ visibleNodeIds }: ArchitectureGraphProps) {
  const flowRef = useRef<ReactFlowInstance<Node<ArchitectureNodeData>, Edge> | null>(null)
  const visibleIds = useMemo(() => new Set(visibleNodeIds), [visibleNodeIds])
  const nodes: Node<ArchitectureNodeData>[] = useMemo(
    () => architectureNodes
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
      })),
    [visibleIds],
  )

  const edges: Edge[] = useMemo(
    () => architectureEdges
      .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        animated: true,
        className: 'hf-edge',
      })),
    [visibleIds],
  )

  useEffect(() => {
    window.requestAnimationFrame(() => {
      flowRef.current?.fitView({ padding: 0.22, duration: 220 })
    })
  }, [visibleNodeIds])

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
        <span>{nodes.length} / {architectureNodes.length} NODES</span>
        <span>{edges.length} LIVE EDGES</span>
      </div>
    </div>
  )
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
