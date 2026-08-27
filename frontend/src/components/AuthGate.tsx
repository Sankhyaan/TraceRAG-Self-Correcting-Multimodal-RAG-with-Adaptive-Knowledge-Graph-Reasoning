import { useState, useEffect, useRef } from 'react'
import {
  signIn,
  signUp,
  signInWithGoogle,
  signInWithPhone,
  verifyPhoneOtp,
  onAuthStateChange,
  type AuthUser,
} from '../api/authApi'

interface AuthGateProps {
  onAuthenticated: (user: AuthUser) => void
  onStartAuthTransition?: (title: string, subtitle: string) => void
  onStartGuestSession?: () => void
  isOpen?: boolean
  onClose?: () => void
  isModal?: boolean
}

type AuthMethod = 'email' | 'phone'
type EmailMode = 'signin' | 'signup'
type PhoneStep = 'input_phone' | 'input_otp'

export function AuthGate({ onAuthenticated, onStartAuthTransition, onStartGuestSession, isOpen = true, onClose, isModal = false }: AuthGateProps) {
  if (isModal && !isOpen) return null

  const [authMethod, setAuthMethod] = useState<AuthMethod>('email')
  const [emailMode, setEmailMode] = useState<EmailMode>('signin')


  // Email form state
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Phone form state
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [phoneStep, setPhoneStep] = useState<PhoneStep>('input_phone')

  // UI state
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const emailRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const otpRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (authMethod === 'email') {
      emailRef.current?.focus()
    } else if (phoneStep === 'input_phone') {
      phoneRef.current?.focus()
    } else {
      otpRef.current?.focus()
    }
  }, [authMethod, phoneStep])

  const handleSuccessAuth = (u: AuthUser) => {
    onStartAuthTransition?.('Signing you in...', 'Preparing your personal workspace & knowledge graphs...')
    onClose?.()
    onAuthenticated(u)
  }

  useEffect(() => {
    // Check if already logged in
    const unsub = onAuthStateChange((user, _session) => {
      if (user) handleSuccessAuth(user)
    })
    return unsub
  }, [])

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!email.trim()) { setError('Email is required.'); return }
    if (!password) { setError('Password is required.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }

    if (emailMode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      if (emailMode === 'signup') {
        const result = await signUp(email.trim(), password)
        if (result.error) {
          setError(result.error.message || 'Sign up failed.')
        } else if (result.session && result.user) {
          handleSuccessAuth(result.user)
        } else {
          setSuccess('Account created! Please check your email to confirm your account, then sign in.')
          setEmailMode('signin')
        }
      } else {
        const result = await signIn(email.trim(), password)
        if (result.error) {
          setError(result.error.message || 'Sign in failed. Check your credentials.')
        } else if (result.user) {
          handleSuccessAuth(result.user)
        }
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  const handleSendPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    const cleanedPhone = phone.trim()
    if (!cleanedPhone) {
      setError('Phone number is required.')
      return
    }
    if (!cleanedPhone.startsWith('+')) {
      setError('Include country code (e.g. +1234567890 or +919876543210).')
      return
    }

    setLoading(true)
    try {
      const { error: pErr } = await signInWithPhone(cleanedPhone)
      if (pErr) {
        setError(pErr.message || 'Failed to send SMS OTP.')
      } else {
        setSuccess(`Verification code sent to ${cleanedPhone}`)
        setPhoneStep('input_otp')
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!otp.trim()) {
      setError('Please enter the verification code.')
      return
    }

    setLoading(true)
    try {
      const result = await verifyPhoneOtp(phone.trim(), otp.trim())
      if (result.error) {
        setError(result.error.message || 'Invalid or expired OTP.')
      } else if (result.user) {
        handleSuccessAuth(result.user)
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed.')
    } finally {
      setLoading(false)
    }
  }


  return (
    <div
      style={{
        position: isModal ? 'fixed' : 'relative',
        inset: isModal ? 0 : undefined,
        zIndex: isModal ? 1000 : 1,
        minHeight: isModal ? '100vh' : '100vh',
        width: isModal ? '100vw' : '100vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isModal
          ? 'rgba(5, 8, 16, 0.82)'
          : 'radial-gradient(ellipse at 20% 20%, rgba(30, 27, 75, 0.95) 0%, #090d16 60%)',
        backdropFilter: isModal ? 'blur(12px)' : undefined,
        padding: '1.5rem',
        fontFamily: 'Inter, system-ui, sans-serif',
        animation: isModal ? 'fadeIn 0.15s ease-out' : undefined,
      }}
      onClick={isModal ? onClose : undefined}
    >
      {/* Animated background orbs (full screen mode) */}
      {!isModal && (
        <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
          <div style={{ position: 'absolute', top: '-10%', left: '-5%', width: '500px', height: '500px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(99, 102, 241, 0.12) 0%, transparent 70%)', animation: 'pulse 8s ease-in-out infinite' }} />
          <div style={{ position: 'absolute', bottom: '-15%', right: '-5%', width: '600px', height: '600px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(6, 182, 212, 0.08) 0%, transparent 70%)', animation: 'pulse 10s ease-in-out infinite reverse' }} />
        </div>
      )}

      <div
        style={{
          position: 'relative',
          zIndex: 2,
          width: '100%',
          maxWidth: '430px',
          background: 'rgba(15, 18, 32, 0.92)',
          border: '1px solid rgba(99, 102, 241, 0.35)',
          borderRadius: '24px',
          padding: '2.25rem 2rem',
          backdropFilter: 'blur(24px)',
          boxShadow: '0 32px 64px -12px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255,255,255,0.04), 0 0 60px rgba(99, 102, 241, 0.15)',
          animation: isModal ? 'scaleUp 0.18s cubic-bezier(0.16, 1, 0.3, 1)' : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Close Button */}
        {isModal && onClose && (
          <button
            onClick={onClose}
            title="Close"
            style={{
              position: 'absolute',
              top: '1.25rem',
              right: '1.25rem',
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: '0.9rem',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'
              e.currentTarget.style.color = '#ef4444'
              e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'
              e.currentTarget.style.color = '#94a3b8'
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)'
            }}
          >
            ✕
          </button>
        )}

        {/* Logo + Title */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div
            style={{
              width: '54px',
              height: '54px',
              borderRadius: '16px',

              background: 'linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.5rem',
              margin: '0 auto 0.85rem',
              boxShadow: '0 8px 24px rgba(99, 102, 241, 0.4)',
            }}
          >
            🔍
          </div>
          <h1 style={{ fontSize: '1.65rem', fontWeight: 800, color: '#f8fafc', margin: 0, letterSpacing: '-0.03em' }}>
            Trace RAG
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.84rem', marginTop: '0.25rem' }}>
            Self-correcting multimodal intelligence
          </p>
        </div>

        {/* Primary Auth Method: Email vs Phone */}
        <div
          style={{
            display: 'flex',
            background: 'rgba(255,255,255,0.04)',
            borderRadius: '12px',
            padding: '0.25rem',
            marginBottom: '1.25rem',
            border: '1px solid rgba(255,255,255,0.06)',
            gap: '0.25rem',
          }}
        >
          <button
            type="button"
            onClick={() => { setAuthMethod('email'); setError(null); setSuccess(null) }}
            style={{
              flex: 1,
              padding: '0.5rem',
              borderRadius: '9px',
              border: 'none',
              background: authMethod === 'email'
                ? 'rgba(99, 102, 241, 0.25)'
                : 'transparent',
              color: authMethod === 'email' ? '#e0e7ff' : '#64748b',
              fontWeight: 600,
              fontSize: '0.84rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.4rem',
              transition: 'all 0.15s ease',
              borderBottom: authMethod === 'email' ? '2px solid #6366f1' : '2px solid transparent',
            }}
          >
            <span>✉️</span>
            <span>Email</span>
          </button>

          <button
            type="button"
            onClick={() => { setAuthMethod('phone'); setError(null); setSuccess(null) }}
            style={{
              flex: 1,
              padding: '0.5rem',
              borderRadius: '9px',
              border: 'none',
              background: authMethod === 'phone'
                ? 'rgba(6, 182, 212, 0.22)'
                : 'transparent',
              color: authMethod === 'phone' ? '#cffafe' : '#64748b',
              fontWeight: 600,
              fontSize: '0.84rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.4rem',
              transition: 'all 0.15s ease',
              borderBottom: authMethod === 'phone' ? '2px solid #06b6d4' : '2px solid transparent',
            }}
          >
            <span>📱</span>
            <span>Phone OTP</span>
          </button>
        </div>

        {/* ─── EMAIL AUTH FORM ─── */}
        {authMethod === 'email' && (
          <div>
            {/* Sign In vs Sign Up Sub-Tabs */}
            <div
              style={{
                display: 'flex',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '10px',
                padding: '0.2rem',
                marginBottom: '1.25rem',
                border: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              {(['signin', 'signup'] as EmailMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => { setEmailMode(m); setError(null); setSuccess(null) }}
                  style={{
                    flex: 1,
                    padding: '0.45rem',
                    borderRadius: '8px',
                    border: 'none',
                    background: emailMode === m
                      ? 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)'
                      : 'transparent',
                    color: emailMode === m ? '#fff' : '#64748b',
                    fontWeight: 600,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    boxShadow: emailMode === m ? '0 4px 12px rgba(99, 102, 241, 0.35)' : 'none',
                  }}
                >
                  {m === 'signin' ? 'Sign In' : 'Sign Up'}
                </button>
              ))}
            </div>

            <form onSubmit={handleEmailSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#94a3b8', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  Email
                </label>
                <input
                  ref={emailRef}
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '10px',
                    padding: '0.7rem 0.9rem',
                    color: '#f1f5f9',
                    fontSize: '0.88rem',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#94a3b8', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  Password
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={emailMode === 'signup' ? 'At least 6 characters' : '••••••••'}
                    autoComplete={emailMode === 'signup' ? 'new-password' : 'current-password'}
                    required
                    style={{
                      width: '100%',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '10px',
                      padding: '0.7rem 2.8rem 0.7rem 0.9rem',
                      color: '#f1f5f9',
                      fontSize: '0.88rem',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: '0.65rem',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: '#64748b',
                      cursor: 'pointer',
                      fontSize: '0.95rem',
                      padding: '0.2rem',
                    }}
                  >
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              {emailMode === 'signup' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#94a3b8', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Confirm Password
                  </label>
                  <input
                    id="auth-confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat your password"
                    autoComplete="new-password"
                    required
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: `1px solid ${confirmPassword && confirmPassword !== password ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.1)'}`,
                      borderRadius: '10px',
                      padding: '0.7rem 0.9rem',
                      color: '#f1f5f9',
                      fontSize: '0.88rem',
                      outline: 'none',
                    }}
                  />
                </div>
              )}

              <button
                id="auth-submit-btn"
                type="submit"
                disabled={loading}
                style={{
                  marginTop: '0.35rem',
                  padding: '0.8rem',
                  borderRadius: '12px',
                  border: 'none',
                  background: loading
                    ? 'rgba(99,102,241,0.4)'
                    : 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '0.92rem',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: loading ? 'none' : '0 8px 24px rgba(99, 102, 241, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                }}
              >
                {loading ? (
                  <>
                    <span style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    {emailMode === 'signup' ? 'Creating account...' : 'Signing in...'}
                  </>
                ) : (
                  emailMode === 'signup' ? '🚀 Create Account' : '→ Sign In'
                )}
              </button>
            </form>
          </div>
        )}

        {/* ─── PHONE OTP AUTH FORM ─── */}
        {authMethod === 'phone' && (
          <div>
            {phoneStep === 'input_phone' ? (
              <form onSubmit={handleSendPhoneOtp} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#94a3b8', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Phone Number (with country code)
                  </label>
                  <input
                    ref={phoneRef}
                    id="auth-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+919876543210 or +1234567890"
                    autoComplete="tel"
                    required
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(6, 182, 212, 0.3)',
                      borderRadius: '10px',
                      padding: '0.75rem 0.9rem',
                      color: '#f1f5f9',
                      fontSize: '0.92rem',
                      letterSpacing: '0.04em',
                      outline: 'none',
                    }}
                  />
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    We'll send a 6-digit SMS code to this number.
                  </span>
                </div>

                <button
                  id="phone-send-otp-btn"
                  type="submit"
                  disabled={loading}
                  style={{
                    padding: '0.8rem',
                    borderRadius: '12px',
                    border: 'none',
                    background: loading
                      ? 'rgba(6, 182, 212, 0.4)'
                      : 'linear-gradient(135deg, #06b6d4 0%, #0284c7 100%)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '0.92rem',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    boxShadow: '0 8px 24px rgba(6, 182, 212, 0.35)',
                  }}
                >
                  {loading ? (
                    <>
                      <span style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                      Sending OTP...
                    </>
                  ) : (
                    '📲 Send Verification Code'
                  )}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyPhoneOtp} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#94a3b8', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      6-Digit SMS Code
                    </label>
                    <button
                      type="button"
                      onClick={() => { setPhoneStep('input_phone'); setOtp(''); setError(null); setSuccess(null) }}
                      style={{ background: 'none', border: 'none', color: '#06b6d4', fontSize: '0.76rem', cursor: 'pointer', padding: 0 }}
                    >
                      Change number
                    </button>
                  </div>
                  <input
                    ref={otpRef}
                    id="auth-otp"
                    type="text"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    autoComplete="one-time-code"
                    required
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(6, 182, 212, 0.4)',
                      borderRadius: '10px',
                      padding: '0.75rem 0.9rem',
                      color: '#f1f5f9',
                      fontSize: '1.2rem',
                      letterSpacing: '0.3em',
                      textAlign: 'center',
                      fontWeight: 700,
                      outline: 'none',
                    }}
                  />
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                    Sent to <strong style={{ color: '#e2e8f0' }}>{phone}</strong>
                  </span>
                </div>

                <button
                  id="phone-verify-otp-btn"
                  type="submit"
                  disabled={loading}
                  style={{
                    padding: '0.8rem',
                    borderRadius: '12px',
                    border: 'none',
                    background: loading
                      ? 'rgba(6, 182, 212, 0.4)'
                      : 'linear-gradient(135deg, #06b6d4 0%, #0284c7 100%)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '0.92rem',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    boxShadow: '0 8px 24px rgba(6, 182, 212, 0.35)',
                  }}
                >
                  {loading ? (
                    <>
                      <span style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                      Verifying...
                    </>
                  ) : (
                    '✅ Verify & Sign In'
                  )}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div
            style={{
              marginTop: '1rem',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              borderRadius: '10px',
              padding: '0.7rem 0.9rem',
              color: '#fca5a5',
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.45rem',
            }}
          >
            <span style={{ flexShrink: 0 }}>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* Success Banner */}
        {success && (
          <div
            style={{
              marginTop: '1rem',
              background: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid rgba(34, 197, 94, 0.35)',
              borderRadius: '10px',
              padding: '0.7rem 0.9rem',
              color: '#86efac',
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.45rem',
            }}
          >
            <span style={{ flexShrink: 0 }}>✅</span>
            <span>{success}</span>
          </div>
        )}

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1.25rem 0 0' }}>
          <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
          <span style={{ color: '#475569', fontSize: '0.76rem', whiteSpace: 'nowrap' }}>or continue with</span>
          <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
        </div>

        {/* Google Sign-In Button */}
        <button
          id="google-signin-btn"
          type="button"
          onClick={async () => {
            setGoogleLoading(true)
            setError(null)
            const { error: gErr } = await signInWithGoogle()
            if (gErr) {
              setError(gErr.message || 'Google sign-in failed.')
              setGoogleLoading(false)
            }
          }}
          disabled={googleLoading}
          style={{
            marginTop: '0.85rem',
            width: '100%',
            padding: '0.75rem',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.12)',
            background: googleLoading ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.06)',
            color: '#e2e8f0',
            fontWeight: 600,
            fontSize: '0.88rem',
            cursor: googleLoading ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.65rem',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            if (!googleLoading) {
              e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.22)'
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'
          }}
        >
          {googleLoading ? (
            <span style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
              <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
          )}
          {googleLoading ? 'Redirecting...' : 'Sign in with Google'}
        </button>

        {/* Guest Sandbox Mode Option */}
        {onStartGuestSession && (
          <div style={{ marginTop: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.85rem' }}>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
              <span style={{ color: '#64748b', fontSize: '0.74rem', whiteSpace: 'nowrap' }}>or explore without an account</span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
            </div>

            <button
              id="guest-sandbox-btn"
              type="button"
              onClick={() => {
                onClose?.()
                onStartGuestSession()
              }}
              style={{
                width: '100%',
                padding: '0.8rem 1rem',
                borderRadius: '14px',
                border: '1px solid rgba(244, 114, 182, 0.45)',
                background: 'linear-gradient(135deg, rgba(131, 24, 67, 0.35) 0%, rgba(190, 24, 93, 0.25) 50%, rgba(219, 39, 119, 0.2) 100%)',
                color: '#fdf2f8',
                fontWeight: 700,
                fontSize: '0.88rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.65rem',
                boxShadow: '0 4px 20px rgba(219, 39, 119, 0.25), inset 0 0 12px rgba(244, 114, 182, 0.1)',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.boxShadow = '0 6px 26px rgba(219, 39, 119, 0.45), inset 0 0 16px rgba(244, 114, 182, 0.15)'
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(131, 24, 67, 0.5) 0%, rgba(190, 24, 93, 0.4) 50%, rgba(219, 39, 119, 0.35) 100%)'
                e.currentTarget.style.borderColor = 'rgba(249, 168, 212, 0.8)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'none'
                e.currentTarget.style.boxShadow = '0 4px 20px rgba(219, 39, 119, 0.25), inset 0 0 12px rgba(244, 114, 182, 0.1)'
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(131, 24, 67, 0.35) 0%, rgba(190, 24, 93, 0.25) 50%, rgba(219, 39, 119, 0.2) 100%)'
                e.currentTarget.style.borderColor = 'rgba(244, 114, 182, 0.45)'
              }}
            >
              <span style={{ fontSize: '1.2rem' }}>🎭</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 700, fontSize: '0.86rem', color: '#fce7f3' }}>Enter as Guest (Sandbox Mode)</div>
                <div style={{ fontSize: '0.71rem', color: '#f9a8d4', fontWeight: 500 }}>
                  Upload your own files • Persists on refresh • Wiped when you leave
                </div>
              </div>
            </button>
          </div>
        )}

        <p style={{ textAlign: 'center', color: '#475569', fontSize: '0.76rem', marginTop: '1.25rem', lineHeight: 1.5 }}>
          By continuing you agree to our{' '}
          <span style={{ color: '#6366f1' }}>Terms of Service</span>
          {' '}and{' '}
          <span style={{ color: '#6366f1' }}>Privacy Policy</span>.
        </p>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.05); opacity: 1; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
