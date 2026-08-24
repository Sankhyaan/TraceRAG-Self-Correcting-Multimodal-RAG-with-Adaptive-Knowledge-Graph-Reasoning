import { useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { FileManager } from './components/FileManager'
import { RetrievalTester } from './components/RetrievalTester'
import { KnowledgeGraphViewer } from './components/KnowledgeGraphViewer'
import { ChatSynthesisView } from './components/ChatSynthesisView'
import { AuthGate } from './components/AuthGate'
import { listConversations, invalidateConversationsCache } from './api/conversationsApi'

import { type AuthUser, signOut as authSignOut, getCurrentUser, onAuthStateChange } from './api/authApi'

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [conversationId, setConversationId] = useState<string>('conv_demo')

  const [activeTab, setActiveTab] = useState<'chat' | 'files' | 'retrieval' | 'graph'>('files')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [filesChangeSignal, setFilesChangeSignal] = useState(0)
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({})



  // Restore session on mount
  useEffect(() => {
    getCurrentUser().then((u) => {
      setUser(u)
      if (!u) {
        invalidateConversationsCache()
        setConversationId('conv_demo')
      } else {
        const saved = localStorage.getItem(`trace_active_conversation_${u.id}`)
        if (saved && saved !== 'conv_demo') {
          setConversationId(saved)
        }
      }
      setAuthLoading(false)
    })
    const unsub = onAuthStateChange((u) => {
      setUser(u)
      if (!u) {
        invalidateConversationsCache()
        setConversationId('conv_demo')
      } else {
        const saved = localStorage.getItem(`trace_active_conversation_${u.id}`)
        if (saved && saved !== 'conv_demo') {
          setConversationId(saved)
        }
      }
      setAuthLoading(false)
    })
    return unsub
  }, [])


  // Load conversations based on auth state
  useEffect(() => {
    if (!user) {
      // Guest Mode — default to the canonical VoltBus demo workspace
      setConversationId('conv_demo')
      listConversations().catch((e) => console.warn('Could not load demo conversation:', e))
      return
    }


    const userStorageKey = `trace_active_conversation_${user.id}`
    const saved = localStorage.getItem(userStorageKey)
    if (saved && saved !== 'conv_demo') {
      setConversationId(saved)
    }

    listConversations()
      .then((list) => {
        if (list && list.length > 0) {
          const exists = saved ? list.find((c) => c.id === saved) : null
          if (exists) {
            setConversationId(exists.id)
          } else {
            setConversationId(list[0].id)
            localStorage.setItem(userStorageKey, list[0].id)
          }
        }
      })
      .catch((e) => console.warn('Could not list conversations on load:', e))
  }, [user])

  const handleSelectConversation = (id: string) => {
    setConversationId(id)
    if (user) {
      localStorage.setItem(`trace_active_conversation_${user.id}`, id)
    }
  }

  const getTabTitle = () => {
    switch (activeTab) {
      case 'chat':
        return '💬 AI Chat & Grounded Citation Synthesis'
      case 'files':
        return '📁 File Manager & Multimodal Ingest'
      case 'retrieval':
        return '🔍 Router & Hybrid Retrieval Inspector'
      case 'graph':
        return '🕸️ Knowledge Graph & Multi-Hop Traversal'
    }
  }

  const getTabDescription = () => {
    switch (activeTab) {
      case 'chat':
        return 'Grounded multi-file synthesis with verifiable citations.'
      case 'files':
        return 'Multimodal assets scoped to this active session.'
      case 'retrieval':
        return 'Hybrid dense vectors and BM25 lexical inspector.'
      case 'graph':
        return 'Entity network topology and multi-hop reasoning paths.'
    }
  }

  const [clearSignal, setClearSignal] = useState(0)
  const [showClearChatModal, setShowClearChatModal] = useState(false)
  const [showClearWorkspaceModal, setShowClearWorkspaceModal] = useState(false)
  const [showGuestRefreshModal, setShowGuestRefreshModal] = useState(false)
  const [clearingWorkspace, setClearingWorkspace] = useState(false)

  // Intercept keyboard refresh in Guest Mode to show our custom styled warning modal
  // and handle browser URL bar reload icon with confirmation
  useEffect(() => {
    if (!user && !authLoading) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'F5' || (e.key === 'r' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault()
          setShowGuestRefreshModal(true)
        }
      }
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        e.preventDefault()
        e.returnValue = ''
      }
      window.addEventListener('keydown', handleKeyDown)
      window.addEventListener('beforeunload', handleBeforeUnload)
      return () => {
        window.removeEventListener('keydown', handleKeyDown)
        window.removeEventListener('beforeunload', handleBeforeUnload)
      }
    }
  }, [user, authLoading])



  const handleClearChat = () => {
    setShowClearChatModal(true)
  }


  const confirmClearChat = async () => {
    setShowClearChatModal(false)
    try {
      const { clearConversationMessages } = await import('./api/conversationsApi')
      await clearConversationMessages(conversationId)
      setClearSignal((prev) => prev + 1)
    } catch (err) {
      console.error(err)
    }
  }

  const handleClearWorkspace = () => {
    setShowClearWorkspaceModal(true)
  }

  const confirmClearWorkspace = async () => {
    setClearingWorkspace(true)
    try {
      const { deleteConversation, createConversation } = await import('./api/conversationsApi')
      // Delete current workspace (cascading delete of files, messages, graph, vectors)
      await deleteConversation(conversationId)
      // Open a new clean workspace
      const newConv = await createConversation('New Conversation')
      setConversationId(newConv.id)
      if (user) {
        localStorage.setItem(`trace_active_conversation_${user.id}`, newConv.id)
      }
      setFilesChangeSignal((prev) => prev + 1)
      setShowClearWorkspaceModal(false)
    } catch (err) {
      console.error('Failed to clear workspace:', err)
    } finally {
      setClearingWorkspace(false)
    }
  }

  const handleSignOut = async () => {
    invalidateConversationsCache()
    setConversationId('conv_demo')
    setUser(null)
    await authSignOut()
  }

  // Show full-page loader while restoring session on initial load
  if (authLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#090d16', color: '#64748b', fontSize: '0.9rem', gap: '0.75rem' }}>
        <span style={{ display: 'inline-block', width: '20px', height: '20px', border: '2px solid rgba(99,102,241,0.3)', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        Loading Trace workspace...
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', background: 'var(--bg-primary)', overflow: 'hidden' }}>
      {/* AuthGate Modal Overlay */}
      <AuthGate
        isModal={true}
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onAuthenticated={(u) => {
          setUser(u)
          setShowAuthModal(false)
        }}
      />

      {/* Sidebar on the Left */}
      <Sidebar
        activeId={conversationId}
        onSelect={handleSelectConversation}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((prev) => !prev)}
        refreshSignal={filesChangeSignal}
        fileCountOverride={fileCounts}
        isGuest={!user}
        onOpenAuth={() => setShowAuthModal(true)}
      />

      {/* Main Content Area on the Right */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          minWidth: 0,
          overflow: 'hidden',
          transition: 'all 0.25s ease',
        }}
      >
        {/* Top Navbar */}
        <header
          style={{
            padding: '0.75rem 1.5rem',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'rgba(10, 13, 20, 0.92)',
            backdropFilter: 'blur(12px)',
            zIndex: 30,
            gap: '1rem',
            width: '100%',
            flexShrink: 0,
          }}
        >
          {/* Top Left: Sessions Toggle + Header Title & Subtitle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                title="Open conversations sidebar"
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  padding: '0.45rem 0.85rem',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                <span>☰</span>
                <span>Sessions</span>
              </button>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem', whiteSpace: 'nowrap' }}>
                {getTabTitle()}
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: '0.15rem 0 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {getTabDescription()}
              </p>
            </div>
          </div>

          {/* Top Right: Guest Mode / User Info + Sign In/Out + Clear Workspace */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Active Session:</span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  color: '#38bdf8',
                  fontWeight: 600,
                  fontSize: '0.84rem',
                  background: 'rgba(6, 182, 212, 0.12)',
                  padding: '0.25rem 0.65rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  boxShadow: '0 0 14px rgba(6, 182, 212, 0.18)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 8px #38bdf8', display: 'inline-block' }} />
                {conversationId === 'conv_demo' ? '🌟 VoltBus Demo' : conversationId}
              </span>
            </div>

            {/* Guest Mode Indicator & Sign In CTA */}
            {!user ? (
              <>
                <span
                  style={{
                    fontSize: '0.76rem',
                    color: '#a855f7',
                    background: 'rgba(168, 85, 247, 0.12)',
                    border: '1px solid rgba(168, 85, 247, 0.35)',
                    borderRadius: '8px',
                    padding: '0.25rem 0.65rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    boxShadow: '0 0 12px rgba(168, 85, 247, 0.15)',
                  }}
                >
                  <span>👤</span>
                  <span>Guest Mode</span>
                </span>

                <button
                  id="reload-demo-btn"
                  onClick={() => setShowGuestRefreshModal(true)}
                  title="Reload Demo Workspace to Default State"
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '8px',
                    color: '#cbd5e1',
                    padding: '0.35rem 0.7rem',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#fff'
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)'
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = '#cbd5e1'
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)'
                  }}
                >
                  <span>🔄</span>
                  <span>Reload Demo</span>
                </button>

                <button
                  id="sign-in-cta-btn"

                  onClick={() => setShowAuthModal(true)}
                  style={{
                    background: 'linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff',
                    padding: '0.38rem 0.85rem',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-1px)'
                    e.currentTarget.style.boxShadow = '0 6px 18px rgba(99, 102, 241, 0.55)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'none'
                    e.currentTarget.style.boxShadow = '0 4px 14px rgba(99, 102, 241, 0.4)'
                  }}
                >
                  <span>✨</span>
                  <span>Sign In / Sign Up</span>
                </button>
              </>


            ) : (
              <>
                {/* User email badge */}
                <span
                  title={`Signed in as ${user.email}`}
                  style={{
                    fontSize: '0.78rem',
                    color: '#94a3b8',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px',
                    padding: '0.2rem 0.55rem',
                    maxWidth: '160px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  👤 {user.email}
                </span>

                {/* Sign out button */}
                <button
                  id="sign-out-btn"
                  onClick={handleSignOut}
                  title="Sign out"
                  style={{
                    background: 'rgba(239, 68, 68, 0.08)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    borderRadius: '8px',
                    color: '#f87171',
                    padding: '0.35rem 0.75rem',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.18)'
                    e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.5)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)'
                    e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.25)'
                  }}
                >
                  <span>⏻</span>
                  <span>Sign Out</span>
                </button>

                {/* Clear Workspace button (Authenticated Only) */}
                <button
                  onClick={handleClearWorkspace}
                  className="btn btn-secondary"
                  title="Wipe all files, chat history, and knowledge graphs in this workspace"
                  style={{
                    fontSize: '0.78rem',
                    padding: '0.35rem 0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    borderRadius: '8px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#f87171',
                  }}
                >
                  <span>🗑️</span>
                  <span>Clear Workspace</span>
                </button>

                {activeTab === 'chat' && conversationId !== 'conv_demo' && (
                  <button
                    onClick={handleClearChat}
                    className="btn btn-secondary"
                    style={{
                      fontSize: '0.78rem',
                      padding: '0.35rem 0.75rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      borderRadius: '8px',
                    }}
                  >
                    <span>💬</span>
                    <span>Clear Chat</span>
                  </button>
                )}
              </>
            )}
          </div>
        </header>



        {/* 4-Tab Navigation Bar */}
        <div
          style={{
            padding: '0.55rem 1.5rem',
            borderBottom: '1px solid var(--border-color)',
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              background: 'rgba(11, 16, 27, 0.85)',
              border: '1px solid rgba(255, 255, 255, 0.09)',
              borderRadius: '14px',
              padding: '0.3rem',
              gap: '0.4rem',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.35)',
              backdropFilter: 'blur(12px)',
            }}
          >
            {[
              { id: 'chat', label: 'Chat & Synthesis', icon: '💬', gradient: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)', shadow: 'rgba(59, 130, 246, 0.45)' },
              { id: 'files', label: 'Files & Ingest', icon: '📁', gradient: 'linear-gradient(135deg, #0284c7 0%, #06b6d4 100%)', shadow: 'rgba(6, 182, 212, 0.45)' },
              { id: 'retrieval', label: 'Retrieval Inspector', icon: '🔍', gradient: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', shadow: 'rgba(139, 92, 246, 0.45)' },
              { id: 'graph', label: 'Knowledge Graph', icon: '🕸️', gradient: 'linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%)', shadow: 'rgba(217, 70, 239, 0.45)' },
            ].map((tab) => {
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  style={{
                    background: isActive ? tab.gradient : 'transparent',
                    color: isActive ? '#ffffff' : 'var(--text-secondary)',
                    border: isActive ? '1px solid rgba(255, 255, 255, 0.25)' : '1px solid transparent',
                    borderRadius: '10px',
                    padding: '0.48rem 1.1rem',
                    fontSize: '0.83rem',
                    fontWeight: isActive ? 700 : 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    boxShadow: isActive ? `0 3px 18px ${tab.shadow}` : 'none',
                    transform: isActive ? 'translateY(-1px)' : 'none',
                    transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
                      e.currentTarget.style.color = '#f8fafc'
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)'
                      e.currentTarget.style.transform = 'translateY(-2px)'
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.25)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'transparent'
                      e.currentTarget.style.color = 'var(--text-secondary)'
                      e.currentTarget.style.borderColor = 'transparent'
                      e.currentTarget.style.transform = 'none'
                      e.currentTarget.style.boxShadow = 'none'
                    }
                  }}
                >
                  <span style={{ fontSize: '0.95rem' }}>{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Workspace Body - Fluid Expansive Container with full vertical scrolling */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto', padding: activeTab === 'chat' ? '0.75rem 1.25rem 1rem' : '1.25rem 1.5rem', width: '100%' }}>
          <div style={{ display: activeTab === 'chat' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <ChatSynthesisView conversationId={conversationId} clearSignal={clearSignal} />
          </div>
          <div style={{ display: activeTab === 'files' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <FileManager
              conversationId={conversationId}
              isGuest={!user}
              onOpenAuth={() => setShowAuthModal(true)}
              onFilesChanged={() => setFilesChangeSignal((prev) => prev + 1)}
              onFileCountChange={(count) =>
                setFileCounts((prev) => ({ ...prev, [conversationId]: count }))
              }
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          </div>
          <div style={{ display: activeTab === 'retrieval' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <RetrievalTester conversationId={conversationId} />
          </div>
          <div style={{ display: activeTab === 'graph' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <KnowledgeGraphViewer conversationId={conversationId} />
          </div>
        </div>
      </div>

      {/* Clear Chat Confirmation Modal */}
      {showClearChatModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.78)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1.25rem',
            animation: 'fadeIn 0.15s ease-out',
          }}
          onClick={() => setShowClearChatModal(false)}
        >
          <div
            style={{
              background: 'radial-gradient(ellipse at top, #1e1b4b 0%, #090d16 100%)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: '20px',
              padding: '2rem 2.25rem',
              maxWidth: '460px',
              width: '100%',
              textAlign: 'center',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 35px rgba(239, 68, 68, 0.2)',
              animation: 'scaleUp 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                width: '60px',
                height: '60px',
                borderRadius: '50%',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1.25rem',
                fontSize: '1.75rem',
                boxShadow: '0 0 24px rgba(239, 68, 68, 0.3)',
              }}
            >
              💬
            </div>

            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc', marginBottom: '0.6rem', letterSpacing: '-0.01em' }}>
              Clear Chat History?
            </h3>

            <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: '1.75rem', lineHeight: '1.55' }}>
              Are you sure you want to clear all chat messages in this session? Your uploaded documents and knowledge graph will remain intact.
            </p>

            <div style={{ display: 'flex', gap: '0.85rem', justifyContent: 'center' }}>
              <button
                onClick={() => setShowClearChatModal(false)}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: '#cbd5e1',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '10px',
                  padding: '0.6rem 1.35rem',
                  fontSize: '0.88rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmClearChat}
                style={{
                  background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                  color: '#fff',
                  border: '1px solid rgba(239, 68, 68, 0.6)',
                  borderRadius: '10px',
                  padding: '0.6rem 1.5rem',
                  fontSize: '0.88rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(239, 68, 68, 0.4)',
                  transition: 'all 0.15s ease',
                }}
              >
                Yes, Clear Chat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Workspace Cascading Reset Confirmation Modal */}
      {showClearWorkspaceModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.82)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1.25rem',
            animation: 'fadeIn 0.15s ease-out',
          }}
          onClick={() => setShowClearWorkspaceModal(false)}
        >
          <div
            style={{
              background: 'radial-gradient(ellipse at top, #2d0a0a 0%, #090d16 100%)',
              border: '1px solid rgba(239, 68, 68, 0.55)',
              borderRadius: '24px',
              padding: '2.25rem 2.25rem',
              maxWidth: '480px',
              width: '100%',
              textAlign: 'center',
              boxShadow: '0 32px 64px -12px rgba(0, 0, 0, 0.9), 0 0 45px rgba(239, 68, 68, 0.25)',
              animation: 'scaleUp 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: 'rgba(239, 68, 68, 0.18)',
                border: '1px solid rgba(239, 68, 68, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1.25rem',
                fontSize: '1.85rem',
                boxShadow: '0 0 28px rgba(239, 68, 68, 0.35)',
              }}
            >
              ⚠️
            </div>

            <h3 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#f8fafc', marginBottom: '0.65rem', letterSpacing: '-0.02em' }}>
              Clear Entire Workspace?
            </h3>

            <p style={{ fontSize: '0.9rem', color: '#cbd5e1', marginBottom: '1.75rem', lineHeight: '1.6' }}>
              This will permanently delete <strong style={{ color: '#f87171' }}>all uploaded files</strong>, chat messages, vector embeddings, and Knowledge Graph connections in this session. The workspace will reset to a clean upload state.
            </p>

            <div style={{ display: 'flex', gap: '0.85rem', justifyContent: 'center' }}>
              <button
                onClick={() => setShowClearWorkspaceModal(false)}
                disabled={clearingWorkspace}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: '#cbd5e1',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '10px',
                  padding: '0.65rem 1.4rem',
                  fontSize: '0.88rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmClearWorkspace}
                disabled={clearingWorkspace}
                style={{
                  background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
                  color: '#fff',
                  border: '1px solid rgba(239, 68, 68, 0.6)',
                  borderRadius: '10px',
                  padding: '0.65rem 1.6rem',
                  fontSize: '0.88rem',
                  fontWeight: 700,
                  cursor: clearingWorkspace ? 'wait' : 'pointer',
                  boxShadow: '0 4px 16px rgba(239, 68, 68, 0.5)',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                <span>{clearingWorkspace ? '⏳' : '🗑️'}</span>
                <span>{clearingWorkspace ? 'Wiping Workspace...' : 'Permanently Clear Workspace'}</span>
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Guest Mode Refresh & Unsaved Changes Warning Modal */}
      {showGuestRefreshModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.82)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1.25rem',
            animation: 'fadeIn 0.15s ease-out',
          }}
          onClick={() => setShowGuestRefreshModal(false)}
        >
          <div
            style={{
              background: 'radial-gradient(ellipse at top, #311b92 0%, #090d16 100%)',
              border: '1px solid rgba(245, 158, 11, 0.45)',
              borderRadius: '22px',
              padding: '2.2rem 2.4rem',
              maxWidth: '490px',
              width: '100%',
              textAlign: 'center',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.85), 0 0 35px rgba(245, 158, 11, 0.25)',
              animation: 'scaleUp 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: 'rgba(245, 158, 11, 0.18)',
                border: '1px solid rgba(245, 158, 11, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1.25rem',
                fontSize: '1.85rem',
                boxShadow: '0 0 28px rgba(245, 158, 11, 0.35)',
              }}
            >
              ⚠️
            </div>

            <h3 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#f8fafc', marginBottom: '0.65rem', letterSpacing: '-0.02em' }}>
              Unsaved Guest Workspace?
            </h3>

            <p style={{ fontSize: '0.9rem', color: '#cbd5e1', marginBottom: '1.75rem', lineHeight: '1.6' }}>
              Are you sure you want to refresh? Any temporary queries, questions, or modifications created in <strong style={{ color: '#fbbf24' }}>Guest Mode</strong> will revert to the default demo state upon reload.
              <br /><br />
              <strong style={{ color: '#38bdf8' }}>Sign in to save your workspace and track your private history!</strong>
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button
                onClick={() => {
                  setShowGuestRefreshModal(false)
                  setShowAuthModal(true)
                }}
                style={{
                  background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
                  color: '#fff',
                  border: '1px solid rgba(168, 85, 247, 0.6)',
                  borderRadius: '10px',
                  padding: '0.7rem 1.6rem',
                  fontSize: '0.92rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 4px 18px rgba(99, 102, 241, 0.5)',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.45rem',
                }}
              >
                <span>✨</span>
                <span>Sign In to Save & Track Workspace</span>
              </button>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                <button
                  onClick={() => setShowGuestRefreshModal(false)}
                  style={{
                    flex: 1,
                    background: 'rgba(255, 255, 255, 0.08)',
                    color: '#cbd5e1',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '10px',
                    padding: '0.6rem 1.2rem',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  Stay in Demo
                </button>
                <button
                  onClick={() => {
                    setShowGuestRefreshModal(false)
                    window.location.reload()
                  }}
                  style={{
                    flex: 1,
                    background: 'rgba(239, 68, 68, 0.15)',
                    color: '#fca5a5',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    borderRadius: '10px',
                    padding: '0.6rem 1.2rem',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  🔄 Refresh Anyway
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


