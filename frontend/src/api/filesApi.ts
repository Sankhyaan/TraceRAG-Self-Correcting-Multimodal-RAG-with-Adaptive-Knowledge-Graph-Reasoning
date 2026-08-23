import { apiFetch, API_BASE } from './apiClient'

export interface FileItem {
  id: string
  conversation_id: string
  filename: string
  file_type: 'document' | 'image' | 'audio' | 'video'
  storage_path: string
  storage_url: string
  file_size_bytes: number
  mime_type?: string
  extracted_text?: string | null
  status?: 'pending' | 'processing' | 'done' | 'failed'
  extraction_error?: string | null
  uploaded_at: string
}

export interface ListFilesResponse {
  conversation_id: string
  files: FileItem[]
  total: number
  by_type: {
    document: number
    image: number
    audio: number
    video: number
  }
}

export interface ExtractedContentResponse {
  file_id: string
  filename: string
  file_type: string
  status: string
  extracted_text?: string | null
  extraction_error?: string | null
  uploaded_at?: string
}

// In-memory cache for instant tab switches without 0-count flash
const filesCache: Record<string, ListFilesResponse> = {}

export function getCachedFiles(conversationId: string, fileType: string = 'all'): ListFilesResponse | null {
  const key = `${conversationId}:${fileType}`
  return filesCache[key] || null
}

export function setCachedFiles(conversationId: string, fileType: string = 'all', data: ListFilesResponse) {
  const key = `${conversationId}:${fileType}`
  filesCache[key] = data
}

export function clearFilesCache(conversationId?: string) {
  if (conversationId) {
    Object.keys(filesCache).forEach((k) => {
      if (k.startsWith(conversationId)) delete filesCache[k]
    })
  } else {
    Object.keys(filesCache).forEach((k) => delete filesCache[k])
  }
}

export async function uploadFiles(
  conversationId: string,
  files: File[],
): Promise<{ uploaded: FileItem[]; errors: any[]; count: number }> {
  const formData = new FormData()
  formData.append('conversation_id', conversationId)
  files.forEach((file) => formData.append('files', file))

  const res = await apiFetch(`${API_BASE}/files/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || `Upload failed with status ${res.status}`)
  }

  clearFilesCache(conversationId)
  return res.json()
}

export async function listFiles(
  conversationId: string,
  fileType?: string,
): Promise<ListFilesResponse> {
  const url = new URL(`${API_BASE}/files`)
  url.searchParams.set('conversation_id', conversationId)
  if (fileType && fileType !== 'all') {
    url.searchParams.set('file_type', fileType)
  }

  const res = await apiFetch(url.toString())
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || `Failed to fetch files: ${res.status}`)
  }

  const data: ListFilesResponse = await res.json()
  setCachedFiles(conversationId, fileType || 'all', data)
  return data
}

export async function getFileSignedUrl(fileId: string): Promise<string> {
  const res = await apiFetch(`${API_BASE}/files/${fileId}/url`)
  if (!res.ok) {
    throw new Error(`Failed to get file URL: ${res.status}`)
  }
  const data = await res.json()
  return data.signed_url
}

export async function getExtractedText(fileId: string): Promise<ExtractedContentResponse> {
  const res = await apiFetch(`${API_BASE}/files/${fileId}/extracted`)
  if (!res.ok) {
    throw new Error(`Failed to fetch extracted text: ${res.status}`)
  }
  return res.json()
}

export async function deleteFile(fileId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/files/${fileId}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || `Failed to delete file: ${res.status}`)
  }
}

export async function clearConversationFiles(conversationId: string): Promise<number> {
  const res = await apiFetch(`${API_BASE}/files/conversation/${conversationId}/clear`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || `Failed to clear files: ${res.status}`)
  }
  const data = await res.json()
  return data.deleted_count
}

export async function reExtractFile(fileId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/files/${fileId}/re-extract`, {
    method: 'POST',
  })
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || `Failed to re-extract file: ${res.status}`)
  }
}
