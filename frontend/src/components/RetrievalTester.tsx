import React, { useState, useEffect } from 'react'
import { queryRetrieval, RetrievalResponse, DEFAULT_DEMO_RETRIEVAL } from '../api/retrievalApi'


interface RetrievalTesterProps {
  conversationId: string
}

const ORDINAL_PAIRS: Record<string, string> = {
  '1st': 'first', 'first': '1st', '2nd': 'second', 'second': '2nd',
  '3rd': 'third', 'third': '3rd', '4th': 'fourth', 'fourth': '4th',
  '5th': 'fifth', 'fifth': '5th', '6th': 'sixth', 'sixth': '6th',
  '7th': 'seventh', 'seventh': '7th', '8th': 'eighth', 'eighth': '8th',
  '9th': 'ninth', 'ninth': '9th', '10th': 'tenth', 'tenth': '10th',
}

const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at', 'be',
  'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'do', 'does',
  'did', 'doing', 'down', 'during', 'each', 'for', 'from', 'further', 'had', 'has', 'have',
  'having', 'he', 'her', 'here', 'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it',
  'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'no', 'nor', 'not', 'of', 'off', 'on',
  'once', 'only', 'or', 'other', 'our', 'out', 'over', 'own', 'same', 'she', 'should', 'so',
  'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'then', 'there', 'these',
  'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we',
  'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'you', 'your',
  'actually', 'instead', 'later', 'earlier', 'rather', 'explain', 'explained', 'reference',
  'show', 'tell', 'give', 'find', 'mentions', 'stated', 'talks', 'talking', 'also', 'well',
  'really', 'simply', 'basically', 'exactly', 'like', 'query', 'document', 'doc', 'docs', 'file',
  'files', 'information', 'detail', 'details', 'mention', 'mentioned', 'contain', 'contains',
  'say', 'says', 'said', 'ask', 'asked', 'please', 'help',
])

// ─────────────────────────────────────────────────────────────────────────────
// Utility: Clean raw OCR/Markdown artifact noise from chunk text
// ─────────────────────────────────────────────────────────────────────────────
function cleanChunkText(text: string): string {
  return text
    .replace(/\*\(Note:[^)]*\)\*/gi, '')           // *(Note: ...)*
    .replace(/\*\*([^*]+)\*\*/g, '$1')              // **bold**
    .replace(/\*([^*]+)\*/g, '$1')                  // *italic*
    .replace(/__([^_]+)__/g, '$1')                  // __underline__
    .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')          // _text_
    .replace(/#{1,6}\s*/g, '')                       // ### headings
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')        // [link](url) → link text
    .replace(/\s{2,}/g, ' ')                        // collapse 2+ spaces
    .replace(/\n{3,}/g, '\n\n')                      // collapse 3+ newlines
    .trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// Modality style config
// ─────────────────────────────────────────────────────────────────────────────
const MODALITY_STYLES: Record<string, { bg: string; text: string; border: string; icon: string; label: string; glow: string }> = {
  document: { bg: 'rgba(14, 165, 233, 0.12)', text: '#38bdf8', border: 'rgba(14, 165, 233, 0.35)', icon: '📄', label: 'Document', glow: 'rgba(14,165,233,0.3)' },
  image:    { bg: 'rgba(234, 179, 8, 0.12)',  text: '#facc15', border: 'rgba(234, 179, 8, 0.35)',  icon: '🖼️',  label: 'Image',    glow: 'rgba(234,179,8,0.3)' },
  audio:    { bg: 'rgba(249, 115, 22, 0.12)', text: '#fb923c', border: 'rgba(249, 115, 22, 0.35)', icon: '🎵',  label: 'Audio',    glow: 'rgba(249,115,22,0.3)' },
  video:    { bg: 'rgba(168, 85, 247, 0.12)', text: '#c084fc', border: 'rgba(168, 85, 247, 0.35)', icon: '🎬',  label: 'Video',    glow: 'rgba(168,85,247,0.3)' },
}
function getTypeStyle(type: string) {
  return MODALITY_STYLES[type] ?? { bg: 'rgba(148, 163, 184, 0.12)', text: '#cbd5e1', border: 'rgba(148,163,184,0.35)', icon: '📁', label: type, glow: 'rgba(148,163,184,0.2)' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Score bar component
// ─────────────────────────────────────────────────────────────────────────────
const ScoreBar: React.FC<{ pct: number; tier?: string | null; label: string; color: string }> = ({ pct, label, color }) => {
  const safeP = Math.min(100, Math.max(0, pct ?? 0))
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '135px 1fr 48px',
      alignItems: 'center',
      gap: '0.75rem',
      width: '100%',
    }}>
      <span style={{
        fontSize: '0.7rem',
        color: 'var(--text-muted)',
        whiteSpace: 'nowrap',
        textAlign: 'left',
        fontWeight: 500,
      }}>
        {label}
      </span>
      <div style={{
        width: '100%',
        height: '6px',
        background: 'rgba(255,255,255,0.06)',
        borderRadius: '3px',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${safeP}%`,
          height: '100%',
          background: color,
          borderRadius: '3px',
          transition: 'width 0.7s cubic-bezier(0.4,0,0.2,1)',
          boxShadow: `0 0 8px ${color}`,
        }} />
      </div>
      <span style={{
        fontSize: '0.7rem',
        fontFamily: 'var(--font-mono)',
        color,
        fontWeight: 700,
        textAlign: 'right',
      }}>
        {safeP.toFixed(1)}%
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Confidence tier badge
// ─────────────────────────────────────────────────────────────────────────────
const TierBadge: React.FC<{ tier: string | null | undefined }> = ({ tier }) => {
  if (!tier) return null
  const cfg: Record<string, { bg: string; text: string; border: string }> = {
    HIGH:   { bg: 'rgba(52,211,153,0.15)', text: '#34d399', border: 'rgba(52,211,153,0.35)' },
    MEDIUM: { bg: 'rgba(251,191,36,0.15)', text: '#fbbf24', border: 'rgba(251,191,36,0.35)' },
    LOW:    { bg: 'rgba(239,68,68,0.15)',  text: '#f87171', border: 'rgba(239,68,68,0.35)' },
  }
  const s = cfg[tier] ?? cfg.LOW
  return (
    <span style={{
      background: s.bg, color: s.text, border: `1px solid ${s.border}`,
      borderRadius: '5px', padding: '0.1rem 0.4rem', fontSize: '0.62rem', fontWeight: 800,
      letterSpacing: '0.05em', textTransform: 'uppercase',
    }}>
      {tier === 'HIGH' ? '●' : tier === 'MEDIUM' ? '◑' : '○'} {tier}
    </span>
  )
}



// ─────────────────────────────────────────────────────────────────────────────
// Highlighted snippet renderer (with inline timestamp badges & keyword marks)
// ─────────────────────────────────────────────────────────────────────────────
const TS_PATTERN = /^\[\d{1,2}:\d{2}(?::\d{2})?(?:\s*[-–]\s*\d{1,2}:\d{2}(?::\d{2})?)?\]$/

function renderHighlightedSnippet(fullText: string, searchPhrase: string, isExpanded: boolean) {
  const cleaned = cleanChunkText(fullText)
  const rawTerms = (searchPhrase.match(/\b[a-zA-Z0-9_]+\b/g) || [])
    .map((t) => t.toLowerCase())
    .filter((t) => !STOPWORDS.has(t) && t.length > 1)

  const highlightTerms = new Set<string>()
  rawTerms.forEach((t) => {
    highlightTerms.add(t)
    if (ORDINAL_PAIRS[t]) highlightTerms.add(ORDINAL_PAIRS[t])
  })

  let textToDisplay = cleaned
  let hasPrefixEllipsis = false
  let hasSuffixEllipsis = false

  if (!isExpanded) {
    let bestPos = -1
    for (const term of highlightTerms) {
      const idx = cleaned.toLowerCase().indexOf(term)
      if (idx !== -1) { bestPos = idx; break }
    }
    if (bestPos !== -1) {
      const start = Math.max(0, bestPos - 100)
      const end = Math.min(cleaned.length, bestPos + 240)
      hasPrefixEllipsis = start > 0
      hasSuffixEllipsis = end < cleaned.length
      textToDisplay = cleaned.substring(start, end)
    } else if (cleaned.length > 320) {
      textToDisplay = cleaned.substring(0, 300)
      hasSuffixEllipsis = true
    }
  }

  const tsRegex = '(\\[\\d{1,2}:\\d{2}(?::\d{2})?(?:\\s*[-–]\\s*\\d{1,2}:\\d{2}(?::\d{2})?)?\\])'
  let combinedPattern: RegExp
  if (highlightTerms.size > 0) {
    const kwPattern = Array.from(highlightTerms).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    combinedPattern = new RegExp(`${tsRegex}|\\b(${kwPattern})\\b`, 'gi')
  } else {
    combinedPattern = new RegExp(tsRegex, 'gi')
  }

  const parts = textToDisplay.split(combinedPattern).filter(Boolean)

  return (
    <span>
      {hasPrefixEllipsis && <span style={{ opacity: 0.4 }}>... </span>}
      {parts.map((part, i) => {
        // Inline timestamp badge
        if (TS_PATTERN.test(part.trim())) {
          return (
            <span
              key={i}
              style={{
                background: 'rgba(249, 115, 22, 0.15)',
                color: '#fb923c',
                border: '1px solid rgba(249, 115, 22, 0.35)',
                borderRadius: '4px',
                padding: '0.05rem 0.35rem',
                fontSize: '0.72rem',
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                margin: '0 0.2rem',
                display: 'inline-block',
                verticalAlign: 'middle',
              }}
            >
              ⏱️ {part.trim().replace(/^\[|\]$/g, '')}
            </span>
          )
        }

        // Search query keyword match
        if (highlightTerms.has(part.toLowerCase())) {
          return (
            <mark
              key={i}
              style={{
                background: 'rgba(245, 158, 11, 0.3)',
                color: '#fef08a',
                border: '1px solid rgba(245, 158, 11, 0.5)',
                borderRadius: '3px',
                padding: '0.02rem 0.25rem',
                fontWeight: 700,
              }}
            >
              {part}
            </mark>
          )
        }

        return <span key={i}>{part}</span>
      })}
      {hasSuffixEllipsis && <span style={{ opacity: 0.4 }}> ...</span>}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter pill tab component
// ─────────────────────────────────────────────────────────────────────────────
type FilterType = 'all' | 'document' | 'audio' | 'image' | 'video'
const FILTERS: { key: FilterType; icon: string; label: string }[] = [
  { key: 'all',      icon: '⊞',   label: 'All' },
  { key: 'document', icon: '📄', label: 'Document' },
  { key: 'audio',    icon: '🎵', label: 'Audio' },
  { key: 'image',    icon: '🖼️', label: 'Image' },
  { key: 'video',    icon: '🎬', label: 'Video' },
]

const FilterPill: React.FC<{
  filter: { key: FilterType; icon: string; label: string }
  isActive: boolean
  count: number
  onClick: () => void
}> = ({ filter, isActive, count, onClick }) => {
  const s = filter.key === 'all' ? null : MODALITY_STYLES[filter.key]
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
        padding: '0.35rem 0.8rem',
        borderRadius: '20px',
        fontSize: '0.78rem',
        fontWeight: isActive ? 700 : 500,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        border: isActive
          ? `1px solid ${s?.border ?? 'rgba(99,102,241,0.6)'}`
          : '1px solid rgba(255,255,255,0.1)',
        background: isActive
          ? (s?.bg ?? 'rgba(99,102,241,0.2)')
          : 'rgba(255,255,255,0.03)',
        color: isActive ? (s?.text ?? '#a5b4fc') : 'var(--text-secondary)',
        boxShadow: isActive
          ? `0 0 12px ${s?.glow ?? 'rgba(99,102,241,0.25)'}`
          : 'none',
        transform: isActive ? 'translateY(-1px)' : 'none',
      }}
    >
      <span>{filter.icon}</span>
      <span>{filter.label}</span>
      {count > 0 && (
        <span style={{
          background: isActive ? (s?.text ?? '#a5b4fc') : 'rgba(255,255,255,0.15)',
          color: isActive ? '#000' : 'var(--text-secondary)',
          borderRadius: '10px', padding: '0 0.4rem',
          fontSize: '0.65rem', fontWeight: 800, minWidth: '16px', textAlign: 'center',
        }}>
          {count}
        </span>
      )}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export const RetrievalTester: React.FC<RetrievalTesterProps> = ({ conversationId }) => {
  const isDemo = conversationId === 'conv_demo'
  const [query, setQuery] = useState(isDemo ? DEFAULT_DEMO_RETRIEVAL.query : '')
  const [topK, setTopK] = useState(5)
  const [alpha, setAlpha] = useState(0.5)
  const [useRouter, setUseRouter] = useState(true)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RetrievalResponse | null>(isDemo ? DEFAULT_DEMO_RETRIEVAL : null)
  const [expandedChunks, setExpandedChunks] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<FilterType>('all')

  useEffect(() => {
    if (conversationId === 'conv_demo') {
      setQuery(DEFAULT_DEMO_RETRIEVAL.query)
      setResult(DEFAULT_DEMO_RETRIEVAL)
      setError(null)
    } else {
      setQuery('')
      setResult(null)
      setError(null)
    }
  }, [conversationId])



  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    setActiveFilter('all')
    try {
      const data = await queryRetrieval(conversationId, query.trim(), topK, alpha, useRouter)
      setResult(data)
      setExpandedChunks({})
    } catch (err: any) {
      setError(err.message || 'Retrieval failed.')
    } finally {
      setLoading(false)
    }
  }

  const toggleExpand = (chunkId: string) =>
    setExpandedChunks((prev) => ({ ...prev, [chunkId]: !prev[chunkId] }))

  // Compute per-modality counts for filter pills
  const modalityCounts = React.useMemo(() => {
    if (!result) return {} as Record<string, number>
    const counts: Record<string, number> = {}
    for (const c of result.chunks) {
      counts[c.file_type] = (counts[c.file_type] || 0) + 1
    }
    return counts
  }, [result])

  // Filtered chunks based on active pill
  const filteredChunks = React.useMemo(() => {
    if (!result) return []
    if (activeFilter === 'all') return result.chunks
    return result.chunks.filter((c) => c.file_type === activeFilter)
  }, [result, activeFilter])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* ── Search Form ─────────────────────────────────────────────────── */}
      <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div
          style={{
            display: 'flex',
            gap: '0.75rem',
            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.92) 0%, rgba(30, 27, 75, 0.75) 50%, rgba(15, 23, 42, 0.92) 100%)',
            backdropFilter: 'blur(20px)',
            padding: '0.65rem 0.85rem',
            borderRadius: '18px',
            border: '1px solid rgba(99, 102, 241, 0.35)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45), 0 0 25px rgba(99, 102, 241, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.15)',
          }}
        >
          {/* Interactive Search Input Wrapper */}
          <div
            style={{
              flex: 1,
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
            {/* Radiant Search Icon Badge */}
            <div style={{ paddingLeft: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
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
                🔍
              </div>
            </div>

            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask anything across documents, audio, video & images..."
              style={{
                flex: 1,
                boxSizing: 'border-box',
                background: 'transparent',
                border: 'none',
                padding: '0.85rem 0.9rem',
                color: '#fff',
                fontSize: '0.95rem',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />

            {query.length > 0 && !loading && (
              <button
                type="button"
                onClick={() => setQuery('')}
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
                }}
                title="Clear query"
              >
                ✕
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '0.85rem 1.75rem',
              fontSize: '0.94rem',
              borderRadius: '12px',
              background: loading
                ? 'rgba(99,102,241,0.4)'
                : 'linear-gradient(135deg, #6366f1 0%, #3b82f6 50%, #06b6d4 100%)',
              color: '#fff',
              border: '1px solid rgba(255, 255, 255, 0.35)',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              boxShadow: loading ? 'none' : '0 4px 20px rgba(99, 102, 241, 0.5), 0 0 16px rgba(6, 182, 212, 0.4)',
              transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)'
                e.currentTarget.style.boxShadow = '0 6px 26px rgba(99, 102, 241, 0.75), 0 0 22px rgba(6, 182, 212, 0.6)'
              }
            }}
            onMouseLeave={(e) => {
              if (!loading) {
                e.currentTarget.style.transform = 'none'
                e.currentTarget.style.boxShadow = '0 4px 20px rgba(99, 102, 241, 0.5), 0 0 16px rgba(6, 182, 212, 0.4)'
              }
            }}
          >
            {loading ? (
              <>
                <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span> Searching…
              </>
            ) : (
              <>
                <span>Retrieve</span>
                <span>➔</span>
              </>
            )}
          </button>
        </div>

        {/* ── Parameters Bar ─────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: '1rem',
          padding: '0.8rem 1.25rem',
          background: 'rgba(255,255,255,0.02)',
          borderRadius: '12px', border: '1px solid rgba(255,255,255,0.07)',
          fontSize: '0.82rem', color: 'var(--text-secondary)',
        }}>
          {/* Alpha Slider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ opacity: 0.7 }}>Dense</span>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                type="range" min="0" max="1" step="0.05" value={alpha}
                onChange={(e) => setAlpha(parseFloat(e.target.value))}
                style={{ width: '100px', accentColor: '#6366f1', cursor: 'pointer' }}
              />
            </div>
            <span style={{ opacity: 0.7 }}>BM25</span>
            <span style={{
              background: 'rgba(99,102,241,0.2)', color: '#a5b4fc',
              border: '1px solid rgba(99,102,241,0.3)',
              borderRadius: '6px', padding: '0.1rem 0.4rem', fontSize: '0.75rem', fontWeight: 700,
            }}>α = {alpha.toFixed(2)}</span>
          </div>

          {/* Top-K */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ opacity: 0.7 }}>Top-K:</span>
            {[3, 5, 10].map((k) => (
              <button
                key={k} type="button" onClick={() => setTopK(k)}
                style={{
                  background: topK === k ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.05)',
                  color: topK === k ? '#a5b4fc' : 'var(--text-secondary)',
                  border: `1px solid ${topK === k ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: '7px', padding: '0.2rem 0.55rem',
                  fontSize: '0.75rem', cursor: 'pointer', fontWeight: topK === k ? 700 : 400,
                  transition: 'all 0.15s',
                }}
              >{k}</button>
            ))}
          </div>

          {/* Router toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
            <div
              onClick={() => setUseRouter(!useRouter)}
              style={{
                width: '34px', height: '18px',
                borderRadius: '9px',
                background: useRouter ? 'rgba(99,102,241,0.8)' : 'rgba(255,255,255,0.15)',
                position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
                flexShrink: 0,
              }}
            >
              <div style={{
                position: 'absolute', top: '2px',
                left: useRouter ? '18px' : '2px',
                width: '14px', height: '14px',
                borderRadius: '50%', background: '#fff',
                transition: 'left 0.2s ease',
                boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
              }} />
            </div>
            <span>LLM Modality Router</span>
          </label>
        </div>
      </form>

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{
          padding: '0.85rem 1.25rem',
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: '12px', color: '#fca5a5', fontSize: '0.88rem',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* ── Results ────────────────────────────────────────────────────────── */}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Router Diagnostics Card */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(99,102,241,0.06), rgba(139,92,246,0.06))',
            border: '1px solid rgba(99,102,241,0.2)',
            borderRadius: '14px', padding: '1rem 1.25rem',
            display: 'flex', flexDirection: 'column', gap: '0.65rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#c4b5fd' }}>🤖 Router</span>
                {result.router_intent_label && (
                  <span style={{
                    background: 'rgba(139,92,246,0.2)', color: '#c084fc',
                    border: '1px solid rgba(139,92,246,0.4)',
                    borderRadius: '6px', padding: '0.1rem 0.5rem', fontSize: '0.72rem', fontWeight: 600,
                  }}>
                    {result.router_intent_label}
                  </span>
                )}
                {result.routed_categories.map((cat) => {
                  const s = getTypeStyle(cat)
                  return (
                    <span key={cat} style={{
                      background: s.bg, color: s.text, border: `1px solid ${s.border}`,
                      borderRadius: '6px', padding: '0.1rem 0.45rem',
                      fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase',
                    }}>
                      {s.icon} {cat}
                    </span>
                  )
                })}
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {result.chunks.length}/{result.total_candidates} candidates
              </span>
            </div>
            {result.router_rationale && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.45', margin: 0 }}>
                <strong>Rationale: </strong>{result.router_rationale}
              </p>
            )}

            {/* Modality weights bar */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {Object.entries(result.router_weights).map(([mod, w]) => {
                const s = getTypeStyle(mod)
                const pct = Math.round(w * 100)
                return (
                  <div key={mod} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.68rem' }}>
                    <span style={{ color: s.text }}>{s.icon}</span>
                    <div style={{ width: '40px', height: '3px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: s.text, borderRadius: '2px' }} />
                    </div>
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{pct}%</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Modality Gap Badges (Ghost Chunk Prevention) ─────────────── */}
          {result.modality_gaps && result.modality_gaps.length > 0 && (
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              {result.modality_gaps.map((gap) => {
                const s = getTypeStyle(gap.modality)
                return (
                  <div key={gap.modality} style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                    background: 'rgba(255,255,255,0.03)', border: `1px dashed ${s.border}`,
                    borderRadius: '10px', padding: '0.4rem 0.8rem',
                    fontSize: '0.75rem', color: 'var(--text-muted)',
                  }}>
                    <span>📭</span>
                    <span style={{ color: s.text, fontWeight: 600 }}>{s.icon} {gap.modality}</span>
                    <span>{gap.message}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Filter Pills ─────────────────────────────────────────────── */}
          {result.chunks.length > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
              padding: '0.75rem 1rem',
              background: 'rgba(255,255,255,0.015)',
              borderRadius: '14px', border: '1px solid rgba(255,255,255,0.07)',
            }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, marginRight: '0.25rem' }}>FILTER</span>
              {FILTERS.map((f) => {
                const count = f.key === 'all' ? result.chunks.length : (modalityCounts[f.key] || 0)
                // Only show pills for modalities that actually exist in results (or "All")
                if (f.key !== 'all' && count === 0) return null
                return (
                  <FilterPill
                    key={f.key}
                    filter={f}
                    isActive={activeFilter === f.key}
                    count={count}
                    onClick={() => setActiveFilter(f.key)}
                  />
                )
              })}
            </div>
          )}

          {/* ── Chunk List ───────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {filteredChunks.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '3rem', color: 'var(--text-muted)',
                background: 'rgba(255,255,255,0.02)', borderRadius: '14px',
                border: '1px dashed rgba(255,255,255,0.08)',
              }}>
                {activeFilter === 'all'
                  ? '📭 No matching chunks found. Make sure your files are uploaded and indexed.'
                  : `📭 No ${activeFilter} chunks in these results.`}
              </div>
            ) : (
              filteredChunks.map((chunk, idx) => {
                const s = getTypeStyle(chunk.file_type)
                const isExpanded = Boolean(expandedChunks[chunk.chunk_id])

                // Effective score for display — prefer normalized pct
                const displayPct = chunk.final_score_pct ?? chunk.final_score * 100
                const densePct   = chunk.dense_score_pct ?? (chunk.dense_score ?? 0) * 100
                const bm25Pct    = chunk.bm25_score_pct  ?? (chunk.bm25_score ?? 0) * 100
                const coordPct   = chunk.coordination_ratio != null ? chunk.coordination_ratio * 100 : null

                return (
                  <div
                    key={chunk.chunk_id}
                    style={{
                      background: 'rgba(15, 23, 42, 0.72)',
                      backdropFilter: 'blur(16px)',
                      border: `1px solid ${isExpanded ? s.border : 'rgba(255,255,255,0.08)'}`,
                      borderRadius: '14px',
                      padding: '1.15rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.85rem',
                      transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
                      boxShadow: isExpanded
                        ? `0 0 24px ${s.glow}, 0 8px 30px rgba(0,0,0,0.5)`
                        : '0 4px 16px rgba(0,0,0,0.25)',
                    }}
                  >
                    {/* ── Chunk Header ── */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
                        {/* Rank badge */}
                        <span style={{
                          fontSize: '0.68rem', fontWeight: 800, color: '#93c5fd',
                          background: 'rgba(59,130,246,0.15)', padding: '0.1rem 0.4rem',
                          borderRadius: '4px', fontFamily: 'var(--font-mono)',
                        }}>
                          #{idx + 1}
                        </span>

                        {/* Type badge */}
                        <span style={{
                          background: s.bg, color: s.text, border: `1px solid ${s.border}`,
                          borderRadius: '6px', padding: '0.12rem 0.4rem',
                          fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
                        }}>
                          {s.icon} {chunk.file_type}
                        </span>

                        {/* Confidence tier */}
                        <TierBadge tier={chunk.confidence_tier} />

                        {/* Filename */}
                        <span style={{
                          fontSize: '0.85rem', fontWeight: 600,
                          color: 'var(--text-primary)', overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px',
                        }} title={chunk.filename}>
                          {chunk.filename}
                        </span>

                        {/* Thumbnail for image/video */}
                        {(chunk.file_type === 'image' || chunk.file_type === 'video') && (
                          <img
                            src={`http://localhost:8000/api/files/${chunk.file_id}/thumbnail`}
                            alt="thumbnail"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                            style={{
                              width: '32px', height: '32px', objectFit: 'cover',
                              borderRadius: '5px', border: `1px solid ${s.border}`,
                            }}
                          />
                        )}


                        {/* Page badge */}
                        {chunk.page_number && (
                          <span style={{
                            background: 'rgba(59,130,246,0.12)', color: '#60a5fa',
                            border: '1px solid rgba(59,130,246,0.3)',
                            borderRadius: '6px', padding: '0.1rem 0.4rem',
                            fontSize: '0.68rem', fontWeight: 600,
                          }}>
                            📄 p.{chunk.page_number}
                          </span>
                        )}
                      </div>

                      {/* Score + Expand */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                        <div style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.15rem',
                          background: 'rgba(0,0,0,0.25)', borderRadius: '8px', padding: '0.3rem 0.6rem',
                        }}>
                          <span style={{
                            fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '0.88rem',
                            color: displayPct >= 70 ? '#34d399' : displayPct >= 40 ? '#fbbf24' : '#f87171',
                          }}>
                            {displayPct.toFixed(1)}%
                          </span>
                          <div style={{
                            width: '60px', height: '3px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px',
                          }}>
                            <div style={{
                              width: `${Math.min(100, displayPct)}%`, height: '100%', borderRadius: '2px',
                              background: displayPct >= 70 ? '#34d399' : displayPct >= 40 ? '#fbbf24' : '#f87171',
                              transition: 'width 0.7s ease',
                            }} />
                          </div>
                        </div>
                        <button
                          onClick={() => toggleExpand(chunk.chunk_id)}
                          style={{
                            background: isExpanded
                              ? 'linear-gradient(135deg, rgba(244, 63, 94, 0.35) 0%, rgba(236, 72, 153, 0.45) 100%)'
                              : 'linear-gradient(135deg, rgba(244, 63, 94, 0.18) 0%, rgba(236, 72, 153, 0.25) 100%)',
                            color: '#ffffff',
                            border: isExpanded
                              ? '1px solid rgba(244, 63, 94, 0.9)'
                              : '1px solid rgba(244, 63, 94, 0.55)',
                            borderRadius: '20px',
                            padding: '0.28rem 0.75rem',
                            fontSize: '0.74rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            animation: 'neonPinkPulse 2.2s infinite ease-in-out',
                            transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                            letterSpacing: '0.02em',
                            boxShadow: isExpanded
                              ? '0 0 16px rgba(244, 63, 94, 0.75), 0 0 30px rgba(236, 72, 153, 0.45)'
                              : '0 0 8px rgba(244, 63, 94, 0.3)',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)'
                            e.currentTarget.style.boxShadow = '0 0 24px rgba(244, 63, 94, 0.95), 0 0 40px rgba(236, 72, 153, 0.6)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'none'
                            e.currentTarget.style.boxShadow = isExpanded
                              ? '0 0 16px rgba(244, 63, 94, 0.75), 0 0 30px rgba(236, 72, 153, 0.45)'
                              : '0 0 8px rgba(244, 63, 94, 0.3)'
                          }}
                        >
                          {/* Pulsing Neon Dot */}
                          <span
                            style={{
                              display: 'inline-block',
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              background: '#ff2d55',
                              animation: 'pinkDotPulse 1.5s infinite ease-in-out',
                            }}
                          />
                          <span style={{ color: '#fff', textShadow: '0 0 8px rgba(244, 63, 94, 0.6)' }}>
                            {isExpanded ? 'Collapse' : 'Expand'}
                          </span>
                          <span
                            style={{
                              fontSize: '0.65rem',
                              color: '#fda4af',
                              transform: isExpanded ? 'rotate(180deg)' : 'none',
                              transition: 'transform 0.25s ease',
                            }}
                          >
                            ▼
                          </span>
                        </button>
                      </div>
                    </div>


                    {/* ── Sub-score Bars ── */}
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.4rem',
                      background: 'rgba(0,0,0,0.22)',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '10px',
                      border: '1px solid rgba(255,255,255,0.04)',
                    }}>
                      <ScoreBar pct={densePct}   tier={chunk.confidence_tier} label="Semantic Match"       color="#38bdf8" />
                      <ScoreBar pct={bm25Pct}    tier={chunk.confidence_tier} label="Exact Keyword Match"  color="#fb923c" />
                      {coordPct !== null && (
                        <ScoreBar pct={coordPct} tier={chunk.confidence_tier} label="Hybrid Fusion Score"  color="#a78bfa" />
                      )}
                    </div>

                    {/* ── Text Preview ── */}
                    <div style={{
                      fontSize: '0.86rem', color: '#e2e8f0', lineHeight: '1.65',
                      background: 'rgba(0,0,0,0.3)', padding: isExpanded ? '1rem 1.2rem' : '0.7rem 1rem',
                      borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)',
                      fontFamily: 'var(--font-mono)',
                      whiteSpace: isExpanded ? 'pre-wrap' : 'normal',
                      wordBreak: 'break-word', transition: 'padding 0.2s',
                    }}>
                      {renderHighlightedSnippet(chunk.text, query, isExpanded)}
                    </div>

                    {/* ── Chunk metadata footer (expanded only) ── */}
                    {isExpanded && (
                      <div style={{
                        display: 'flex', gap: '0.75rem', flexWrap: 'wrap',
                        paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.05)',
                        fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                      }}>
                        <span>chunk #{chunk.chunk_index}</span>
                        <span>•</span>
                        <span>file_id: {chunk.file_id.slice(0, 8)}…</span>
                        {chunk.coordination_ratio != null && (
                          <><span>•</span><span>coord: {(chunk.coordination_ratio * 100).toFixed(1)}%</span></>
                        )}
                        {chunk.modality_boost != null && (
                          <><span>•</span><span>modality_boost: {chunk.modality_boost > 0 ? '+' : ''}{chunk.modality_boost.toFixed(4)}</span></>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* ── Empty Initial State for Personal Workspaces ───────────────── */}
      {!result && !loading && !error && (
        <div style={{
          textAlign: 'center',
          padding: '3.5rem 1.5rem',
          background: 'rgba(255, 255, 255, 0.015)',
          borderRadius: '16px',
          border: '1px dashed rgba(255, 255, 255, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.75rem',
        }}>
          <div style={{ fontSize: '2.2rem', opacity: 0.7 }}>🔍</div>
          <h4 style={{ color: 'var(--text-primary)', fontSize: '1rem', fontWeight: 600, margin: 0 }}>
            Inspect Hybrid Retrieval & Modality Routing
          </h4>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.84rem', maxWidth: '460px', margin: 0, lineHeight: 1.5 }}>
            Type a query in the search bar above to test dense vector embeddings, BM25 exact lexical matching, and automatic LLM modality routing weights for this session.
          </p>
        </div>
      )}

      {/* Keyframe animation */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
