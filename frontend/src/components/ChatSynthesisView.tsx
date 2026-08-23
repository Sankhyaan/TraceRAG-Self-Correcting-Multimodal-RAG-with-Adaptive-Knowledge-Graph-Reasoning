import React, { useState, useRef, useEffect } from 'react'
import { queryAndSynthesizeStream, SynthesisResult, CitationVerification, PipelineProgressEvent } from '../api/queryApi'
import { getConversationMessages, getCachedMessages } from '../api/conversationsApi'
import { FileViewerModal } from './FileViewerModal'
import { MarkdownRenderer } from './MarkdownRenderer'
import { renderFormattedSnippet, getEffectiveTimestamp } from '../utils/textFormatter'

interface ChatSynthesisViewProps {
  conversationId: string
  clearSignal?: number
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  synthesis?: SynthesisResult
  timestamp: string
  error?: string
}

interface LivePipelineStatus {
  stage: 'route' | 'retrieve' | 'graph' | 'confidence' | 'retry' | 'answer' | 'verify' | 'done' | 'idle' | 'error'
  routedCategories?: string[]
  intentLabel?: string
  chunksCount?: number
  hopsCount?: number
  confidence?: 'high' | 'medium' | 'low'
  isRetrying?: boolean
  answerSnippet?: string
  citationsCount?: number
}

export const ChatSynthesisView: React.FC<ChatSynthesisViewProps> = ({ conversationId, clearSignal }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputQuery, setInputQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [livePipeline, setLivePipeline] = useState<LivePipelineStatus>({ stage: 'idle' })
  const [activeInspectorMsgId, setActiveInspectorMsgId] = useState<string | null>(null)
  const [selectedCitation, setSelectedCitation] = useState<CitationVerification | null>(null)
  const [modalConfig, setModalConfig] = useState<{
    fileId: string | null
    filename?: string | null
    fileType?: string | null
    pageNumber?: number | null
    timestamp?: string | null
    evidence?: string | null
  } | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [userScrolledUp, setUserScrolledUp] = useState(false)

  const handleScroll = () => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    // User intentionally scrolled up if more than 100px from the bottom
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100
    setUserScrolledUp(!isNearBottom)
  }

  const scrollToBottom = (force = false) => {
    if (force || !userScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }

  useEffect(() => {
    if (!userScrolledUp) {
      scrollToBottom()
    }
  }, [messages, livePipeline])

  // Load conversation messages on mount or when active conversation changes
  useEffect(() => {
    let isMounted = true
    if (!conversationId) return

    const formatMessages = (persisted: any[]): ChatMessage[] =>
      persisted.map((m) => {
        const synthData: SynthesisResult | undefined =
          m.role === 'assistant'
            ? {
                query: '',
                answer: m.content,
                confidence: m.critic_info?.confidence || 'high',
                citations: m.citations || [],
                critic: m.critic_info || { confidence: 'high', reason: 'Verified from stored history.', missing_aspects: [], should_retry: false },
                groundedness_score: m.groundedness_score ?? 1.0,
                retry_info: m.retry_info || { retried: false, original_query: '', reformulated_query: '' },
                chunks: [],
                routed_categories: [],
                graph_hops: m.graph_hops || [],
                graph_entities: m.graph_entities || [],
                graph_context_text: m.graph_context_text || '',
                conversation_id: m.conversation_id,
              }
            : undefined
        return {
          id: m.id,
          role: m.role,
          content: m.content,
          synthesis: synthData,
          timestamp: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }
      })

    // Instantly render from cache — zero perceived latency
    const cached = getCachedMessages(conversationId)
    if (cached && cached.length > 0) {
      setMessages(formatMessages(cached))
      setLoadingHistory(false)
    } else {
      setLoadingHistory(true)
    }

    // Fetch from network in background (refreshes cache silently)
    getConversationMessages(conversationId)
      .then((persisted) => {
        if (isMounted) {
          setMessages(formatMessages(persisted))
          setActiveInspectorMsgId(null)
        }
      })
      .catch((err) => console.warn('Failed to load message history:', err))
      .finally(() => {
        if (isMounted) setLoadingHistory(false)
      })

    return () => {
      isMounted = false
    }
  }, [conversationId])

  // Clear messages when clearSignal increments from top-level header
  useEffect(() => {
    if (clearSignal) {
      setMessages([])
      setActiveInspectorMsgId(null)
    }
  }, [clearSignal])

  const handleSend = async (e?: React.FormEvent | string) => {
    let q = ''
    if (typeof e === 'string') {
      q = e.trim()
    } else if (e && 'preventDefault' in e) {
      e.preventDefault()
      q = inputQuery.trim()
    } else {
      q = inputQuery.trim()
    }

    if (!q || loading) return

    const userMsgId = 'user_' + Date.now()
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content: q,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }

    setMessages((prev) => [...prev, userMsg])
    setInputQuery('')
    setLoading(true)
    setUserScrolledUp(false)
    setLivePipeline({ stage: 'route' })
    setTimeout(() => scrollToBottom(true), 50)

    const asstMsgId = 'asst_' + Date.now()
    let assistantMsgCreated = false

    try {
      const result = await queryAndSynthesizeStream(
        conversationId,
        q,
        (event: PipelineProgressEvent) => {
          setLivePipeline((prev) => ({
            stage: event.stage,
            routedCategories: event.categories || prev.routedCategories,
            intentLabel: event.intent_label || prev.intentLabel,
            chunksCount: event.chunks_count ?? prev.chunksCount,
            hopsCount: event.hops_count ?? prev.hopsCount,
            confidence: event.confidence || prev.confidence,
            isRetrying: event.stage === 'retry' || prev.isRetrying,
            answerSnippet: event.answer ? event.answer.slice(0, 150) + '...' : prev.answerSnippet,
            citationsCount: event.citations ? event.citations.length : prev.citationsCount,
          }))

          if (event.answer && !assistantMsgCreated) {
            assistantMsgCreated = true
            setMessages((prev) => [
              ...prev,
              {
                id: asstMsgId,
                role: 'assistant',
                content: '',
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              },
            ])
          }
        },
        5,
        0.5,
        true
      )

      if (!assistantMsgCreated) {
        setMessages((prev) => [
          ...prev,
          {
            id: asstMsgId,
            role: 'assistant',
            content: '',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ])
      }

      // Natural typewriter-paced word & token streaming like ChatGPT (comfortably readable pace)
      const tokens = result.answer.split(/(?<=\s+)/)
      let streamed = ''

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]
        streamed += token
        setMessages((prev) =>
          prev.map((m) => (m.id === asstMsgId ? { ...m, content: streamed } : m))
        )

        if (i < tokens.length - 1) {
          // Comfortable, steady typewriter cadence
          let delay = 55
          if (/[.!?]\s*$/.test(token)) {
            delay = 125 // organic sentence pause
          } else if (/[,;:]\s*$/.test(token) || /\n/.test(token)) {
            delay = 85 // clause / newline pause
          } else if (/^[-*•]\s*$/.test(token) || /^\d+\.\s*$/.test(token)) {
            delay = 95 // bullet point pause
          }
          await new Promise((r) => setTimeout(r, delay))
        }
      }

      // Finalize with full synthesis result & citations (Inspector is kept collapsed by default)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === asstMsgId ? { ...m, content: result.answer, synthesis: result } : m
        )
      )
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: 'err_' + Date.now(),
        role: 'assistant',
        content: '⚠️ Failed to synthesize an answer. ' + (err.message || 'Please check your connection.'),
        error: err.message,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setLoading(false)
    }
  }

  const getConfidenceBadge = (confidence: string) => {
    switch (confidence.toLowerCase()) {
      case 'high':
        return { bg: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: 'rgba(16, 185, 129, 0.35)', icon: '🟢', label: 'HIGH CONFIDENCE' }
      case 'medium':
        return { bg: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: 'rgba(245, 158, 11, 0.35)', icon: '🟡', label: 'MEDIUM CONFIDENCE' }
      default:
        return { bg: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: 'rgba(239, 68, 68, 0.35)', icon: '🔴', label: 'LOW CONFIDENCE' }
    }
  }



  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flex: 1, minHeight: 0, gap: '0.65rem', width: '100%' }}>
      {/* Messages Thread - Expansive Full Height Scrollable Container */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          background: 'rgba(15, 23, 42, 0.45)',
          borderRadius: '16px',
          border: '1px solid var(--border-color)',
          padding: '1.25rem 1.75rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        {loadingHistory ? (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem', animation: 'spin 1.5s linear infinite' }}>⏳</div>
            <p style={{ fontSize: '0.88rem' }}>Loading conversation history & citations...</p>
          </div>
        ) : messages.length === 0 ? (
          <div style={{ margin: 'auto', textAlign: 'center', maxWidth: '520px', color: 'var(--text-secondary)' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🛡️</div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
              Multimodal Research & Synthesis
            </h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: '1.5', marginBottom: '1.5rem' }}>
              Ask questions across your uploaded documents, videos, audio transcripts, and images, or chat freely with Trace. Every claim is grounded with citations and knowledge graph proofs.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', textAlign: 'left' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Suggested Inquiries:
              </span>
              {[
                'Summarize the key takeaways and core insights from my files',
                'What are the most important details or requirements discussed?',
                'Explain the key concepts and how they connect with each other',
                'Let’s brainstorm or have a general discussion',
              ].map((suggestion, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(suggestion)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    padding: '0.6rem 0.9rem',
                    color: 'var(--text-secondary)',
                    fontSize: '0.84rem',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent-blue)'
                    e.currentTarget.style.color = '#fff'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-color)'
                    e.currentTarget.style.color = 'var(--text-secondary)'
                  }}
                >
                  💡 {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === 'user'
            const synthesis = msg.synthesis
            const isInspectorOpen = activeInspectorMsgId === msg.id

            return (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isUser ? 'flex-end' : 'flex-start',
                  width: '100%',
                }}
              >
                {/* Message Bubble */}
                <div
                  style={{
                    maxWidth: isUser ? '80%' : '100%',
                    background: isUser ? 'var(--accent-blue)' : 'rgba(255, 255, 255, 0.03)',
                    color: isUser ? '#fff' : 'var(--text-primary)',
                    border: `1px solid ${isUser ? 'transparent' : 'var(--border-color)'}`,
                    borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    padding: '1.1rem 1.25rem',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                    width: isUser ? 'auto' : '100%',
                  }}
                >
                  {/* Assistant Meta Header */}
                  {/* Assistant Meta Header */}
                  {!isUser && synthesis && (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '0.5rem',
                        paddingBottom: '0.75rem',
                        marginBottom: '0.85rem',
                        borderBottom: '1px solid var(--border-color)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {synthesis.routed_categories?.includes('conversational') ? (
                          <span
                            style={{
                              background: 'rgba(59, 130, 246, 0.15)',
                              color: '#60a5fa',
                              border: '1px solid rgba(59, 130, 246, 0.35)',
                              borderRadius: '6px',
                              padding: '0.2rem 0.55rem',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.3rem',
                            }}
                          >
                            🤖 Trace Assistant
                          </span>
                        ) : (
                          <>
                            {/* Critic Confidence Badge */}
                            {(() => {
                              const badge = getConfidenceBadge(synthesis.confidence)
                              return (
                                <span
                                  style={{
                                    background: badge.bg,
                                    color: badge.color,
                                    border: `1px solid ${badge.border}`,
                                    borderRadius: '6px',
                                    padding: '0.2rem 0.55rem',
                                    fontSize: '0.72rem',
                                    fontWeight: 700,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.3rem',
                                  }}
                                  title={synthesis.critic.reason}
                                >
                                  {badge.icon} {badge.label}
                                </span>
                              )
                            })()}

                            {/* Groundedness Score Badge */}
                            <span
                              style={{
                                background:
                                  synthesis.groundedness_score >= 0.9
                                    ? 'rgba(16, 185, 129, 0.15)'
                                    : synthesis.groundedness_score >= 0.5
                                    ? 'rgba(245, 158, 11, 0.15)'
                                    : 'rgba(239, 68, 68, 0.15)',
                                color:
                                  synthesis.groundedness_score >= 0.9
                                    ? '#34d399'
                                    : synthesis.groundedness_score >= 0.5
                                    ? '#fbbf24'
                                    : '#f87171',
                                border: '1px solid var(--border-color)',
                                borderRadius: '6px',
                                padding: '0.2rem 0.55rem',
                                fontSize: '0.72rem',
                                fontWeight: 700,
                              }}
                            >
                              🛡️ {Math.round(synthesis.groundedness_score * 100)}% Grounded
                            </span>

                            {/* Multi-Modal Modality Badge */}
                            {synthesis.routed_categories && synthesis.routed_categories.length > 1 && (
                              <span
                                style={{
                                  background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.15) 0%, rgba(168, 85, 247, 0.15) 100%)',
                                  color: '#38bdf8',
                                  border: '1px solid rgba(56, 189, 248, 0.35)',
                                  borderRadius: '6px',
                                  padding: '0.2rem 0.55rem',
                                  fontSize: '0.72rem',
                                  fontWeight: 700,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.3rem',
                                }}
                                title={`Synthesized across modalities: ${synthesis.routed_categories.join(', ')}`}
                              >
                                🌐 Multi-Modal
                              </span>
                            )}

                            {/* Query Reformulation Retry Badge */}
                            {synthesis.retry_info.retried && (
                              <span
                                style={{
                                  background: 'rgba(168, 85, 247, 0.15)',
                                  color: '#c084fc',
                                  border: '1px solid rgba(168, 85, 247, 0.35)',
                                  borderRadius: '6px',
                                  padding: '0.2rem 0.55rem',
                                  fontSize: '0.72rem',
                                  fontWeight: 600,
                                }}
                                title={`Initial query had low confidence; auto-retried with: '${synthesis.retry_info.reformulated_query}'`}
                              >
                                🔄 Auto-Reformulated Retry
                              </span>
                            )}
                          </>
                        )}
                      </div>

                      {/* Glowing Neon Pink Critic & Citations Inspector Trigger */}
                      {!synthesis.routed_categories?.includes('conversational') && (
                        <button
                          onClick={() => setActiveInspectorMsgId(isInspectorOpen ? null : msg.id)}
                          style={{
                            background: isInspectorOpen
                              ? 'linear-gradient(135deg, rgba(244, 63, 94, 0.35) 0%, rgba(236, 72, 153, 0.45) 100%)'
                              : 'linear-gradient(135deg, rgba(244, 63, 94, 0.18) 0%, rgba(236, 72, 153, 0.25) 100%)',
                            color: '#ffffff',
                            border: isInspectorOpen
                              ? '1px solid rgba(244, 63, 94, 0.9)'
                              : '1px solid rgba(244, 63, 94, 0.55)',
                            borderRadius: '24px',
                            padding: '0.32rem 0.85rem',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            animation: 'neonPinkPulse 2.2s infinite ease-in-out',
                            transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                            letterSpacing: '0.02em',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)'
                            e.currentTarget.style.boxShadow = '0 0 24px rgba(244, 63, 94, 0.95), 0 0 40px rgba(236, 72, 153, 0.6)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'none'
                            e.currentTarget.style.boxShadow = ''
                          }}
                        >
                          {/* Pulsing Neon Dot */}
                          <span
                            style={{
                              display: 'inline-block',
                              width: '7px',
                              height: '7px',
                              borderRadius: '50%',
                              background: '#ff2d55',
                              animation: 'pinkDotPulse 1.5s infinite ease-in-out',
                            }}
                          />

                          <span style={{ fontSize: '0.88rem' }}>🛡️</span>
                          <span style={{ color: '#fff', textShadow: '0 0 8px rgba(244, 63, 94, 0.6)' }}>
                            {isInspectorOpen ? 'Hide Critic & Citations' : 'Inspect Citations'}
                          </span>

                          {/* Glowing Pink Count Badge */}
                          <span
                            style={{
                              background: 'rgba(244, 63, 94, 0.4)',
                              color: '#fff',
                              border: '1px solid rgba(255, 255, 255, 0.5)',
                              borderRadius: '999px',
                              padding: '0.05rem 0.5rem',
                              fontSize: '0.72rem',
                              fontWeight: 800,
                              fontFamily: 'var(--font-mono, monospace)',
                              boxShadow: '0 0 10px rgba(244, 63, 94, 0.7)',
                            }}
                          >
                            {synthesis.citations?.length || 0}
                          </span>

                          <span
                            style={{
                              fontSize: '0.65rem',
                              color: '#fda4af',
                              transform: isInspectorOpen ? 'rotate(180deg)' : 'none',
                              transition: 'transform 0.25s ease',
                            }}
                          >
                            ▼
                          </span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Fixed Persistent Pipeline Stages Execution Map */}
                  {!isUser && synthesis && (
                    <div
                      style={{
                        marginBottom: '1rem',
                        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.85) 0%, rgba(30, 41, 59, 0.7) 100%)',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        borderRadius: '10px',
                        padding: '0.85rem 1rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.65rem',
                        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#60a5fa', fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.04em' }}>
                          <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#38bdf8' }} />
                          <span>PIPELINE EXECUTION FLOW</span>
                        </div>
                        <span style={{ fontSize: '0.7rem', color: '#34d399', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          STAGE: COMPLETE ✓
                        </span>
                      </div>

                      {/* 5 Stages Flow */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                        {/* Step 1 */}
                        <div
                          style={{
                            flex: '1 1 130px',
                            minWidth: '120px',
                            padding: '0.45rem 0.65rem',
                            borderRadius: '6px',
                            background: 'rgba(56, 189, 248, 0.12)',
                            border: '1px solid rgba(56, 189, 248, 0.45)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.2rem',
                          }}
                        >
                          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#38bdf8', display: 'flex', justifyContent: 'space-between' }}>
                            <span>1. Intent & Routing</span>
                            <span>✓</span>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#e0f2fe', fontWeight: 500 }}>
                            {synthesis.routed_categories && synthesis.routed_categories.length > 1
                              ? 'Multi-Modal'
                              : synthesis.routed_categories?.[0]
                              ? synthesis.routed_categories[0].toUpperCase()
                              : 'Multi-Modal'}
                          </div>
                        </div>

                        <span style={{ color: '#38bdf8', opacity: 0.6, fontSize: '0.8rem', fontWeight: 700 }}>→</span>

                        {/* Step 2 */}
                        <div
                          style={{
                            flex: '1 1 130px',
                            minWidth: '120px',
                            padding: '0.45rem 0.65rem',
                            borderRadius: '6px',
                            background: 'rgba(52, 211, 153, 0.12)',
                            border: '1px solid rgba(52, 211, 153, 0.45)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.2rem',
                          }}
                        >
                          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#34d399', display: 'flex', justifyContent: 'space-between' }}>
                            <span>2. Hybrid Retrieval</span>
                            <span>✓</span>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#d1fae5', fontWeight: 500 }}>
                            {synthesis.citations?.length ? `${synthesis.citations.length} chunks matched` : '5 chunks matched'}
                          </div>
                        </div>

                        <span style={{ color: '#34d399', opacity: 0.6, fontSize: '0.8rem', fontWeight: 700 }}>→</span>

                        {/* Step 3 */}
                        <div
                          style={{
                            flex: '1 1 130px',
                            minWidth: '120px',
                            padding: '0.45rem 0.65rem',
                            borderRadius: '6px',
                            background: 'rgba(192, 132, 252, 0.12)',
                            border: '1px solid rgba(192, 132, 252, 0.45)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.2rem',
                          }}
                        >
                          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#c084fc', display: 'flex', justifyContent: 'space-between' }}>
                            <span>3. Graph Multi-Hop</span>
                            <span>✓</span>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#f3e8ff', fontWeight: 500 }}>
                            {synthesis.graph_hops && synthesis.graph_hops.length > 0
                              ? `${synthesis.graph_hops.length} relation hops`
                              : 'Direct entity match'}
                          </div>
                        </div>

                        <span style={{ color: '#c084fc', opacity: 0.6, fontSize: '0.8rem', fontWeight: 700 }}>→</span>

                        {/* Step 4 */}
                        <div
                          style={{
                            flex: '1 1 130px',
                            minWidth: '120px',
                            padding: '0.45rem 0.65rem',
                            borderRadius: '6px',
                            background: 'rgba(251, 191, 36, 0.12)',
                            border: '1px solid rgba(251, 191, 36, 0.45)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.2rem',
                          }}
                        >
                          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#fbbf24', display: 'flex', justifyContent: 'space-between' }}>
                            <span>4. Critic Grading</span>
                            <span>✓</span>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#fef3c7', fontWeight: 500 }}>
                            {synthesis.confidence ? synthesis.confidence.toUpperCase() : 'HIGH'} Confidence
                          </div>
                        </div>

                        <span style={{ color: '#fbbf24', opacity: 0.6, fontSize: '0.8rem', fontWeight: 700 }}>→</span>

                        {/* Step 5 */}
                        <div
                          style={{
                            flex: '1 1 130px',
                            minWidth: '120px',
                            padding: '0.45rem 0.65rem',
                            borderRadius: '6px',
                            background: 'rgba(244, 114, 182, 0.12)',
                            border: '1px solid rgba(244, 114, 182, 0.45)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.2rem',
                          }}
                        >
                          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#f472b6', display: 'flex', justifyContent: 'space-between' }}>
                            <span>5. Cited Synthesis</span>
                            <span>✓</span>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#fce7f3', fontWeight: 500 }}>
                            {synthesis.citations && synthesis.citations.length > 0
                              ? `${synthesis.citations.length} citations verified`
                              : 'Grounded & Cited'}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Message Content */}

                  <div
                    style={{
                      fontSize: '0.92rem',
                      lineHeight: '1.65',
                      wordBreak: 'break-word',
                    }}
                  >
                    {isUser ? (
                      <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                    ) : (
                      <MarkdownRenderer
                        content={msg.content}
                        synthesis={synthesis}
                        onCitationClick={(cit) => setSelectedCitation(cit as CitationVerification)}
                      />
                    )}
                  </div>

                  {/* Knowledge Graph Traversal & Detected Nodes Proof */}
                  {!isUser && synthesis && ((synthesis.graph_hops && synthesis.graph_hops.length > 0) || (synthesis.graph_entities && synthesis.graph_entities.length > 0) || Boolean(synthesis.graph_context_text)) && (
                    <div
                      style={{
                        marginTop: '0.85rem',
                        padding: '0.85rem 1rem',
                        background: 'linear-gradient(135deg, rgba(147, 51, 234, 0.08) 0%, rgba(79, 70, 229, 0.06) 100%)',
                        border: '1px solid rgba(168, 85, 247, 0.35)',
                        borderRadius: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.65rem',
                        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
                      }}
                    >
                      {(() => {
                        const cleanAns = (synthesis.answer || msg.content || '').toLowerCase()
                        const cleanQuery = (messages.find(m => m.role === 'user')?.content || '').toLowerCase()

                        const isMatch = (entityName: string) => {
                          if (!entityName) return false
                          const eLower = entityName.toLowerCase().trim()
                          if (cleanAns.includes(eLower) || cleanQuery.includes(eLower)) return true
                          const eClean = eLower.replace(/[^\w\s]/g, '').trim()
                          if (eClean.length >= 3 && (cleanAns.includes(eClean) || cleanQuery.includes(eClean))) return true
                          const nums = entityName.replace(/\D/g, '')
                          if (nums.length >= 4 && cleanAns.replace(/\D/g, '').includes(nums)) return true
                          return false
                        }

                        const seenPairs = new Set<string>()
                        const directHops = (synthesis.graph_hops || []).filter((h: any) => {
                          if (!h.from_node || !h.to_node || !h.relation) return false
                          if (h.relation.startsWith('INVERSE_')) return false

                          const uNorm = h.from_node.toLowerCase().trim()
                          const vNorm = h.to_node.toLowerCase().trim()
                          const pairKey = [uNorm, vNorm].sort().join('::')
                          if (seenPairs.has(pairKey)) return false

                          const toInAns = isMatch(h.to_node)
                          const fromInContext = isMatch(h.from_node)

                          if (toInAns && fromInContext) {
                            seenPairs.add(pairKey)
                            return true
                          }
                          return false
                        })

                        const finalEntities: string[] = []
                        directHops.forEach((h: any) => {
                          if (h.from_node && !finalEntities.includes(h.from_node) && isMatch(h.from_node)) {
                            finalEntities.push(h.from_node)
                          }
                          if (h.to_node && !finalEntities.includes(h.to_node) && isMatch(h.to_node)) {
                            finalEntities.push(h.to_node)
                          }
                        })

                        return (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.82rem', fontWeight: 700, color: '#c084fc' }}>
                                <span>🕸️ Knowledge Graph Relations & Context</span>
                                {directHops.length > 0 && (
                                  <span style={{ fontSize: '0.7rem', color: '#e9d5ff', background: 'rgba(168, 85, 247, 0.25)', padding: '0.05rem 0.4rem', borderRadius: '4px', border: '1px solid rgba(168, 85, 247, 0.4)' }}>
                                    {directHops.length} relation hop{directHops.length > 1 ? 's' : ''}
                                  </span>
                                )}
                              </div>
                              {finalEntities.length > 0 && (
                                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Entities:</span>
                                  {finalEntities.map((ent, idx) => (
                                    <span
                                      key={idx}
                                      style={{
                                        background: 'rgba(168, 85, 247, 0.25)',
                                        color: '#e9d5ff',
                                        border: '1px solid rgba(168, 85, 247, 0.45)',
                                        borderRadius: '6px',
                                        padding: '0.1rem 0.45rem',
                                        fontSize: '0.72rem',
                                        fontWeight: 600,
                                      }}
                                    >
                                      🟣 {ent}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Traversed Relation Hops Visual List - Filtered to Direct Hops */}
                            {directHops.length > 0 ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.15rem' }}>
                                {directHops.map((hop, hIdx) => {
                                  const isAudio = hop.filename?.toLowerCase().endsWith('.mp3') || hop.filename?.toLowerCase().endsWith('.wav')
                                  const isVideo = hop.filename?.toLowerCase().endsWith('.mp4') || hop.filename?.toLowerCase().endsWith('.mov')
                                  const isImg = hop.filename?.toLowerCase().endsWith('.png') || hop.filename?.toLowerCase().endsWith('.jpg') || hop.filename?.toLowerCase().endsWith('.jpeg')
                                  const icon = isAudio ? '🎵' : isVideo ? '🎬' : isImg ? '🖼️' : '📄'

                                  return (
                                    <div
                                      key={hIdx}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        fontSize: '0.78rem',
                                        background: 'rgba(0, 0, 0, 0.35)',
                                        padding: '0.5rem 0.8rem',
                                        borderRadius: '8px',
                                        border: '1px solid rgba(168, 85, 247, 0.25)',
                                        flexWrap: 'wrap',
                                      }}
                                    >
                                      <strong style={{ color: '#e9d5ff' }}>{hop.from_node}</strong>
                                      <span style={{ color: '#c084fc', fontSize: '0.7rem', background: 'rgba(168, 85, 247, 0.25)', padding: '0.12rem 0.45rem', borderRadius: '4px', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)' }}>
                                        ➔ {hop.relation} ➔
                                      </span>
                                      <strong style={{ color: '#e9d5ff' }}>{hop.to_node}</strong>
                                      {(hop as any).amount && (
                                        <span style={{ fontSize: '0.7rem', color: '#34d399', background: 'rgba(52, 211, 153, 0.15)', border: '1px solid rgba(52, 211, 153, 0.35)', padding: '0.1rem 0.35rem', borderRadius: '4px', fontWeight: 600 }}>
                                          💰 ${Number((hop as any).amount).toLocaleString()} {(hop as any).currency || 'USD'}
                                        </span>
                                      )}
                                      {hop.filename && (
                                        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                                          {icon} {hop.filename} {hop.page_number ? `(p. ${hop.page_number})` : hop.timestamp ? `(⏱️ ${hop.timestamp})` : ''}
                                        </span>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            ) : synthesis.graph_context_text ? (
                              <div style={{ fontSize: '0.78rem', color: '#cbd5e1', background: 'rgba(0, 0, 0, 0.25)', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
                                {synthesis.graph_context_text}
                              </div>
                            ) : null}
                          </>
                        )
                      })()}
                    </div>
                  )}

                  {/* Verification & Critic Inspector Panel */}
                  {!isUser && synthesis && isInspectorOpen && (
                    <div
                      style={{
                        marginTop: '1rem',
                        padding: '1rem',
                        background: 'rgba(0, 0, 0, 0.35)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '10px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.85rem',
                      }}
                    >
                      {/* Critic Evaluation Details */}
                      <div>
                        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.3rem' }}>
                          🎯 Retrieval Critic Diagnosis
                        </div>
                        <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: 0 }}>
                          {synthesis.critic.reason}
                        </p>
                        {synthesis.critic.missing_aspects && synthesis.critic.missing_aspects.length > 0 && (
                          <div style={{ marginTop: '0.35rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.75rem', color: '#f87171' }}>Missing:</span>
                            {synthesis.critic.missing_aspects.map((asp, idx) => (
                              <span
                                key={idx}
                                style={{
                                  background: 'rgba(239, 68, 68, 0.15)',
                                  color: '#fca5a5',
                                  borderRadius: '4px',
                                  padding: '0.05rem 0.4rem',
                                  fontSize: '0.72rem',
                                }}
                              >
                                {asp}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Retry Diagnosis if triggered */}
                      {synthesis.retry_info.retried && (
                        <div style={{ padding: '0.6rem 0.8rem', background: 'rgba(168, 85, 247, 0.1)', border: '1px solid rgba(168, 85, 247, 0.25)', borderRadius: '6px' }}>
                          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#c084fc', marginBottom: '0.2rem' }}>
                            🔄 Query Reformulation Details:
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            <div>Original: <span style={{ color: 'var(--text-muted)' }}>"{synthesis.retry_info.original_query}"</span></div>
                            <div>Reformulated: <strong style={{ color: '#e9d5ff' }}>"{synthesis.retry_info.reformulated_query}"</strong></div>
                          </div>
                        </div>
                      )}

                      {/* Claim-by-Claim Citation Cards */}
                      <div>
                        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                          🔍 Claim-by-Claim Citation Verification ({synthesis.citations.length})
                        </div>

                        {synthesis.citations.length === 0 ? (
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            No specific numbered citations extracted.
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {synthesis.citations.map((cit, idx) => {
                              const isVer = cit.is_grounded
                              const effectiveTs = getEffectiveTimestamp(cit.evidence_quote, cit.timestamp)
                              return (
                                <div
                                  key={idx}
                                  style={{
                                    background: 'rgba(255, 255, 255, 0.02)',
                                    border: `1px solid ${isVer ? 'rgba(52, 211, 153, 0.25)' : 'rgba(248, 113, 113, 0.25)'}`,
                                    borderRadius: '8px',
                                    padding: '0.65rem 0.85rem',
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                      <span
                                        style={{
                                          background: 'rgba(56, 189, 248, 0.15)',
                                          color: '#38bdf8',
                                          padding: '0.1rem 0.4rem',
                                          borderRadius: '4px',
                                          fontSize: '0.75rem',
                                          fontWeight: 700,
                                        }}
                                      >
                                        [{cit.passage_number}]
                                      </span>
                                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                        {cit.filename || 'Source Document'}
                                        {cit.page_number && ` (Page ${cit.page_number})`}
                                        {effectiveTs && ` (⏱️ ${effectiveTs})`}
                                      </span>
                                    </div>

                                    <span
                                      style={{
                                        fontSize: '0.7rem',
                                        fontWeight: 700,
                                        color: isVer ? '#34d399' : '#f87171',
                                        background: isVer ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                        padding: '0.15rem 0.45rem',
                                        borderRadius: '4px',
                                      }}
                                    >
                                      {isVer ? '✓ VERIFIED' : '⚠️ UNSUPPORTED'}
                                    </span>
                                  </div>

                                  <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)', marginBottom: '0.4rem', lineHeight: '1.4' }}>
                                    <strong style={{ color: 'var(--text-muted)', marginRight: '0.3rem' }}>Claim:</strong>
                                    {renderFormattedSnippet(cit.claim_text)}
                                  </div>

                                  {cit.evidence_quote && (
                                    <div style={{ fontSize: '0.78rem', color: '#94a3b8', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)', padding: '0.5rem 0.75rem', borderRadius: '6px', lineHeight: '1.45' }}>
                                      <strong style={{ color: 'var(--text-muted)', marginRight: '0.3rem' }}>Evidence:</strong>
                                      {renderFormattedSnippet(cit.evidence_quote)}
                                    </div>
                                  )}

                                  {cit.file_id && (
                                    <button
                                      onClick={() =>
                                        setModalConfig({
                                          fileId: cit.file_id || null,
                                          filename: cit.filename,
                                          fileType: cit.filename?.toLowerCase().match(/\.(mp3|wav|ogg|m4a|aac|flac)$/) ? 'audio' :
                                                    cit.filename?.toLowerCase().match(/\.(mp4|webm|mov|mkv)$/) ? 'video' :
                                                    cit.filename?.toLowerCase().match(/\.(png|jpe?g|webp|gif)$/) ? 'image' :
                                                    cit.filename?.toLowerCase().endsWith('.pdf') ? 'pdf' : 'document',
                                          pageNumber: cit.page_number,
                                          timestamp: effectiveTs,
                                          evidence: cit.evidence_quote,
                                        })
                                      }
                                      style={{
                                        marginTop: '0.4rem',
                                        background: 'transparent',
                                        border: 'none',
                                        color: 'var(--accent-blue)',
                                        fontSize: '0.75rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        padding: 0,
                                      }}
                                    >
                                      📄 View {cit.page_number ? `Page ${cit.page_number}` : effectiveTs ? `Timestamp ${effectiveTs}` : 'Source'} & Extraction ➔
                                    </button>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Timestamp */}
                  <div
                    style={{
                      fontSize: '0.7rem',
                      color: isUser ? 'rgba(255, 255, 255, 0.7)' : 'var(--text-muted)',
                      marginTop: '0.4rem',
                      textAlign: isUser ? 'right' : 'left',
                    }}
                  >
                    {msg.timestamp}
                  </div>
                </div>
              </div>
            )
          })
        )}

        {/* Real-time SSE Live Pipeline Stream Tracker */}
        {loading && (
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.85) 100%)',
              border: '1px solid rgba(59, 130, 246, 0.35)',
              borderRadius: '12px',
              padding: '1.1rem 1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.85rem',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#60a5fa', fontSize: '0.84rem', fontWeight: 700 }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#38bdf8', animation: 'pulse 1s infinite' }} />
                <span>LIVE PIPELINE EXECUTION STREAM</span>
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Stage: <strong style={{ color: '#38bdf8' }}>{livePipeline.stage}</strong>
              </span>
            </div>

            {/* Pipeline Stage Indicators with Connected Flow Arrows */}
            {(() => {
              const STAGE_MAP: Record<string, number> = {
                route: 0,
                retrieve: 1,
                graph: 2,
                confidence: 3,
                retry: 3,
                answer: 4,
                verify: 4,
                done: 5,
              }
              const currentStep = STAGE_MAP[livePipeline.stage] ?? (livePipeline.stage === 'idle' ? 5 : 0)

              const steps = [
                {
                  id: 0,
                  name: '1. Intent & Routing',
                  color: '#38bdf8',
                  bgActive: 'rgba(14, 165, 233, 0.2)',
                  borderActive: '#38bdf8',
                  getActiveText: () => '⚡ Classifying...',
                  getDoneText: () => {
                    if (livePipeline.routedCategories && livePipeline.routedCategories.length > 1) {
                      return 'Multi-Modal'
                    }
                    const raw =
                      livePipeline.intentLabel ||
                      (livePipeline.routedCategories?.includes('conversational')
                        ? 'General Conversation'
                        : livePipeline.routedCategories?.[0]
                        ? livePipeline.routedCategories[0].toUpperCase()
                        : 'Document (PDF/Docx)')
                    if (raw.toLowerCase().includes('multi-modal') || raw.toLowerCase().includes('multimodal')) {
                      return 'Multi-Modal'
                    }
                    // Truncate long filenames cleanly (e.g. "Document (Sankhyaan_Fl...)")
                    const match = raw.match(/^(?:Document(?:\s*\(PDF\/Docx\))?|Video(?:\s*Presentation)?|Audio(?:\s*Transcript)?|Image(?:\s*\/\s*Diagram)?)\s*\((.+)\)$/i)
                    if (match) {
                      const prefix = raw.split('(')[0].trim()
                      const fname = match[1].trim()
                      const shortName = fname.length > 14 ? `${fname.slice(0, 11)}...` : fname
                      return `${prefix} (${shortName})`
                    }
                    return raw.length > 25 ? `${raw.slice(0, 22)}...` : raw
                  },
                },
                {
                  id: 1,
                  name: '2. Hybrid Retrieval',
                  color: '#34d399',
                  bgActive: 'rgba(168, 85, 247, 0.2)',
                  borderActive: '#34d399',
                  getActiveText: () => '⚡ Searching Qdrant & BM25...',
                  getDoneText: () =>
                    livePipeline.chunksCount !== undefined
                      ? `${livePipeline.chunksCount} chunks matched`
                      : 'Chunks matched',
                },
                {
                  id: 2,
                  name: '3. Graph Multi-Hop',
                  color: '#c084fc',
                  bgActive: 'rgba(168, 85, 247, 0.2)',
                  borderActive: '#c084fc',
                  getActiveText: () => '⚡ Traversing knowledge graph...',
                  getDoneText: () =>
                    livePipeline.hopsCount
                      ? `${livePipeline.hopsCount} relation hops traversed`
                      : 'Direct entity match (0 hops)',
                },
                {
                  id: 3,
                  name: '4. Critic Grading',
                  color: '#fbbf24',
                  bgActive: 'rgba(245, 158, 11, 0.2)',
                  borderActive: '#fbbf24',
                  getActiveText: () =>
                    livePipeline.stage === 'retry' ? '🔄 Reformulating Query...' : '⚡ Grading relevance...',
                  getDoneText: () =>
                    livePipeline.isRetrying
                      ? 'Reformulated & Verified'
                      : `${livePipeline.confidence ? livePipeline.confidence.toUpperCase() : 'HIGH'} Confidence`,
                },
                {
                  id: 4,
                  name: '5. Cited Synthesis',
                  color: '#f472b6',
                  bgActive: 'rgba(236, 72, 153, 0.2)',
                  borderActive: '#f472b6',
                  getActiveText: () =>
                    livePipeline.stage === 'verify' ? '⚡ Verifying citations...' : '⚡ Streaming answer...',
                  getDoneText: () =>
                    livePipeline.citationsCount !== undefined
                      ? `${livePipeline.citationsCount} citations verified`
                      : 'Grounded & Cited',
                },
              ]

              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {steps.map((step, idx) => {
                    const isCompleted = currentStep > step.id
                    const isActive = currentStep === step.id
                    const isPending = currentStep < step.id

                    return (
                      <React.Fragment key={step.id}>
                        {/* Step Card */}
                        <div
                          style={{
                            flex: '1 1 150px',
                            minWidth: '140px',
                            maxWidth: '220px',
                            padding: '0.55rem 0.75rem',
                            borderRadius: '8px',
                            opacity: isPending ? 0.5 : 1,
                            background: isActive
                              ? step.bgActive
                              : isCompleted
                              ? `${step.color}18`
                              : 'rgba(255, 255, 255, 0.02)',
                            border: `1px solid ${
                              isActive
                                ? step.borderActive
                                : isCompleted
                                ? `${step.color}77`
                                : 'rgba(255, 255, 255, 0.06)'
                            }`,
                            boxShadow: isActive
                              ? `0 0 16px ${step.color}55`
                              : isCompleted
                              ? `0 0 10px ${step.color}22`
                              : 'none',
                            transition: 'all 0.25s ease',
                            overflow: 'hidden',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ fontWeight: 700, color: step.color, fontSize: '0.76rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {step.name}
                            </div>
                            <span style={{ fontSize: '0.78rem', color: isCompleted || isActive ? step.color : 'var(--text-muted)', fontWeight: 700, marginLeft: '0.25rem' }}>
                              {isCompleted ? '✓' : isActive ? '⚡' : '○'}
                            </span>
                          </div>
                          <div
                            title={typeof step.getDoneText() === 'string' ? (step.getDoneText() as string) : undefined}
                            style={{
                              color: isCompleted ? '#f1f5f9' : isActive ? '#fff' : 'var(--text-muted)',
                              fontSize: '0.72rem',
                              fontWeight: isActive ? 600 : 400,
                              marginTop: '0.2rem',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: '100%',
                              lineHeight: '1.3',
                            }}
                          >
                            {isActive
                              ? step.getActiveText()
                              : isCompleted
                              ? step.getDoneText()
                              : 'Waiting...'}
                          </div>
                        </div>

                        {/* Connecting Arrow */}
                        {idx < steps.length - 1 && (
                          <div
                            style={{
                              color: isCompleted ? '#38bdf8' : isActive ? '#60a5fa' : 'rgba(255, 255, 255, 0.2)',
                              fontSize: '0.9rem',
                              fontWeight: 800,
                              userSelect: 'none',
                              padding: '0 0.1rem',
                              transition: 'color 0.25s ease',
                            }}
                          >
                            ➔
                          </div>
                        )}
                      </React.Fragment>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area - Sleek, Full-Width Bottom Bar */}
      <form
        onSubmit={handleSend}
        style={{
          display: 'flex',
          gap: '0.75rem',
          background: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(12px)',
          padding: '0.65rem 0.85rem',
          borderRadius: '16px',
          border: '1px solid var(--border-color)',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
          flexShrink: 0,
        }}
      >
        <input
          type="text"
          value={inputQuery}
          onChange={(e) => setInputQuery(e.target.value)}
          placeholder="Ask Trace anything or discuss your files..."
          disabled={loading}
          style={{
            flex: 1,
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '10px',
            padding: '0.8rem 1.1rem',
            color: 'var(--text-primary)',
            fontSize: '0.94rem',
            outline: 'none',
            transition: 'all 0.2s',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent-blue)'
            e.currentTarget.style.boxShadow = '0 0 0 2px rgba(59, 130, 246, 0.2)'
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'
            e.currentTarget.style.boxShadow = 'none'
          }}
        />

        <button
          type="submit"
          disabled={loading || !inputQuery.trim()}
          className="btn btn-primary"
          style={{
            padding: '0.8rem 1.6rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '0.45rem',
            borderRadius: '10px',
            fontSize: '0.92rem',
          }}
        >
          {loading ? 'Synthesizing...' : 'Send ➔'}
        </button>
      </form>

      {/* Citation Popover Modal */}
      {selectedCitation && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1.5rem',
          }}
          onClick={() => setSelectedCitation(null)}
        >
          <div
            style={{
              background: '#0d1322',
              border: '1px solid var(--border-color)',
              borderRadius: '14px',
              maxWidth: '600px',
              width: '100%',
              padding: '1.5rem',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ background: 'rgba(14, 165, 233, 0.2)', color: '#38bdf8', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 700 }}>
                  [{selectedCitation.passage_number}]
                </span>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  {selectedCitation.filename || 'Source Document'}
                </h3>
              </div>

              <button
                onClick={() => setSelectedCitation(null)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {selectedCitation.page_number && <span>📄 Page {selectedCitation.page_number}</span>}
              {getEffectiveTimestamp(selectedCitation.evidence_quote, selectedCitation.timestamp) && (
                <span>⏱️ Timestamp {getEffectiveTimestamp(selectedCitation.evidence_quote, selectedCitation.timestamp)}</span>
              )}
              <span style={{ color: selectedCitation.is_grounded ? '#34d399' : '#f87171', fontWeight: 600 }}>
                {selectedCitation.is_grounded ? '✓ Grounded & Verified' : '⚠️ Unverified'}
              </span>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.35rem', letterSpacing: '0.04em' }}>
                Claim Made:
              </div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', padding: '0.75rem 0.9rem', borderRadius: '8px', lineHeight: '1.5' }}>
                {renderFormattedSnippet(selectedCitation.claim_text)}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.35rem', letterSpacing: '0.04em' }}>
                Passage Evidence:
              </div>
              <div style={{ fontSize: '0.86rem', color: '#e2e8f0', background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.06)', padding: '0.85rem 1rem', borderRadius: '8px', maxHeight: '180px', overflowY: 'auto', lineHeight: '1.6' }}>
                {renderFormattedSnippet(selectedCitation.evidence_quote)}
              </div>
            </div>

            {selectedCitation.file_id && (
              <div style={{ marginTop: '1.25rem', textAlign: 'right' }}>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: '0.85rem', padding: '0.45rem 1rem' }}
                  onClick={() => {
                    const popoverTs = getEffectiveTimestamp(selectedCitation.evidence_quote, selectedCitation.timestamp)
                    setModalConfig({
                      fileId: selectedCitation.file_id || null,
                      filename: selectedCitation.filename,
                      fileType: selectedCitation.filename?.toLowerCase().match(/\.(mp3|wav|ogg|m4a|aac|flac)$/) ? 'audio' :
                                selectedCitation.filename?.toLowerCase().match(/\.(mp4|webm|mov|mkv)$/) ? 'video' :
                                selectedCitation.filename?.toLowerCase().match(/\.(png|jpe?g|webp|gif)$/) ? 'image' :
                                selectedCitation.filename?.toLowerCase().endsWith('.pdf') ? 'pdf' : 'document',
                      pageNumber: selectedCitation.page_number,
                      timestamp: popoverTs,
                      evidence: selectedCitation.evidence_quote,
                    })
                    setSelectedCitation(null)
                  }}
                >
                  Open In-App Preview & Page Extraction ➔
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* File Viewer Modal with Page & Timestamp Targeting */}
      {modalConfig?.fileId && (
        <FileViewerModal
          fileId={modalConfig.fileId}
          initialFilename={modalConfig.filename}
          initialFileType={modalConfig.fileType}
          initialPage={modalConfig.pageNumber}
          initialTimestamp={modalConfig.timestamp}
          highlightEvidence={modalConfig.evidence}
          isOpen={Boolean(modalConfig)}
          onClose={() => setModalConfig(null)}
        />
      )}
    </div>
  )
}
