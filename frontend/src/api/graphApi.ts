import { apiFetch, API_BASE } from './apiClient'

export interface GraphNode {
  id: string
  name: string
  canonical_id?: string
  aliases?: string[]
  type: string
  file_ids: string[]
  degree: number
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  relation: string
  evidence: string
  file_id: string
  filename: string
  chunk_id: string
  timestamp?: string | null
  page_number?: number | null
  confidence: number
}

export interface GraphDataResponse {
  conversation_id: string
  node_count: number
  edge_count: number
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface GraphPathHop {
  from_node: string
  from_type: string
  from_id?: string
  relation: string
  to_node: string
  to_type: string
  to_id?: string
  evidence: string
  filename: string
  file_id: string
  timestamp?: string | null
  page_number?: number | null
}

export interface MultiHopResponse {
  is_multihop: boolean
  query: string
  detected_entities: string[]
  paths: GraphPathHop[][]
  graph_context_text: string
}

export async function getGraphData(conversationId: string): Promise<GraphDataResponse> {
  const res = await apiFetch(`${API_BASE}/graph/${conversationId}`)
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || `Failed to fetch graph: ${res.status}`)
  }
  return res.json()
}

export async function traverseGraph(
  conversationId: string,
  query: string = '',
  entityA?: string,
  entityB?: string,
): Promise<MultiHopResponse> {
  const res = await apiFetch(`${API_BASE}/graph/traverse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_id: conversationId,
      query,
      entity_a: entityA || null,
      entity_b: entityB || null,
    }),
  })
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || `Failed to traverse graph: ${res.status}`)
  }
  return res.json()
}

export async function rebuildGraph(conversationId: string): Promise<{ status: string; node_count: number; edge_count: number }> {
  const res = await apiFetch(`${API_BASE}/graph/rebuild/${conversationId}`, {
    method: 'POST',
  })
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || `Failed to rebuild graph: ${res.status}`)
  }
  return res.json()
}
