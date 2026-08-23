import React from 'react'

/**
 * Sanitizes PDF / slide extracted text by removing broken font glyphs, missing Unicode boxes,
 * and normalizing bullet points and spacing without mangling markdown code blocks.
 */
export const cleanExtractedText = (raw: string | null | undefined): string => {
  if (!raw) return ''
  let s = raw

  // 1. Replace missing glyph boxes / private use unicode symbols / bullet artifacts
  s = s.replace(/[\uE000-\uF8FF\uFFF0-\uFFFF\uD800-\uDBFF\uDC00-\uDFFF\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
  s = s.replace(/[􀀀🗎\uF0A7\uF0B7\uF0D8\uF0E0-\uF0FF\uFFFD]/g, ' ')

  // 2. Standardize non-markdown exotic bullet glyphs at line start
  s = s.replace(/^[ \t]*[□■◆◇○●▪▫][ \t]*/gm, '- ')

  return s
}

/**
 * Universal text formatter for claims, evidence quotes, graph tooltips, and citations.
 * Handles:
 * - Bold (**text**, __text__)
 * - Italics (*text*, _text_)
 * - Inline Code (`code`)
 * - Leading bullet & numbered list artifacts (* , - , • , 1. , > )
 * - Timestamps ([00:21 - 00:25], [00:15]) and Page tags ([Page 4])
 * - Currencies ($50,000 USD, $150, $0.32) without LaTeX corruption
 * - LaTeX math notation ($math$, $$math$$, \text{...}, \times, \pm, etc.)
 * - Multiline snippet formatting
 */
export const renderFormattedSnippet = (raw: string | null | undefined): React.ReactNode => {
  if (!raw) return null
  const cleaned = cleanExtractedText(raw)
  const lines = cleaned.split(/\r?\n/)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      {lines.map((line, lineIdx) => {
        let trimmed = line.trim()
        if (!trimmed) return null

        // Check and clean leading bullets / list tokens
        const hasBullet = /^(?:[-*•]|\d+\.)\s+/.test(trimmed)
        const hasBlockquote = /^>\s+/.test(trimmed)
        trimmed = trimmed.replace(/^(?:[-*•]|\d+\.|>)\s+/, '').trim()

        // Strip surrounding redundant quotes
        trimmed = trimmed.replace(/^["'“”]+|["'“”]+$/g, '').trim()

        // Clean LaTeX helpers
        trimmed = trimmed.replace(/\\text\{([^}]+)\}/g, '$1').replace(/\\\$/g, '$')

        // Tokenize line around:
        // 1. Timestamps & Page markers: [00:21 - 00:25], [Page 4], [00:15]
        // 2. LaTeX Display Math: $$...$$
        // 3. LaTeX Math or Currency: $...$
        // 4. Bold: **...** or __...__
        // 5. Code: `...`
        // 6. Italic: *...* or _..._
        const tokens = trimmed.split(
          /(\[\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?\]|\[Page\s*\d+\]|\$\$[^\$]+\$\$|\$[^\$\n]+\$|\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_)/g
        )

        const renderedLine = (
          <span key={`line-${lineIdx}`} style={{ display: 'inline', wordBreak: 'break-word' }}>
            {tokens.map((token, tokIdx) => {
              if (!token) return null

              // 1. Timestamp Badge
              const isTime = /^\[\d{1,2}:\d{2}/.test(token)
              if (isTime) {
                return (
                  <span
                    key={`tok-${tokIdx}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      background: 'rgba(168, 85, 247, 0.2)',
                      color: '#c084fc',
                      border: '1px solid rgba(168, 85, 247, 0.4)',
                      borderRadius: '4px',
                      padding: '0.05rem 0.35rem',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      margin: '0 0.2rem',
                      verticalAlign: 'baseline',
                      fontFamily: 'var(--font-mono, monospace)',
                    }}
                  >
                    ⏱️ {token.replace(/[\[\]]/g, '')}
                  </span>
                )
              }

              // 2. Page Badge
              const isPage = /^\[Page\s*\d+\]/i.test(token)
              if (isPage) {
                return (
                  <span
                    key={`tok-${tokIdx}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      background: 'rgba(59, 130, 246, 0.2)',
                      color: '#60a5fa',
                      border: '1px solid rgba(59, 130, 246, 0.4)',
                      borderRadius: '4px',
                      padding: '0.05rem 0.35rem',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      margin: '0 0.2rem',
                      verticalAlign: 'baseline',
                    }}
                  >
                    📄 {token.replace(/[\[\]]/g, '')}
                  </span>
                )
              }

              // 3. Bold **text** or __text__
              const boldMatch = token.match(/^\*\*([^*]+)\*\*$/) || token.match(/^__([^_]+)__$/)
              if (boldMatch) {
                return (
                  <strong key={`tok-${tokIdx}`} style={{ color: '#fff', fontWeight: 700 }}>
                    {boldMatch[1]}
                  </strong>
                )
              }

              // 4. Inline Code `code`
              const codeMatch = token.match(/^`([^`]+)`$/)
              if (codeMatch) {
                return (
                  <code
                    key={`tok-${tokIdx}`}
                    style={{
                      background: 'rgba(255, 255, 255, 0.08)',
                      color: '#38bdf8',
                      padding: '0.1rem 0.35rem',
                      borderRadius: '4px',
                      fontSize: '0.88em',
                      fontFamily: 'var(--font-mono, monospace)',
                    }}
                  >
                    {codeMatch[1]}
                  </code>
                )
              }

              // 5. Italic *text* or _text_
              const italicMatch = token.match(/^\*([^*]+)\*$/) || token.match(/^_([^_]+)_$/)
              if (italicMatch) {
                return (
                  <em key={`tok-${tokIdx}`} style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>
                    {italicMatch[1]}
                  </em>
                )
              }

              // 6. Math or Currency $...$ or $$...$$
              const mathMatch = token.match(/^\${1,2}([^\$\n]+)\${1,2}$/)
              if (mathMatch) {
                const inner = mathMatch[1].trim()
                return (
                  <span key={`tok-${tokIdx}`} style={{ fontWeight: 600, color: '#f1f5f9' }}>
                    ${inner}
                  </span>
                )
              }

              return <span key={`tok-${tokIdx}`}>{token}</span>
            })}
          </span>
        )

        if (hasBullet) {
          return (
            <div key={`line-${lineIdx}`} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', paddingLeft: '0.2rem' }}>
              <span style={{ color: 'var(--accent-blue, #38bdf8)', fontWeight: 700, lineHeight: '1.4' }}>•</span>
              <div style={{ flex: 1 }}>{renderedLine}</div>
            </div>
          )
        }

        if (hasBlockquote) {
          return (
            <div
              key={`line-${lineIdx}`}
              style={{
                borderLeft: '3px solid rgba(56, 189, 248, 0.5)',
                paddingLeft: '0.6rem',
                margin: '0.2rem 0',
                color: 'var(--text-secondary)',
                fontStyle: 'italic',
              }}
            >
              {renderedLine}
            </div>
          )
        }

        return <div key={`line-${lineIdx}`}>{renderedLine}</div>
      })}
    </div>
  )
}

/**
 * Extracts the accurate spoken timestamp range from evidence text.
 * E.g. "[00:21 - 00:25] ... [00:27 - 00:30]" -> "00:21 - 00:30"
 * E.g. "[00:30 - 00:33] ... [00:38 - 00:41]" -> "00:30 - 00:41"
 */
export const extractTimestampRange = (text: string | null | undefined): string | null => {
  if (!text) return null
  const matches = text.match(/\[(\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?)\]/g)
  if (!matches || matches.length === 0) return null
  const cleaned = matches.map((m) => m.replace(/[\[\]]/g, '').trim())
  if (cleaned.length === 1) return cleaned[0]
  const firstStart = cleaned[0].split('-')[0].trim()
  const lastEnd = cleaned[cleaned.length - 1].split('-').pop()?.trim() || firstStart
  return `${firstStart} - ${lastEnd}`
}

/**
 * Returns the most accurate timestamp for a citation or chunk, preferring the real
 * spoken sentence range from evidence over any generic/stale chunk start timestamp.
 */
export const getEffectiveTimestamp = (
  evidenceQuote: string | null | undefined,
  fallbackTimestamp: string | null | undefined
): string | null => {
  const fromEvidence = extractTimestampRange(evidenceQuote)
  if (fromEvidence) return fromEvidence
  if (fallbackTimestamp && fallbackTimestamp !== '00:00 - 00:01' && fallbackTimestamp !== '00:00') {
    return fallbackTimestamp
  }
  return fromEvidence || fallbackTimestamp || null
}
