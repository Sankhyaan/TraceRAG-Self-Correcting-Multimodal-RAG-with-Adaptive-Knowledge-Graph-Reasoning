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

/** Get the currently active user (from persisted session) */
export async function getCurrentUser(): Promise<AuthUser | null> {
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

/** Subscribe to auth state changes (login / logout) */
export function onAuthStateChange(
  callback: (user: AuthUser | null, session: Session | null) => void
) {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.access_token) {
      _cachedToken = session.access_token
      _tokenExpiry = Date.now() + 55_000
    } else {
      invalidateTokenCache()
    }
    const user = session?.user
      ? { id: session.user.id, email: session.user.email ?? '' }
      : null
    callback(user, session)
  })
  return () => subscription.unsubscribe()
}

