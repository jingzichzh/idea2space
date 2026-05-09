const API_BASE_URL = 'http://127.0.0.1:7860'

export type GeneratedArchitectureNode = {
  id: string
  label: string
  type: 'input' | 'hf_model' | 'hf_inference' | 'frontend' | 'backend' | 'data' | 'deployment' | 'agent' | 'guardrail'
  hf_component?: string
  role?: string
  why?: string
  confidence?: number
  hf_tag?: string
}

export type GeneratedArchitectureEdge = {
  source: string
  target: string
  label?: string
}

export type GeneratedArchitecture = {
  summary?: string
  recommended_stack?: string[]
  assumptions?: string[]
  next_steps?: string[]
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
