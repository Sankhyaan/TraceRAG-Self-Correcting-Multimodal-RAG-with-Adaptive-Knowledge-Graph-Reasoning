import { apiFetch, API_BASE } from './apiClient'

export interface Conversation {
  id: string
  title: string
  file_count: number
  message_count?: number
  created_at?: string
  updated_at?: string
  is_demo?: boolean
}


export interface PersistedMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  citations?: any[]
  critic_info?: any
  groundedness_score?: number
  retry_info?: any
  graph_hops?: any[]
  graph_entities?: string[]
  graph_context_text?: string
  created_at: string
}

// In-memory conversations cache — 30s TTL for instant sidebar renders
let _convsCache: Conversation[] | null = null
let _convsCacheExpiry = 0

export function getCachedConversations(): Conversation[] | null {
  if (_convsCache && Date.now() < _convsCacheExpiry) return _convsCache
  return null
}

export function setCachedConversations(list: Conversation[]) {
  _convsCache = list
  _convsCacheExpiry = Date.now() + 30_000
}

export function invalidateConversationsCache() {
  _convsCache = null
  _convsCacheExpiry = 0
}

export async function listConversations(): Promise<Conversation[]> {
  const res = await apiFetch(`${API_BASE}/conversations`)
  if (!res.ok) {
    throw new Error(`Failed to load conversations: ${res.status}`)
  }
  const data = await res.json()
  setCachedConversations(data)
  return data
}

export async function createConversation(title?: string, id?: string): Promise<Conversation> {
  const res = await apiFetch(`${API_BASE}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title || 'New Conversation', id }),
  })
  if (!res.ok) {
    throw new Error(`Failed to create conversation: ${res.status}`)
  }
  const newConv = await res.json()
  const current = getCachedConversations() || []
  setCachedConversations([newConv, ...current.filter((c) => c.id !== newConv.id)])
  return newConv
}


// Per-conversation message cache for instant chat history on tab switch
const _msgsCache: Record<string, PersistedMessage[]> = {}

export function getCachedMessages(conversationId: string): PersistedMessage[] | null {
  return _msgsCache[conversationId] ?? null
}

export function setCachedMessages(conversationId: string, msgs: PersistedMessage[]) {
  _msgsCache[conversationId] = msgs
}

export function invalidateMessagesCache(conversationId: string) {
  delete _msgsCache[conversationId]
}

export async function getConversationMessages(conversationId: string): Promise<PersistedMessage[]> {
  const res = await apiFetch(`${API_BASE}/conversations/${conversationId}/messages`)
  if (!res.ok) {
    throw new Error(`Failed to load messages: ${res.status}`)
  }
  const data = await res.json()
  setCachedMessages(conversationId, data)
  return data
}

export async function clearConversationMessages(conversationId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/conversations/${conversationId}/messages`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    throw new Error(`Failed to clear messages: ${res.status}`)
  }
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) {
    throw new Error(`Failed to rename conversation: ${res.status}`)
  }
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/conversations/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    throw new Error(`Failed to delete conversation: ${res.status}`)
  }
}
