import { getAccessToken } from './authApi'

const _RAW_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/+$/, '')
export const API_BASE = `${_RAW_BASE}/api`

/**
 * Wrapper around fetch() that automatically:
 * - Injects the Supabase JWT Bearer token (cached in memory with 55s TTL in authApi)
 * - Aborts after timeoutMs (default 10s) so requests never hang forever
 */
export async function apiFetch(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 60_000
): Promise<Response> {

  const token = await getAccessToken()
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }


  // Upload requests need more time
  const isUpload = init.method === 'POST' && init.body instanceof FormData
  const effectiveTimeout = isUpload ? 120_000 : timeoutMs

  const controller = new AbortController()
  const timerId = setTimeout(() => controller.abort(), effectiveTimeout)

  try {
    const response = await fetch(input, {
      ...init,
      headers,
      signal: controller.signal,
    })
    return response
  } finally {
    clearTimeout(timerId)
  }
}
