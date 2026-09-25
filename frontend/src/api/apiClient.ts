import { getAccessToken } from './authApi'

export function getApiBase(): string {
  if (typeof window !== 'undefined' && window.location.hostname) {
    const protocol = window.location.protocol || 'http:'
    const hostname = window.location.hostname
    return `${protocol}//${hostname}:8001/api`
  }
  if (import.meta.env.VITE_API_URL) {
    return `${import.meta.env.VITE_API_URL.replace(/\/+$/, '')}/api`
  }
  return 'http://localhost:8001/api'
}

export const API_BASE = getApiBase()

/**
 * Wrapper around fetch() that automatically:
 * - Dynamically rewrites any obsolete hostnames or static IPs to the active browser host
 * - Injects the Supabase JWT Bearer token
 * - Aborts after timeoutMs so requests never hang
 */
export async function apiFetch(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 60_000
): Promise<Response> {
  let targetUrl = input.toString()

  // Dynamically rewrite obsolete IPs or localhost to current browser hostname if accessing over cloud network
  if (typeof window !== 'undefined' && window.location.hostname) {
    const currentHost = window.location.hostname
    const currentProto = window.location.protocol || 'http:'
    targetUrl = targetUrl.replace(
      /http:\/\/(?:65\.2\.37\.39|localhost|127\.0\.0\.1):8001/g,
      `${currentProto}//${currentHost}:8001`
    )
  }

  const token = await getAccessToken()
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const isUpload = init.method === 'POST' && init.body instanceof FormData
  const effectiveTimeout = isUpload ? 120_000 : timeoutMs

  const controller = new AbortController()
  const timerId = setTimeout(() => controller.abort(), effectiveTimeout)

  try {
    const response = await fetch(targetUrl, {
      ...init,
      headers,
      signal: controller.signal,
    })
    return response
  } finally {
    clearTimeout(timerId)
  }
}
