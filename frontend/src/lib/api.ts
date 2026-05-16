const API_BASE_URL = 'http://127.0.0.1:7860'

export type RecommendedHfAsset = {
  name: string
  type: 'space' | 'model' | 'dataset' | 'doc' | 'tool'
  hf_id: string
  url: string
  role: string
  why_relevant: string
  use_mode: 'fork' | 'reference' | 'connect_as_tool' | 'use_model' | 'dataset_source'
  agent_ready: boolean
  mcp_ready: boolean
  confidence: 'high' | 'medium' | 'low'
  source?: 'hf_hub_search' | 'curated_catalog'
  likes?: number
  downloads?: number
  tags?: string[]
  attach_to_node_id: string
  note?: string
}

export type GeneratedArchitectureNode = {
  id: string
  label: string
  type: 'input' | 'hf_model' | 'hf_inference' | 'frontend' | 'backend' | 'data' | 'deployment' | 'agent' | 'guardrail'
  hf_component?: string
  role?: string
  why?: string
  confidence?: number
  hf_tag?: string
  recommended_assets?: RecommendedHfAsset[]
}

export type GeneratedArchitectureEdge = {
  source: string
  target: string
  label?: string
}

export type GeneratedArchitecture = {
  summary?: string
  recommended_stack?: string[]
  recommended_hf_assets?: RecommendedHfAsset[]
  assumptions?: string[]
  next_steps?: string[]
  build_prompt?: string
  product_name: string
  one_liner: string
  user_input_summary: string
  recommended_hf_stack: Array<{
    layer: string
    component: string
    hf_ecosystem: string
    reason: string
  }>
  nodes: GeneratedArchitectureNode[]
  edges: GeneratedArchitectureEdge[]
  roadmap: Array<{
    phase: string
    tasks: string[]
  }>
}

export type GenerateArchitectureResponse = {
  type: 'architecture'
  source: 'hf_llm' | 'mock'
  prompt_version?: string
  architecture: GeneratedArchitecture
}

export async function generateArchitecture(transcript: string): Promise<GenerateArchitectureResponse> {
  const response = await fetch(`${API_BASE_URL}/api/generate-architecture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ transcript }),
  })

  if (!response.ok) {
    throw new Error(`Architecture generation failed: ${response.status}`)
  }

  return response.json() as Promise<GenerateArchitectureResponse>
}
