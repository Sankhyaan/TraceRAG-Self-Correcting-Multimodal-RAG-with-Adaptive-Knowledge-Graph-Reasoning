import { createClient, Session, AuthError } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    '[TraceRAG] VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in your .env file'
  )
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export interface AuthUser {
  id: string
  email: string
  is_guest?: boolean
}

export interface GuestSession {
  user: AuthUser
  conversationId: string
  createdAt: number
}

const GUEST_SESSION_KEY = 'trace_guest_session'

export function startGuestSession(): GuestSession {
  const guestId = 'guest_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36).slice(-4)
  const conversationId = `conv_${guestId}`
  const guestUser: AuthUser = {
    id: guestId,
    email: 'guest.sandbox@trace.local',
    is_guest: true,
  }
  const session: GuestSession = {
    user: guestUser,
    conversationId,
    createdAt: Date.now(),
  }
  try {
    localStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session))
  } catch (e) {}
  return session
}

export function getGuestSession(): GuestSession | null {
  try {
    const raw = localStorage.getItem(GUEST_SESSION_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed?.user?.id && parsed?.conversationId) {
        return parsed
      }
    }
  } catch (e) {}
  return null
}

export function endGuestSession(): void {
  try {
    localStorage.removeItem(GUEST_SESSION_KEY)
  } catch (e) {}
}

export interface AuthResult {
  user: AuthUser | null
  session: Session | null
  error: AuthError | null
}

/** Sign up with email + password */
export async function signUp(email: string, password: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signUp({ email, password })
  return {
    user: data.user ? { id: data.user.id, email: data.user.email ?? '' } : null,
    session: data.session,
    error: error as AuthError | null,
  }
}

/** Sign in with email + password */
export async function signIn(email: string, password: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  return {
    user: data.user ? { id: data.user.id, email: data.user.email ?? '' } : null,
    session: data.session,
    error: error as AuthError | null,
  }
}

// Memory token cache — avoids hitting supabase.auth.getSession() on every API call
let _cachedToken: string | null = null
let _tokenExpiry = 0

export function invalidateTokenCache() {
  _cachedToken = null
  _tokenExpiry = 0
}

/** Sign out the current user */
export async function signOut(): Promise<{ error: AuthError | null }> {
  invalidateTokenCache()
  endGuestSession()
  const { error } = await supabase.auth.signOut()
  return { error: error as AuthError | null }
}

/** Sign in with Google (opens OAuth popup/redirect) */
export async function signInWithGoogle(): Promise<{ error: AuthError | null }> {
  invalidateTokenCache()
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
    },
  })
  return { error: error as AuthError | null }
}

/** Send OTP to Phone Number */
export async function signInWithPhone(phone: string): Promise<{ error: AuthError | null }> {
  invalidateTokenCache()
  const { error } = await supabase.auth.signInWithOtp({
    phone,
  })
  return { error: error as AuthError | null }
}

/** Verify Phone OTP */
export async function verifyPhoneOtp(phone: string, token: string): Promise<AuthResult> {
  invalidateTokenCache()
  const { data, error } = await supabase.auth.verifyOtp({
    phone,
    token,
    type: 'sms',
  })
  if (data.session?.access_token) {
    _cachedToken = data.session.access_token
    _tokenExpiry = Date.now() + 55_000
  }
  return {
    user: data.user ? { id: data.user.id, email: data.user.email || data.user.phone || '' } : null,
    session: data.session,
    error: error as AuthError | null,
  }
}

/** Synchronously read the persisted Supabase session from localStorage to prevent initial render flicker */
export function getInitialAuthUser(): AuthUser | null {
  const guestSess = getGuestSession()
  if (guestSess) {
    return guestSess.user
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        const item = localStorage.getItem(key)
        if (item) {
          const parsed = JSON.parse(item)
          const user = parsed?.user
          if (user?.id) {
            return { id: user.id, email: user.email ?? '' }
          }
        }
      }
    }
  } catch (e) {
    // Ignore parse errors
  }
  return null
}

/** Get the currently active user (from persisted session) */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const guestSess = getGuestSession()
  if (guestSess) {
    return guestSess.user
  }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  return { id: user.id, email: user.email ?? '' }
}

/** Get the current session (includes access_token for backend calls) */
export async function getSession(): Promise<Session | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session
}

/** Get the JWT access token to send to the backend (memory cached with 55s TTL) */
export async function getAccessToken(): Promise<string | null> {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken
  const session = await getSession()
  const token = session?.access_token ?? null
  if (token) {
    _cachedToken = token
    _tokenExpiry = Date.now() + 55_000
  } else {
    _cachedToken = null
  }
  return _cachedToken
}

/** Subscribe to auth state changes (login / logout / token refresh) */
export function onAuthStateChange(
  callback: (user: AuthUser | null, session: Session | null, event: string) => void
) {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    if (session?.access_token) {
      _cachedToken = session.access_token
      _tokenExpiry = Date.now() + 55_000
    } else {
      invalidateTokenCache()
    }
    const user = session?.user
      ? { id: session.user.id, email: session.user.email ?? '' }
      : null
    callback(user, session, event)
  })
  return () => subscription.unsubscribe()
}

