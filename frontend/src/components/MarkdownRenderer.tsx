import React, { useState } from 'react'
import { SynthesisResult, CitationVerification } from '../api/queryApi'
import { cleanExtractedText } from '../utils/textFormatter'

interface MarkdownRendererProps {
  content: string
  synthesis?: SynthesisResult
  onCitationClick: (citation: CitationVerification | { passage_number: number; claim_text: string; evidence_quote: string; is_grounded: boolean; status: 'VERIFIED'; filename?: string; file_id?: string; page_number?: number; timestamp?: string | null }) => void
}

// Clean LaTeX markup & escaped characters into clean readable math
const cleanMathNotation = (raw: string): string => {
  let s = raw.trim()
  s = s.replace(/^\$\$+|\$\$+$/g, '').replace(/^\$+|\$+$/g, '').trim()
  s = s.replace(/\\text\{([^}]+)\}/g, '$1')
  s = s.replace(/\\\$/g, '$')
  s = s.replace(/\\times/g, '×')
  s = s.replace(/\\div/g, '÷')
  s = s.replace(/\\pm/g, '±')
  s = s.replace(/\\approx/g, '≈')
  s = s.replace(/\\ge/g, '≥')
  s = s.replace(/\\le/g, '≤')
  s = s.replace(/\\cdot/g, '·')
  s = s.replace(/\\neq/g, '≠')
  s = s.replace(/\\rightarrow/g, '→')
  s = s.replace(/\\leftarrow/g, '←')
  s = s.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1 / $2)')
  s = s.replace(/\\left|\\right/g, '')
  s = s.replace(/[{}]/g, '')
  return s.trim()
}

/**
 * Interactive Code Block Component with Syntax Header & Copy Button
 */
const CodeBlock: React.FC<{ code: string; language?: string }> = ({ code, language }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const langDisplay = (language || 'code').toUpperCase()

  return (
    <div
      style={{
        background: '#070b14',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '10px',
        overflow: 'hidden',
        margin: '0.85rem 0',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.45)',
      }}
    >
      {/* Code Header Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.45rem 0.85rem',
          background: 'rgba(255, 255, 255, 0.03)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          fontSize: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: '#38bdf8', fontWeight: 700, letterSpacing: '0.05em' }}>
            {langDisplay}
          </span>
        </div>
        <button
          onClick={handleCopy}
          style={{
            background: copied ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.06)',
            color: copied ? '#4ade80' : '#cbd5e1',
            border: `1px solid ${copied ? 'rgba(34, 197, 94, 0.4)' : 'rgba(255, 255, 255, 0.1)'}`,
            borderRadius: '5px',
            padding: '0.2rem 0.55rem',
            cursor: 'pointer',
            fontSize: '0.72rem',
            fontWeight: 600,
            transition: 'all 0.15s ease',
          }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>

      {/* Code Content */}
      <pre
        style={{
          margin: 0,
          padding: '0.85rem 1rem',
          overflowX: 'auto',
          fontFamily: 'Consolas, "Fira Code", Monaco, monospace',
          fontSize: '0.86rem',
          lineHeight: '1.55',
          color: '#e2e8f0',
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  )
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  synthesis,
  onCitationClick,
}) => {
  let globalCitationIndex = 0

  // Helper to find the exact matching verification for a citation marker [n]
  const getMatchingVerification = (
    pNum: number,
    immediateClaimText: string,
    citOccurIndex: number
  ): CitationVerification | undefined => {
    if (!synthesis?.citations || synthesis.citations.length === 0) return undefined

    const matchingPassage = synthesis.citations.filter((c) => c.passage_number === pNum)
    if (matchingPassage.length === 0) return undefined
    if (matchingPassage.length === 1) return matchingPassage[0]

    // Semantic word overlap matching for multi-citation passages
    const precedingTokens = immediateClaimText
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)

    let bestMatch = matchingPassage[0]
    let maxOverlap = -1

    for (const cand of matchingPassage) {
      const candTokens = (cand.claim_text || '')
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2)

      let overlap = 0
      for (const tok of candTokens) {
        if (precedingTokens.includes(tok)) overlap++
      }
      if (overlap > maxOverlap) {
        maxOverlap = overlap
        bestMatch = cand
      }
    }

    if (maxOverlap <= 0 && synthesis.citations[citOccurIndex]?.passage_number === pNum) {
      return synthesis.citations[citOccurIndex]
    }

    return bestMatch
  }

  // Helper to render inline text with bold, italic, code, and clickable [n] citations
  const renderInline = (rawText: string): React.ReactNode[] => {
    const text = rawText
      .replace(/\\text\{([^}]+)\}/g, '$1')
      .replace(/\\\$/g, '$')

    // Tokenize around citation markers [n], page markers [Page n], math $...$, bold **text**, code `text`, and italic *text*
    const tokens = text.split(/(\[\d+\]|\[Page\s*\d+\]|\$\$[^\$]+\$\$|\$[^\$\n]+\$|\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_)/gi)

    return tokens.map((token, idx) => {
      if (!token) return null

      // Page Marker [Page n]
      const pageMatch = token.match(/^\[Page\s*(\d+)\]$/i)
      if (pageMatch) {
        return (
          <span
            key={`page-${idx}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: 'rgba(59, 130, 246, 0.2)',
              color: '#60a5fa',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              borderRadius: '4px',
              padding: '0.1rem 0.45rem',
              fontSize: '0.78rem',
              fontWeight: 700,
              margin: '0.2rem 0.25rem',
              verticalAlign: 'baseline',
            }}
          >
            📄 Page {pageMatch[1]}
          </span>
        )
      }

      // 1. Citation Marker [n]
      const citMatch = token.match(/^\[(\d+)\]$/)
      if (citMatch) {
        const pNum = parseInt(citMatch[1], 10)
        const citIdx = globalCitationIndex++

        let immediateClaimText = ''
        for (let j = idx - 1; j >= 0; j--) {
          const tok = tokens[j]
          if (/^\[\d+\]$/.test(tok)) break
          immediateClaimText = tok + immediateClaimText
          if (/[.?!]\s*$/.test(tok) || immediateClaimText.length > 150) break
        }

        const matchedVerification = getMatchingVerification(pNum, immediateClaimText, citIdx)
        const isVerified = matchedVerification?.is_grounded !== false

        return (
          <button
            key={`cit-${idx}`}
            onClick={() =>
              onCitationClick(
                matchedVerification || {
                  passage_number: pNum,
                  claim_text: immediateClaimText.trim() || `Information cited from passage ${pNum}`,
                  evidence_quote: 'Source citation reference from uploaded context.',
                  is_grounded: true,
                  status: 'VERIFIED',
                }
              )
            }
            title={
              matchedVerification
                ? `Source: ${matchedVerification.filename || 'Context'} (${matchedVerification.is_grounded ? 'Verified Grounded' : 'Unverified'})`
                : `Citation [${pNum}]`
            }
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: isVerified ? 'rgba(59, 130, 246, 0.2)' : 'rgba(239, 68, 68, 0.2)',
              color: isVerified ? '#60a5fa' : '#f87171',
              border: `1px solid ${isVerified ? 'rgba(59, 130, 246, 0.45)' : 'rgba(239, 68, 68, 0.45)'}`,
              borderRadius: '6px',
              padding: '0.1rem 0.45rem',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
              margin: '0 0.25rem',
              lineHeight: '1.2',
              verticalAlign: 'baseline',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = isVerified ? 'rgba(59, 130, 246, 0.35)' : 'rgba(239, 68, 68, 0.35)'
              e.currentTarget.style.transform = 'translateY(-1px)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = isVerified ? 'rgba(59, 130, 246, 0.2)' : 'rgba(239, 68, 68, 0.2)'
              e.currentTarget.style.transform = 'none'
            }}
          >
            [{pNum}]
          </button>
        )
      }

      // 2. Math or Number formatting $...$ or $$...$$
      const mathMatch = token.match(/^\${1,2}([^\$\n]+)\${1,2}$/)
      if (mathMatch) {
        const rawInner = mathMatch[1].trim()
        if (/^[\$€£₹]?\s*[\d.,%/\-+:_]+(?:\s*[a-zA-Z]+)?$/.test(rawInner)) {
          return <span key={`num-${idx}`} style={{ fontWeight: 600, color: '#f1f5f9' }}>{rawInner}</span>
        }
        const clean = cleanMathNotation(rawInner)
        return (
          <span
            key={`math-${idx}`}
            style={{
              fontFamily: 'Consolas, Monaco, monospace',
              color: '#38bdf8',
              background: 'rgba(56, 189, 248, 0.08)',
              padding: '0.1rem 0.35rem',
              borderRadius: '4px',
              fontSize: '0.9em',
            }}
          >
            {clean}
          </span>
        )
      }

      // 3. Bold **text** or __text__
      const boldMatch = token.match(/^(?:\*\*|__)(.+?)(?:\*\*|__)$/)
      if (boldMatch) {
        return (
          <strong key={`bold-${idx}`} style={{ fontWeight: 700, color: '#fff' }}>
            {boldMatch[1]}
          </strong>
        )
      }

      // 4. Inline code `text`
      const codeMatch = token.match(/^`([^`]+)`$/)
      if (codeMatch) {
        return (
          <code
            key={`code-${idx}`}
            style={{
              background: 'rgba(56, 189, 248, 0.12)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              color: '#38bdf8',
              padding: '0.12rem 0.4rem',
              borderRadius: '4px',
              fontFamily: 'Consolas, "Fira Code", Monaco, monospace',
              fontSize: '0.88em',
            }}
          >
            {codeMatch[1]}
          </code>
        )
      }

      // 5. Italic *text* or _text_
      const italicMatch = token.match(/^(?:\*|_)(.+?)(?:\*|_)$/)
      if (italicMatch) {
        return (
          <em key={`em-${idx}`} style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>
            {italicMatch[1]}
          </em>
        )
      }

      // Fallback clean any stray unclosed markdown stars
      let cleanToken = token
      if (cleanToken.startsWith('**') && cleanToken.endsWith('**') && cleanToken.length > 4) {
        return (
          <strong key={`bold-fallback-${idx}`} style={{ fontWeight: 700, color: '#fff' }}>
            {cleanToken.slice(2, -2)}
          </strong>
        )
      }
      cleanToken = cleanToken.replace(/\*\*/g, '').replace(/(?:^\*|\*$)/g, '')

      // Plain text fallback
      return <span key={`txt-${idx}`}>{cleanToken}</span>
    })
  }

  // Parse lines into clean markdown blocks
  const sanitized = cleanExtractedText(content)
  const lines = sanitized.split(/\r?\n/)
  const blocks: React.ReactNode[] = []

  let listBuffer: string[] = []
  let inCodeBlock = false
  let codeLang = ''
  let codeBuffer: string[] = []
  let tableBuffer: string[] = []
  let blockquoteBuffer: string[] = []

  const flushList = () => {
    if (listBuffer.length > 0) {
      blocks.push(
        <ul
          key={`ul-${blocks.length}`}
          style={{
            margin: '0.5rem 0 0.75rem 1.25rem',
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          {listBuffer.map((item, i) => (
            <li key={`li-${i}`} style={{ color: 'var(--text-primary)', lineHeight: '1.6' }}>
              {renderInline(item)}
            </li>
          ))}
        </ul>
      )
      listBuffer = []
    }
  }

  const flushTable = () => {
    if (tableBuffer.length >= 2) {
      const rows = tableBuffer.map((row) =>
        row
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim())
      )

      const headerRow = rows[0]
      const isDivider = (r: string[]) => r.every((c) => /^[-:\s]+$/.test(c))
      const dataRows = rows.slice(1).filter((r) => !isDivider(r))

      blocks.push(
        <div
          key={`table-${blocks.length}`}
          style={{
            overflowX: 'auto',
            margin: '0.85rem 0',
            borderRadius: '10px',
            border: '1px solid var(--border-color)',
            background: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ background: 'rgba(56, 189, 248, 0.08)', borderBottom: '1px solid var(--border-color)' }}>
                {headerRow.map((h, hi) => (
                  <th
                    key={`th-${hi}`}
                    style={{
                      padding: '0.65rem 0.9rem',
                      textAlign: 'left',
                      fontWeight: 700,
                      color: '#38bdf8',
                    }}
                  >
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((row, ri) => (
                <tr
                  key={`tr-${ri}`}
                  style={{
                    borderBottom: ri < dataRows.length - 1 ? '1px solid rgba(255, 255, 255, 0.05)' : 'none',
                    background: ri % 2 === 1 ? 'rgba(255, 255, 255, 0.015)' : 'transparent',
                  }}
                >
                  {row.map((cell, ci) => (
                    <td key={`td-${ci}`} style={{ padding: '0.6rem 0.9rem', color: 'var(--text-primary)' }}>
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    tableBuffer = []
  }

  const flushBlockquote = () => {
    if (blockquoteBuffer.length > 0) {
      blocks.push(
        <blockquote
          key={`quote-${blocks.length}`}
          style={{
            margin: '0.75rem 0',
            padding: '0.75rem 1.1rem',
            background: 'rgba(59, 130, 246, 0.06)',
            borderLeft: '4px solid #3b82f6',
            borderRadius: '0 8px 8px 0',
            color: '#cbd5e1',
            lineHeight: '1.6',
            fontSize: '0.92rem',
          }}
        >
          {blockquoteBuffer.map((line, i) => (
            <p key={`qp-${i}`} style={{ margin: i > 0 ? '0.35rem 0 0' : 0 }}>
              {renderInline(line)}
            </p>
          ))}
        </blockquote>
      )
      blockquoteBuffer = []
    }
  }

  const flushAll = () => {
    flushList()
    flushTable()
    flushBlockquote()
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    const line = rawLine.trim()

    // 1. Code block fences (``` or ```sql etc.)
    const codeFenceMatch = line.match(/^```(\w+)?/)
    if (codeFenceMatch) {
      if (inCodeBlock) {
        // Closing code block
        blocks.push(
          <CodeBlock
            key={`codeblock-${blocks.length}`}
            code={codeBuffer.join('\n')}
            language={codeLang}
          />
        )
        codeBuffer = []
        codeLang = ''
        inCodeBlock = false
      } else {
        // Opening code block
        flushAll()
        codeLang = codeFenceMatch[1] || ''
        inCodeBlock = true
      }
      continue
    }

    if (inCodeBlock) {
      codeBuffer.push(rawLine)
      continue
    }

    // 2. Table rows (| col 1 | col 2 |)
    if (line.startsWith('|') && line.endsWith('|')) {
      flushList()
      flushBlockquote()
      tableBuffer.push(line)
      continue
    } else if (tableBuffer.length > 0) {
      flushTable()
    }

    // 3. Blockquotes (> quote)
    if (line.startsWith('> ') || line === '>') {
      flushList()
      blockquoteBuffer.push(line.replace(/^>\s?/, ''))
      continue
    } else if (blockquoteBuffer.length > 0) {
      flushBlockquote()
    }

    // 4. Empty lines
    if (!line) {
      flushAll()
      continue
    }

    // 5. Math Formula Blocks: $$...$$
    if (line.startsWith('$$') || line.endsWith('$$') || (line.includes('\\text{') && (line.includes('=') || line.includes('-') || line.includes('+')))) {
      flushAll()
      const cleanedFormula = cleanMathNotation(line)
      blocks.push(
        <div
          key={`math-${blocks.length}`}
          style={{
            margin: '0.85rem 0',
            padding: '0.85rem 1.25rem',
            background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.08) 0%, rgba(99, 102, 241, 0.08) 100%)',
            border: '1px solid rgba(56, 189, 248, 0.35)',
            borderRadius: '10px',
            fontFamily: 'Consolas, "Fira Code", Monaco, monospace',
            fontSize: '0.95rem',
            color: '#7dd3fc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
            letterSpacing: '0.01em',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
          }}
        >
          <span style={{ marginRight: '0.6rem', opacity: 0.85 }}>📐</span>
          <span>{renderInline(cleanedFormula)}</span>
        </div>
      )
      continue
    }

    // 6. Horizontal rules (---, ***, ___)
    if (line === '---' || line === '***' || line === '___') {
      flushAll()
      blocks.push(
        <hr
          key={`hr-${blocks.length}`}
          style={{
            border: 'none',
            borderTop: '1px solid var(--border-color)',
            margin: '1.25rem 0',
            opacity: 0.6,
          }}
        />
      )
      continue
    }

    // 7. Headings #, ##, ###, ####
    if (line.startsWith('#### ')) {
      flushAll()
      blocks.push(
        <h4
          key={`h4-${blocks.length}`}
          style={{
            fontSize: '0.95rem',
            fontWeight: 700,
            color: '#38bdf8',
            margin: '1.1rem 0 0.35rem',
          }}
        >
          {renderInline(line.slice(5))}
        </h4>
      )
      continue
    }

    if (line.startsWith('### ')) {
      flushAll()
      blocks.push(
        <h3
          key={`h3-${blocks.length}`}
          style={{
            fontSize: '1.08rem',
            fontWeight: 700,
            color: '#60a5fa',
            margin: '1.25rem 0 0.4rem',
            letterSpacing: '-0.01em',
          }}
        >
          {renderInline(line.slice(4))}
        </h3>
      )
      continue
    }

    if (line.startsWith('## ')) {
      flushAll()
      blocks.push(
        <h2
          key={`h2-${blocks.length}`}
          style={{
            fontSize: '1.22rem',
            fontWeight: 700,
            color: '#93c5fd',
            margin: '1.4rem 0 0.5rem',
            letterSpacing: '-0.02em',
          }}
        >
          {renderInline(line.slice(3))}
        </h2>
      )
      continue
    }

    if (line.startsWith('# ')) {
      flushAll()
      blocks.push(
        <h1
          key={`h1-${blocks.length}`}
          style={{
            fontSize: '1.38rem',
            fontWeight: 800,
            color: '#fff',
            margin: '1.5rem 0 0.6rem',
            letterSpacing: '-0.02em',
          }}
        >
          {renderInline(line.slice(2))}
        </h1>
      )
      continue
    }

    // 8. Bullet list items (* or - or •)
    const bulletMatch = line.match(/^[\*\-•]\s+(.+)$/)
    if (bulletMatch) {
      listBuffer.push(bulletMatch[1])
      continue
    }

    // 9. Numbered list items (1. 2. etc)
    const numMatch = line.match(/^(\d+)\.\s+(.+)$/)
    if (numMatch) {
      flushAll()
      blocks.push(
        <div
          key={`num-${blocks.length}`}
          style={{
            display: 'flex',
            gap: '0.6rem',
            margin: '0.45rem 0',
            lineHeight: '1.6',
            color: 'var(--text-primary)',
          }}
        >
          <span style={{ fontWeight: 700, color: '#60a5fa', minWidth: '1.3rem' }}>
            {numMatch[1]}.
          </span>
          <div>{renderInline(numMatch[2])}</div>
        </div>
      )
      continue
    }

    // 10. Regular Paragraph
    flushAll()
    blocks.push(
      <p
        key={`p-${blocks.length}`}
        style={{
          margin: '0.45rem 0',
          lineHeight: '1.68',
          color: 'var(--text-primary)',
          fontSize: '0.92rem',
        }}
      >
        {renderInline(line)}
      </p>
    )
  }

  // Final flush for remaining buffers
  if (inCodeBlock && codeBuffer.length > 0) {
    blocks.push(
      <CodeBlock
        key={`codeblock-${blocks.length}`}
        code={codeBuffer.join('\n')}
        language={codeLang}
      />
    )
  }
  flushAll()

  return <div style={{ display: 'flex', flexDirection: 'column' }}>{blocks}</div>
}
