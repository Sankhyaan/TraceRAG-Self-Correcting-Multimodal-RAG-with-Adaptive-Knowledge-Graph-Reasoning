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
  const [selectedCitation, setSelectedCitation] = useState<CitationVerification | null>(null)
  const [inspectingSynthesis, setInspectingSynthesis] = useState<SynthesisResult | null>(null)
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
          setInspectingSynthesis(null)
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
      setInspectingSynthesis(null)
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
                    background: isUser
                      ? 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)'
                      : 'rgba(15, 23, 42, 0.75)',
                    backdropFilter: 'blur(16px)',
                    color: isUser ? '#fff' : 'var(--text-primary)',
                    border: isUser
                      ? '1px solid rgba(255, 255, 255, 0.15)'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    padding: '1.15rem 1.35rem',
                    boxShadow: isUser
                      ? '0 6px 20px rgba(37, 99, 235, 0.35)'
                      : '0 8px 30px rgba(0, 0, 0, 0.35)',
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

                      {/* Sleek Citations & Grounding Inspector Trigger */}
                      {!synthesis.routed_categories?.includes('conversational') && (
                        <button
                          onClick={() => setInspectingSynthesis(synthesis)}
                          style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            color: '#f8fafc',
                            border: '1px solid rgba(255, 255, 255, 0.12)',
                            borderRadius: '8px',
                            padding: '0.35rem 0.8rem',
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.45rem',
                            transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(99, 102, 241, 0.18)'
                            e.currentTarget.style.borderColor = 'rgba(129, 140, 248, 0.45)'
                            e.currentTarget.style.color = '#ffffff'
                            e.currentTarget.style.transform = 'translateY(-1px)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)'
                            e.currentTarget.style.color = '#f8fafc'
                            e.currentTarget.style.transform = 'none'
                          }}
                        >
                          <span style={{ fontSize: '0.85rem' }}>🛡️</span>
                          <span>Inspect Citations</span>
                          <span
                            style={{
                              background: 'rgba(99, 102, 241, 0.25)',
                              color: '#a5b4fc',
                              border: '1px solid rgba(129, 140, 248, 0.35)',
                              borderRadius: '999px',
                              padding: '0.05rem 0.45rem',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              fontFamily: 'var(--font-mono, monospace)',
                            }}
                          >
                            {synthesis.citations?.length || 0}
                          </span>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>↗</span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Sleek Execution Pipeline Breadcrumb */}
                  {!isUser && synthesis && (
                    <div
                      style={{
                        marginBottom: '0.9rem',
                        background: 'rgba(15, 23, 42, 0.55)',
                        border: '1px solid rgba(255, 255, 255, 0.07)',
                        borderRadius: '8px',
                        padding: '0.55rem 0.85rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '0.5rem',
                        fontSize: '0.74rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: '#94a3b8', fontWeight: 600, letterSpacing: '0.02em' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38bdf8', display: 'inline-block' }} />
                        <span style={{ textTransform: 'uppercase', fontSize: '0.68rem', color: '#cbd5e1', fontWeight: 700 }}>Pipeline:</span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                        <span style={{ color: '#38bdf8', fontWeight: 600 }}>1. Intent & Routing</span>
                        <span style={{ color: '#475569', fontSize: '0.7rem' }}>➔</span>
                        <span style={{ color: '#34d399', fontWeight: 600 }}>2. Hybrid Retrieval ({synthesis.citations?.length || 5})</span>
                        <span style={{ color: '#475569', fontSize: '0.7rem' }}>➔</span>
                        <span style={{ color: '#c084fc', fontWeight: 600 }}>3. Graph Multi-Hop</span>
                        <span style={{ color: '#475569', fontSize: '0.7rem' }}>➔</span>
                        <span style={{ color: '#fbbf24', fontWeight: 600 }}>4. Critic Verification</span>
                        <span style={{ color: '#475569', fontSize: '0.7rem' }}>➔</span>
                        <span style={{ color: '#34d399', fontWeight: 700 }}>5. Cited Synthesis ✓</span>
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
                        const seenPairs = new Set<string>()
                        const displayHops = (synthesis.graph_hops || []).filter((h) => {
                          const pairKey = `${(h.from_node || '').trim()}::${(h.relation || '').trim()}::${(h.to_node || '').trim()}`.toLowerCase()
                          if (seenPairs.has(pairKey)) return false
                          seenPairs.add(pairKey)
                          return true
                        })

                        const hopEntities: string[] = Array.from(
                          new Set([
                            ...(synthesis.graph_entities || []),
                            ...displayHops.map((h) => h.from_node),
                            ...displayHops.map((h) => h.to_node),
                          ])
                        ).filter(Boolean)

                        return (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.82rem', fontWeight: 700, color: '#c084fc' }}>
                                <span>🕸️ Knowledge Graph Relations & Reasoning</span>
                                {displayHops.length > 0 && (
                                  <span style={{ fontSize: '0.7rem', color: '#e9d5ff', background: 'rgba(168, 85, 247, 0.25)', padding: '0.05rem 0.45rem', borderRadius: '4px', border: '1px solid rgba(168, 85, 247, 0.4)' }}>
                                    {displayHops.length} entity relation{displayHops.length > 1 ? 's' : ''}
                                  </span>
                                )}
                              </div>
                              {hopEntities.length > 0 && (
                                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Entities:</span>
                                  {hopEntities.map((ent: string, idx: number) => (
                                    <span
                                      key={idx}
                                      style={{
                                        background: 'rgba(168, 85, 247, 0.22)',
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

                            {/* Traversed Relation Hops Visual List */}
                            {displayHops.length > 0 ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.25rem' }}>
                                {displayHops.map((hop, hIdx) => {
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
                                        background: 'rgba(0, 0, 0, 0.4)',
                                        padding: '0.45rem 0.75rem',
                                        borderRadius: '8px',
                                        border: '1px solid rgba(168, 85, 247, 0.28)',
                                        flexWrap: 'wrap',
                                      }}
                                    >
                                      <strong style={{ color: '#e9d5ff' }}>{hop.from_node}</strong>
                                      <span style={{ color: '#c084fc', fontSize: '0.68rem', background: 'rgba(168, 85, 247, 0.25)', border: '1px solid rgba(168, 85, 247, 0.35)', padding: '0.1rem 0.45rem', borderRadius: '4px', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)' }}>
                                        ➔ {hop.relation} ➔
                                      </span>
                                      <strong style={{ color: '#e9d5ff' }}>{hop.to_node}</strong>
                                      {hop.filename && (
                                        <span style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: '0.7rem' }}>
                                          {icon} {hop.filename} {hop.page_number ? `(p. ${hop.page_number})` : hop.timestamp ? `(⏱️ ${hop.timestamp})` : ''}
                                        </span>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            ) : synthesis.graph_context_text ? (
                              <div style={{ fontSize: '0.8rem', color: '#e2e8f0', background: 'rgba(0, 0, 0, 0.35)', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid rgba(168, 85, 247, 0.25)', lineHeight: 1.5 }}>
                                <MarkdownRenderer content={synthesis.graph_context_text} onCitationClick={() => {}} />
                              </div>
                            ) : null}
                          </>
                        )
                      })()}
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

      {/* Quick Inquiries / Suggested Demo Questions Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.45rem',
          overflowX: 'auto',
          padding: '0.2rem 0.25rem',
          scrollbarWidth: 'none',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <span>💡</span> Quick Inquiries:
        </span>
        {[
          { label: 'VoltBus V3 Hardware & Stop 7 Incident', query: 'What hardware components and thermal thresholds govern the VoltBus V3 battery system, and what occurred during the July 12 incident at Stop 7?' },
          { label: 'Depot-Gamma SOP & Resistance Imbalance', query: 'What maintenance protocol is executed at Depot-Gamma following a thermal warning, and what were the findings for Unit #09?' },
          { label: 'Thermal Safety Flowchart (States 0–3)', query: 'What operational actions distinguish State 1 Warning from State 2 Critical and State 3 Emergency in the thermal safety flowchart?' },
          { label: 'Corridor Geography & Facility Roles', query: 'How are facility duties divided across the transit corridor between Depot-Alpha and Depot-Gamma?' },
          { label: 'Blueprint Specs: Drivetrain & Sensors', query: 'What are the exact voltage, capacity, motor drivetrain, and sensor specifications shown on the VoltBus V3 schematic?' },
        ].map((item, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleSend(item.query)}
            disabled={loading}
            style={{
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              borderRadius: '999px',
              padding: '0.28rem 0.7rem',
              color: '#e2e8f0',
              fontSize: '0.74rem',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              transition: 'all 0.15s ease',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.background = 'rgba(99, 102, 241, 0.25)'
                e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.75)'
                e.currentTarget.style.color = '#ffffff'
                e.currentTarget.style.transform = 'translateY(-1px)'
              }
            }}
            onMouseLeave={(e) => {
              if (!loading) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'
                e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.3)'
                e.currentTarget.style.color = '#e2e8f0'
                e.currentTarget.style.transform = 'none'
              }
            }}
          >
            <span>💬</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      {/* Input Area - Ultra-Modern, Colorful & Shiny Interactive Search Bar */}
      <form
        onSubmit={handleSend}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.92) 0%, rgba(30, 27, 75, 0.75) 50%, rgba(15, 23, 42, 0.92) 100%)',
          backdropFilter: 'blur(20px)',
          padding: '0.65rem 0.85rem',
          borderRadius: '18px',
          border: '1px solid rgba(99, 102, 241, 0.35)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45), 0 0 25px rgba(99, 102, 241, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.15)',
          flexShrink: 0,
          position: 'relative',
          transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Shiny Interactive Input Wrapper */}
        <div
          style={{
            flex: 1,
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(56, 189, 248, 0.25)',
            borderRadius: '12px',
            boxShadow: 'inset 0 2px 6px rgba(0, 0, 0, 0.3), 0 0 12px rgba(56, 189, 248, 0.08)',
            transition: 'all 0.2s ease',
          }}
          onFocusCapture={(e) => {
            e.currentTarget.style.borderColor = '#38bdf8'
            e.currentTarget.style.boxShadow = '0 0 22px rgba(56, 189, 248, 0.35), 0 0 8px rgba(99, 102, 241, 0.3), inset 0 0 12px rgba(56, 189, 248, 0.1)'
            e.currentTarget.style.background = 'rgba(15, 23, 42, 0.85)'
          }}
          onBlurCapture={(e) => {
            e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.25)'
            e.currentTarget.style.boxShadow = 'inset 0 2px 6px rgba(0, 0, 0, 0.3), 0 0 12px rgba(56, 189, 248, 0.08)'
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
          }}
        >
          {/* Radiant Shiny AI Search Icon */}
          <div
            style={{
              paddingLeft: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.3) 0%, rgba(6, 182, 212, 0.3) 100%)',
                border: '1px solid rgba(56, 189, 248, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1rem',
                boxShadow: '0 0 12px rgba(6, 182, 212, 0.35)',
              }}
            >
              ✨
            </div>
          </div>

          <input
            type="text"
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            placeholder="Ask Trace anything or discuss your files..."
            disabled={loading}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              padding: '0.85rem 0.9rem',
              color: '#f8fafc',
              fontSize: '0.95rem',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />

          {/* Quick Clear Input Button */}
          {inputQuery.length > 0 && !loading && (
            <button
              type="button"
              onClick={() => setInputQuery('')}
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                border: 'none',
                borderRadius: '50%',
                width: '24px',
                height: '24px',
                color: '#cbd5e1',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: '0.75rem',
                fontSize: '0.75rem',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.3)'
                e.currentTarget.style.color = '#fff'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
                e.currentTarget.style.color = '#cbd5e1'
              }}
              title="Clear text"
            >
              ✕
            </button>
          )}
        </div>

        {/* Shiny Interactive Colorful Send Button */}
        <button
          type="submit"
          disabled={loading || !inputQuery.trim()}
          style={{
            padding: '0.85rem 1.65rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            borderRadius: '12px',
            fontSize: '0.94rem',
            cursor: loading || !inputQuery.trim() ? 'not-allowed' : 'pointer',
            background: inputQuery.trim()
              ? 'linear-gradient(135deg, #6366f1 0%, #3b82f6 50%, #06b6d4 100%)'
              : 'linear-gradient(135deg, rgba(99, 102, 241, 0.18) 0%, rgba(59, 130, 246, 0.15) 100%)',
            border: inputQuery.trim()
              ? '1px solid rgba(255, 255, 255, 0.4)'
              : '1px solid rgba(99, 102, 241, 0.3)',
            color: inputQuery.trim() ? '#ffffff' : '#94a3b8',
            boxShadow: inputQuery.trim()
              ? '0 4px 20px rgba(99, 102, 241, 0.5), 0 0 16px rgba(6, 182, 212, 0.4)'
              : 'none',
            transform: 'none',
            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => {
            if (inputQuery.trim() && !loading) {
              e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)'
              e.currentTarget.style.boxShadow = '0 6px 26px rgba(99, 102, 241, 0.75), 0 0 22px rgba(6, 182, 212, 0.6)'
            }
          }}
          onMouseLeave={(e) => {
            if (inputQuery.trim() && !loading) {
              e.currentTarget.style.transform = 'none'
              e.currentTarget.style.boxShadow = '0 4px 20px rgba(99, 102, 241, 0.5), 0 0 16px rgba(6, 182, 212, 0.4)'
            }
          }}
        >
          {loading ? (
            <>
              <span
                style={{
                  display: 'inline-block',
                  width: '16px',
                  height: '16px',
                  border: '2px solid rgba(255, 255, 255, 0.3)',
                  borderTopColor: '#00f0ff',
                  borderRadius: '50%',
                  animation: 'spinSlow 0.8s linear infinite',
                }}
              />
              <span>Synthesizing...</span>
            </>
          ) : (
            <>
              <span>Send</span>
              <span style={{ fontSize: '1.05rem', transition: 'transform 0.15s ease' }}>➔</span>
            </>
          )}
        </button>
      </form>

      {/* Citation Popover Modal */}
      {selectedCitation && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(5, 8, 15, 0.85)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            padding: '1.5rem',
            animation: 'fadeIn 0.15s ease-out',
          }}
          onClick={() => setSelectedCitation(null)}
        >
          <div
            style={{
              background: '#0a0e17',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '14px',
              maxWidth: '620px',
              width: '100%',
              padding: '1.5rem',
              boxShadow: '0 25px 50px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.05)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.35)', padding: '0.15rem 0.55rem', borderRadius: '4px', fontWeight: 800, fontFamily: 'var(--font-mono, monospace)', fontSize: '0.82rem' }}>
                  [{selectedCitation.passage_number}]
                </span>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                  {selectedCitation.filename || 'Source Document'}
                </h3>
              </div>

              <button
                onClick={() => setSelectedCitation(null)}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '50%',
                  width: '28px',
                  height: '28px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
              {selectedCitation.page_number && <span style={{ color: '#38bdf8' }}>📄 Page {selectedCitation.page_number}</span>}
              {getEffectiveTimestamp(selectedCitation.evidence_quote, selectedCitation.timestamp) && (
                <span style={{ color: '#fb923c' }}>⏱️ Timestamp {getEffectiveTimestamp(selectedCitation.evidence_quote, selectedCitation.timestamp)}</span>
              )}
              <span style={{ color: selectedCitation.is_grounded ? '#34d399' : '#f87171', fontWeight: 600 }}>
                {selectedCitation.is_grounded ? '✓ Grounded & Verified' : '⚠️ Unverified'}
              </span>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.35rem', letterSpacing: '0.04em' }}>
                Synthesized Claim:
              </div>
              <div style={{ fontSize: '0.88rem', color: 'var(--text-primary)', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', padding: '0.75rem 0.9rem', borderRadius: '8px', lineHeight: '1.5' }}>
                {renderFormattedSnippet(selectedCitation.claim_text)}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', marginBottom: '0.35rem', letterSpacing: '0.04em' }}>
                Verifiable Evidence Passage:
              </div>
              <div style={{ fontSize: '0.84rem', color: '#cbd5e1', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.06)', padding: '0.85rem 1rem', borderRadius: '8px', maxHeight: '180px', overflowY: 'auto', lineHeight: '1.6' }}>
                {renderFormattedSnippet(selectedCitation.evidence_quote)}
              </div>
            </div>

            {selectedCitation.file_id && (
              <div style={{ marginTop: '1.25rem', textAlign: 'right' }}>
                {(() => {
                  const popoverTs = getEffectiveTimestamp(selectedCitation.evidence_quote, selectedCitation.timestamp)
                  const isAud = selectedCitation.filename?.toLowerCase().match(/\.(mp3|wav|ogg|m4a|aac|flac)$/)
                  const isVid = selectedCitation.filename?.toLowerCase().match(/\.(mp4|webm|mov|mkv)$/)
                  const isIm = selectedCitation.filename?.toLowerCase().match(/\.(png|jpe?g|webp|gif|svg)$/)
                  const typeIcon = isAud ? '🎵' : isVid ? '🎬' : isIm ? '🖼️' : '📄'
                  const btnLabel = isAud
                    ? `Play Audio Segment ${popoverTs ? `(⏱️ ${popoverTs})` : ''}`
                    : isVid
                    ? `Play Video Clip ${popoverTs ? `(⏱️ ${popoverTs})` : ''}`
                    : isIm
                    ? 'Inspect Schematic / Image'
                    : selectedCitation.page_number
                    ? `View Document (Page ${selectedCitation.page_number})`
                    : 'View Source Document'

                  return (
                    <button
                      className="btn btn-primary"
                      style={{
                        fontSize: '0.82rem',
                        padding: '0.45rem 1.1rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.45rem',
                        fontWeight: 600,
                        borderRadius: '6px',
                      }}
                      onClick={() => {
                        setModalConfig({
                          fileId: selectedCitation.file_id || null,
                          filename: selectedCitation.filename,
                          fileType: isAud ? 'audio' : isVid ? 'video' : isIm ? 'image' : selectedCitation.filename?.toLowerCase().endsWith('.pdf') ? 'pdf' : 'document',
                          pageNumber: selectedCitation.page_number,
                          timestamp: popoverTs,
                          evidence: selectedCitation.evidence_quote,
                        })
                        setSelectedCitation(null)
                      }}
                    >
                      <span>{typeIcon}</span>
                      <span>{btnLabel} ➔</span>
                    </button>
                  )
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Citations & Grounding Inspector In-App Window Modal ──────────── */}
      {inspectingSynthesis && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(5, 8, 15, 0.88)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2500,
            padding: '1.25rem',
            animation: 'fadeIn 0.15s ease-out',
          }}
          onClick={() => setInspectingSynthesis(null)}
        >
          <div
            style={{
              background: '#090d16',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '16px',
              maxWidth: '860px',
              width: '100%',
              maxHeight: '88vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 30px 70px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.05)',
              animation: 'scaleUp 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '1.15rem 1.6rem',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(255, 255, 255, 0.02)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '1.3rem' }}>🛡️</div>
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc', margin: 0, letterSpacing: '-0.01em' }}>
                    Grounded Citations & Retrieval Audit
                  </h3>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span>{inspectingSynthesis.citations?.length || 0} verified passages</span>
                    <span>•</span>
                    <span style={{ color: '#34d399', fontWeight: 600 }}>
                      {Math.round((inspectingSynthesis.groundedness_score ?? 1) * 100)}% Grounded
                    </span>
                    <span>•</span>
                    <span style={{ color: inspectingSynthesis.confidence === 'high' ? '#34d399' : inspectingSynthesis.confidence === 'medium' ? '#fbbf24' : '#f87171', fontWeight: 700 }}>
                      ● {(inspectingSynthesis.confidence || 'HIGH').toUpperCase()} CONFIDENCE
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setInspectingSynthesis(null)}
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#cbd5e1',
                  fontSize: '1rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'
                  e.currentTarget.style.color = '#f87171'
                  e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'
                  e.currentTarget.style.color = '#cbd5e1'
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Body (Scrollable) */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '1.25rem 1.6rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.15rem',
              }}
            >
              {/* Critic Evaluation Diagnostics Card */}
              {inspectingSynthesis.critic && (
                <div
                  style={{
                    padding: '0.9rem 1.1rem',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(99, 102, 241, 0.25)',
                    borderRadius: '10px',
                  }}
                >
                  <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#a5b4fc', textTransform: 'uppercase', marginBottom: '0.3rem', letterSpacing: '0.04em' }}>
                    🎯 Retrieval Critic Assessment
                  </div>
                  <p style={{ fontSize: '0.84rem', color: '#e2e8f0', margin: 0, lineHeight: 1.5 }}>
                    {inspectingSynthesis.critic.reason}
                  </p>
                  {inspectingSynthesis.critic.missing_aspects && inspectingSynthesis.critic.missing_aspects.length > 0 && (
                    <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.72rem', color: '#f87171', fontWeight: 600 }}>Missing:</span>
                      {inspectingSynthesis.critic.missing_aspects.map((asp, idx) => (
                        <span
                          key={idx}
                          style={{
                            background: 'rgba(239, 68, 68, 0.15)',
                            color: '#fca5a5',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: '4px',
                            padding: '0.1rem 0.45rem',
                            fontSize: '0.72rem',
                          }}
                        >
                          {asp}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Claim-by-Claim Citation Cards */}
              <div>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc', marginBottom: '0.65rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Claim-by-Claim Verified Evidence ({inspectingSynthesis.citations?.length || 0})</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Click action to open target modal preview</span>
                </div>

                {!inspectingSynthesis.citations || inspectingSynthesis.citations.length === 0 ? (
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>
                    No specific numbered citations extracted for this response.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {inspectingSynthesis.citations.map((cit, idx) => {
                      const isVer = cit.is_grounded
                      const effectiveTs = getEffectiveTimestamp(cit.evidence_quote, cit.timestamp)
                      const isAudio = cit.filename?.toLowerCase().match(/\.(mp3|wav|ogg|m4a|aac|flac)$/)
                      const isVideo = cit.filename?.toLowerCase().match(/\.(mp4|webm|mov|mkv)$/)
                      const isImg = cit.filename?.toLowerCase().match(/\.(png|jpe?g|webp|gif|svg)$/)
                      const fileType = isAudio ? 'audio' : isVideo ? 'video' : isImg ? 'image' : cit.filename?.toLowerCase().endsWith('.pdf') ? 'pdf' : 'document'
                      const typeIcon = isAudio ? '🎵' : isVideo ? '🎬' : isImg ? '🖼️' : '📄'

                      const btnLabel = isAudio
                        ? `Play Audio Segment ${effectiveTs ? `(⏱️ ${effectiveTs})` : ''}`
                        : isVideo
                        ? `Play Video Clip ${effectiveTs ? `(⏱️ ${effectiveTs})` : ''}`
                        : isImg
                        ? 'Inspect Schematic / Image'
                        : cit.page_number
                        ? `View Document (Page ${cit.page_number})`
                        : 'View Source Document'

                      return (
                        <div
                          key={idx}
                          style={{
                            background: 'rgba(255, 255, 255, 0.02)',
                            border: `1px solid ${isVer ? 'rgba(52, 211, 153, 0.25)' : 'rgba(248, 113, 113, 0.25)'}`,
                            borderRadius: '10px',
                            padding: '0.85rem 1.05rem',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.55rem',
                          }}
                        >
                          {/* Citation Header */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                              <span
                                style={{
                                  background: 'rgba(56, 189, 248, 0.15)',
                                  color: '#38bdf8',
                                  border: '1px solid rgba(56, 189, 248, 0.35)',
                                  padding: '0.12rem 0.5rem',
                                  borderRadius: '4px',
                                  fontSize: '0.78rem',
                                  fontWeight: 800,
                                  fontFamily: 'var(--font-mono, monospace)',
                                }}
                              >
                                [{cit.passage_number}]
                              </span>
                              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <span>{typeIcon}</span>
                                <span>{cit.filename || 'Source File'}</span>
                                {cit.page_number && (
                                  <span style={{ color: '#38bdf8', fontSize: '0.75rem', background: 'rgba(56, 189, 248, 0.12)', padding: '0.05rem 0.35rem', borderRadius: '4px' }}>
                                    p. {cit.page_number}
                                  </span>
                                )}
                                {effectiveTs && (
                                  <span style={{ color: '#fb923c', fontSize: '0.75rem', background: 'rgba(249, 115, 22, 0.12)', padding: '0.05rem 0.35rem', borderRadius: '4px' }}>
                                    ⏱️ {effectiveTs}
                                  </span>
                                )}
                              </span>
                            </div>

                            <span
                              style={{
                                fontSize: '0.7rem',
                                fontWeight: 600,
                                color: isVer ? '#34d399' : '#f87171',
                                background: isVer ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                                border: `1px solid ${isVer ? 'rgba(52, 211, 153, 0.35)' : 'rgba(248, 113, 113, 0.35)'}`,
                                padding: '0.15rem 0.5rem',
                                borderRadius: '4px',
                              }}
                            >
                              {isVer ? '✓ Grounded' : '⚠️ Unverified'}
                            </span>
                          </div>

                          {/* Claim Box */}
                          <div style={{ fontSize: '0.84rem', color: '#f1f5f9', lineHeight: 1.5, background: 'rgba(255, 255, 255, 0.02)', padding: '0.55rem 0.8rem', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.04)' }}>
                            <strong style={{ color: 'var(--text-muted)', marginRight: '0.35rem', fontSize: '0.76rem' }}>CLAIM:</strong>
                            {renderFormattedSnippet(cit.claim_text)}
                          </div>

                          {/* Evidence Box */}
                          {cit.evidence_quote && (
                            <div style={{ fontSize: '0.8rem', color: '#cbd5e1', background: 'rgba(0, 0, 0, 0.4)', border: '1px solid rgba(255, 255, 255, 0.05)', padding: '0.6rem 0.8rem', borderRadius: '6px', lineHeight: 1.55 }}>
                              <strong style={{ color: '#38bdf8', marginRight: '0.35rem', fontSize: '0.74rem' }}>EVIDENCE:</strong>
                              {renderFormattedSnippet(cit.evidence_quote)}
                            </div>
                          )}

                          {/* Modality-Aware Target Action Button */}
                          {cit.file_id && (
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.15rem' }}>
                              <button
                                onClick={() => {
                                  setModalConfig({
                                    fileId: cit.file_id || null,
                                    filename: cit.filename,
                                    fileType: fileType,
                                    pageNumber: cit.page_number,
                                    timestamp: effectiveTs,
                                    evidence: cit.evidence_quote,
                                  })
                                }}
                                style={{
                                  background: 'rgba(56, 189, 248, 0.08)',
                                  border: '1px solid rgba(56, 189, 248, 0.3)',
                                  color: '#38bdf8',
                                  fontSize: '0.76rem',
                                  fontWeight: 600,
                                  padding: '0.32rem 0.8rem',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.4rem',
                                  transition: 'all 0.15s ease',
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'rgba(56, 189, 248, 0.2)'
                                  e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.6)'
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'rgba(56, 189, 248, 0.08)'
                                  e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.3)'
                                }}
                              >
                                <span>{typeIcon}</span>
                                <span>{btnLabel} ➔</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                padding: '0.85rem 1.6rem',
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(255, 255, 255, 0.015)',
              }}
            >
              <button
                onClick={() => setInspectingSynthesis(null)}
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  color: '#f8fafc',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '8px',
                  padding: '0.45rem 1.25rem',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                Close Audit Inspector
              </button>
            </div>
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
