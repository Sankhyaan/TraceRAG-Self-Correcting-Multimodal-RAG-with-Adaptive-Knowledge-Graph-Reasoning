import { apiFetch, API_BASE } from './apiClient'

export interface CriticResult {
  confidence: 'high' | 'medium' | 'low'
  reason: string
  missing_aspects: string[]
  should_retry: boolean
}

export interface CitationVerification {
  passage_number: number
  claim_text: string
  evidence_quote: string
  is_grounded: boolean
  status: 'VERIFIED' | 'UNSUPPORTED' | 'CONTRADICTED'
  filename?: string
  file_id?: string
  page_number?: number
  timestamp?: string
}

export interface RetryInfo {
  retried: boolean
  original_query: string
  reformulated_query?: string
  reason?: string
  initial_confidence?: string
}

export interface SynthesisResult {
  query: string
  conversation_id: string
  answer: string
  confidence: 'high' | 'medium' | 'low'
  critic: CriticResult
  retry_info: RetryInfo
  citations: CitationVerification[]
  groundedness_score: number
  chunks: Array<{
    chunk_id: string
    file_id: string
    filename: string
    file_type: string
    page_number?: number
    timestamp?: string
    text: string
    final_score: number
  }>
  graph_hops?: Array<{
    from_node: string
    from_type: string
    relation: string
    to_node: string
    to_type: string
    evidence: string
    filename: string
    page_number?: number
    timestamp?: string
  }>
  graph_entities?: string[]
  graph_context_text?: string
  routed_categories: string[]
}

export interface PipelineProgressEvent {
  stage: 'route' | 'retrieve' | 'graph' | 'confidence' | 'retry' | 'answer' | 'verify' | 'done' | 'error'
  categories?: string[]
  intent_label?: string
  explanation?: string
  chunks_count?: number
  chunks?: any[]
  hops_count?: number
  graph_hops?: any[]
  graph_entities?: string[]
  confidence?: 'high' | 'medium' | 'low'
  reason?: string
  missing_aspects?: string[]
  should_retry?: boolean
  retry_info?: RetryInfo
  answer?: string
  citations?: CitationVerification[]
  groundedness_score?: number
  result?: SynthesisResult
  error?: string
}

export async function queryAndSynthesize(
  conversationId: string,
  query: string,
  topK: number = 5,
  alpha: number = 0.5,
  useRouter: boolean = true
): Promise<SynthesisResult> {
  const res = await apiFetch(`${API_BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_id: conversationId,
      query,
      top_k: topK,
      alpha,
      use_router: useRouter,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Query failed with status ${res.status}`)
  }

  return res.json()
}

export async function queryAndSynthesizeStream(
  conversationId: string,
  query: string,
  onEvent: (event: PipelineProgressEvent) => void,
  topK: number = 5,
  alpha: number = 0.5,
  useRouter: boolean = true
): Promise<SynthesisResult> {
  const res = await apiFetch(`${API_BASE}/query/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_id: conversationId,
      query,
      top_k: topK,
      alpha,
      use_router: useRouter,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Stream request failed: ${res.status}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('ReadableStream not supported.')

  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let finalResult: SynthesisResult | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''

    for (const block of parts) {
      if (!block.trim()) continue
      const dataMatch = block.match(/data:\s*([\s\S]+)$/)
      if (dataMatch) {
        try {
          const payload = JSON.parse(dataMatch[1].trim()) as PipelineProgressEvent
          onEvent(payload)
          if (payload.stage === 'done' && payload.result) {
            finalResult = payload.result
          }
        } catch (e) {
          console.warn('Failed to parse SSE payload:', e)
        }
      }
    }
  }

  if (finalResult) return finalResult
  throw new Error('Stream finished without final result.')
}
