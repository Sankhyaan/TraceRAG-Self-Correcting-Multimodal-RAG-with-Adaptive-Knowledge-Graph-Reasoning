import { useState, useEffect } from 'react'
import { Conversation, listConversations, createConversation, deleteConversation, renameConversation, getCachedConversations } from '../api/conversationsApi'

interface SidebarProps {
  activeId: string
  onSelect: (id: string) => void
  isOpen: boolean
  onToggle: () => void
  refreshSignal?: number
  fileCountOverride?: Record<string, number>
  isGuest?: boolean
  onOpenAuth?: () => void
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeId,
  onSelect,
  isOpen,
  onToggle,
  refreshSignal,
  fileCountOverride,
  isGuest = false,
  onOpenAuth,
}) => {

  // Seed state instantly from cache so sidebar never shows blank
  const [conversations, setConversations] = useState<Conversation[]>(() => getCachedConversations() ?? [])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [convToDelete, setConvToDelete] = useState<{ id: string; title: string } | null>(null)

  const fetchConversations = async () => {
    try {
      const list = await listConversations()
      setConversations(list)
    } catch (e) {
      console.warn('Failed to load conversations', e)
    }
  }

  useEffect(() => {
    fetchConversations()

    // Listen to global file change events for instant file count badge updates
    const handleGlobalFileChange = (e: any) => {
      if (e.detail?.conversationId && typeof e.detail.count === 'number') {
        const targetId = e.detail.conversationId
        const count = e.detail.count
        setConversations((prev) =>
          prev.map((c) => (c.id === targetId ? { ...c, file_count: count } : c))
        )
      }
      // Only re-fetch from server when fully synced, avoiding overwriting optimistic deletes
      if (e.detail?.action === 'sync' || e.detail?.action === 'upload_complete') {
        fetchConversations()
      }
    }
    window.addEventListener('trace_files_changed', handleGlobalFileChange)
    return () => window.removeEventListener('trace_files_changed', handleGlobalFileChange)
  }, [activeId, refreshSignal])

  useEffect(() => {
    if (fileCountOverride && Object.keys(fileCountOverride).length > 0) {
      setConversations((prev) =>
        prev.map((c) =>
          fileCountOverride[c.id] !== undefined
            ? { ...c, file_count: fileCountOverride[c.id] }
            : c
        )
      )
    }
  }, [fileCountOverride])

  const handleNewChat = () => {
    if (isGuest) {
      onOpenAuth?.()
      return
    }
    const tempId = `conv_${Math.random().toString(36).substring(2, 10)}`
    const optimisticConv: Conversation = {
      id: tempId,
      title: 'New Conversation',
      file_count: 0,
      message_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_demo: false,
    }
    // Instantly update sidebar UI and select new conversation with 0ms latency
    setConversations((prev) => [optimisticConv, ...prev])
    onSelect(tempId)

    // Asynchronously sync with backend in background
    createConversation('New Conversation', tempId).catch((err) => {
      console.warn('Notice syncing new conversation in background:', err)
    })
  }



  const confirmDeleteConversation = async () => {
    if (!convToDelete) return
    const { id } = convToDelete
    setConvToDelete(null)

    try {
      await deleteConversation(id)
      const remaining = conversations.filter((c) => c.id !== id)
      setConversations(remaining)
      if (activeId === id) {
        if (remaining.length > 0) {
          onSelect(remaining[0].id)
        } else {
          handleNewChat()
        }
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleStartRename = (e: React.MouseEvent, id: string, currentTitle: string) => {
    e.stopPropagation()
    setEditingId(id)
    setEditTitle(currentTitle)
  }

  const handleSaveRename = async (id: string) => {
    if (!editTitle.trim()) {
      setEditingId(null)
      return
    }
    try {
      await renameConversation(id, editTitle.trim())
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title: editTitle.trim() } : c))
      )
    } catch (e) {
      console.error(e)
    } finally {
      setEditingId(null)
    }
  }

  return (
    <>
      {/* Mobile-only backdrop */}
      {isOpen && (
        <div
          onClick={onToggle}
          className="sidebar-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 40,
          }}
        />
      )}

      <aside
        style={{
          width: isOpen ? '280px' : '0px',
          minWidth: isOpen ? '280px' : '0px',
          maxWidth: isOpen ? '280px' : '0px',
          transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          background: '#0c101b',
          borderRight: isOpen ? '1px solid var(--border-color)' : 'none',
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          position: 'sticky',
          top: 0,
          overflow: 'hidden',
          zIndex: 45,
          flexShrink: 0,
        }}
      >
        {/* Sidebar Header with New Chat Button */}
        <div style={{ padding: '1.25rem 1rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <div
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.9rem',
                  fontWeight: 800,
                  color: '#fff',
                }}
              >
                T
              </div>
              <span style={{ fontWeight: 700, fontSize: '1.05rem', letterSpacing: '-0.02em', color: '#fff' }}>
                Trace RAG
              </span>
            </div>

            <button
              onClick={onToggle}
              title="Close sidebar"
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '0.85rem',
                padding: '0.25rem 0.45rem',
                borderRadius: '6px',
              }}
            >
              ◀
            </button>
          </div>

          <button
            onClick={handleNewChat}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '10px',
              padding: '0.7rem 1rem',
              color: 'var(--text-primary)',
              fontSize: '0.9rem',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)')}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>✍️</span>
              <span>New chat</span>
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>+</span>
          </button>
        </div>

        {/* Conversations List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '0.5rem 0.5rem 0.25rem', letterSpacing: '0.05em' }}>
            Recents
          </div>

          {(() => {
            const displayList =
              conversations.length > 0
                ? conversations
                : activeId
                ? [{ id: activeId, title: 'New Conversation', file_count: 0, message_count: 0 }]
                : []

            if (displayList.length === 0) {
              return (
                <div style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: '0.82rem', textAlign: 'center' }}>
                  No sessions yet. Click "New chat" above.
                </div>
              )
            }

            return displayList.map((conv) => {
              const isActive = conv.id === activeId
              const isEditing = editingId === conv.id

              return (
                <div
                  key={conv.id}
                  onClick={() => onSelect(conv.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.6rem 0.75rem',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    background: isActive ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                    border: `1px solid ${isActive ? 'rgba(59, 130, 246, 0.35)' : 'transparent'}`,
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', overflow: 'hidden', flex: 1 }}>
                    <span style={{ fontSize: '0.9rem', opacity: isActive ? 1 : 0.6 }}>
                      {conv.is_demo || conv.id === 'conv_demo' ? '🌟' : '💬'}
                    </span>

                    {isEditing ? (
                      <input
                        autoFocus
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onBlur={() => handleSaveRename(conv.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveRename(conv.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          background: '#161e31',
                          border: '1px solid var(--accent-blue)',
                          borderRadius: '4px',
                          color: '#fff',
                          padding: '0.15rem 0.4rem',
                          fontSize: '0.82rem',
                          width: '100%',
                          outline: 'none',
                        }}
                      />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', overflow: 'hidden' }}>
                        <span
                          style={{
                            fontSize: '0.85rem',
                            color: isActive ? '#fff' : 'var(--text-secondary)',
                            fontWeight: isActive ? 600 : 400,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={conv.title}
                        >
                          {conv.title}
                        </span>
                        {(conv.is_demo || conv.id === 'conv_demo') && (
                          <span
                            style={{
                              fontSize: '0.64rem',
                              fontWeight: 700,
                              background: 'rgba(234, 179, 8, 0.18)',
                              color: '#fbbf24',
                              border: '1px solid rgba(234, 179, 8, 0.35)',
                              borderRadius: '4px',
                              padding: '0.05rem 0.3rem',
                              flexShrink: 0,
                            }}
                          >
                            DEMO
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions & File Count */}
                  {!isEditing && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginLeft: '0.4rem' }}>
                      {(() => {
                        const count = (fileCountOverride && fileCountOverride[conv.id] !== undefined)
                          ? fileCountOverride[conv.id]
                          : (conv.file_count || 0)
                        if (count <= 0) return null
                        return (
                          <span
                            style={{
                              fontSize: '0.7rem',
                              background: isActive ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255, 255, 255, 0.08)',
                              color: isActive ? '#93c5fd' : 'var(--text-muted)',
                              padding: '0.1rem 0.4rem',
                              borderRadius: '8px',
                              fontWeight: 500,
                            }}
                          >
                            {count}
                          </span>
                        )
                      })()}

                      {!(isGuest && (conv.is_demo || conv.id === 'conv_demo')) && (
                        <button
                          onClick={(e) => handleStartRename(e, conv.id, conv.title)}
                          title="Rename conversation"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                            padding: '0.1rem 0.2rem',
                            opacity: isActive ? 0.8 : 0.3,
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                          onMouseLeave={(e) => (e.currentTarget.style.opacity = isActive ? '0.8' : '0.3')}
                        >
                          ✏️
                        </button>
                      )}

                      {/* Do not allow deleting the canonical demo conversation */}
                      {conv.id !== 'conv_demo' && !conv.is_demo && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setConvToDelete({ id: conv.id, title: conv.title })
                          }}
                          title="Delete conversation"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                            padding: '0.1rem 0.2rem',
                            opacity: isActive ? 0.8 : 0.3,
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = '#ef4444'
                            e.currentTarget.style.opacity = '1'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = 'var(--text-muted)'
                            e.currentTarget.style.opacity = isActive ? '0.8' : '0.3'
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  )}

                </div>
              )
            })
          })()}
        </div>


        {/* Sidebar Footer */}
        <div style={{ padding: '0.85rem 1rem', borderTop: '1px solid var(--border-color)', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Trace v0.2.0</span>
          <span>⚡ Gemini + Supabase</span>
        </div>
      </aside>

      {/* Conversation Delete Confirmation Modal */}
      {convToDelete && (
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
          onClick={() => setConvToDelete(null)}
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
              🗑️
            </div>

            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc', marginBottom: '0.6rem', letterSpacing: '-0.01em' }}>
              Delete Chat Session?
            </h3>

            <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: '1.75rem', lineHeight: '1.55' }}>
              Are you sure you want to delete <strong style={{ color: '#fca5a5' }}>"{convToDelete.title}"</strong> and all its associated documents and knowledge graphs?
            </p>

            <div style={{ display: 'flex', gap: '0.85rem', justifyContent: 'center' }}>
              <button
                onClick={() => setConvToDelete(null)}
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
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.14)'
                  e.currentTarget.style.color = '#fff'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
                  e.currentTarget.style.color = '#cbd5e1'
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteConversation}
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
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)'
                  e.currentTarget.style.boxShadow = '0 6px 18px rgba(239, 68, 68, 0.55)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'none'
                  e.currentTarget.style.boxShadow = '0 4px 14px rgba(239, 68, 68, 0.4)'
                }}
              >
                Yes, Delete Session
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
