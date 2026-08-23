import React, { useState, useEffect, useRef } from 'react'
import { renderAsync } from 'docx-preview'
import { FileItem, getFileSignedUrl, getExtractedText, reExtractFile, ExtractedContentResponse } from '../api/filesApi'
import { API_BASE } from '../api/apiClient'
import { MarkdownRenderer } from './MarkdownRenderer'
import { renderFormattedSnippet, getEffectiveTimestamp } from '../utils/textFormatter'


interface FileViewerModalProps {
  file?: FileItem | null
  fileId?: string | null
  initialFilename?: string | null
  initialFileType?: string | null
  initialPage?: number | null
  initialTimestamp?: string | null
  highlightEvidence?: string | null
  isOpen?: boolean
  onClose: () => void
}

const parseTimestampToSeconds = (ts: string | null | undefined): number => {
  if (!ts) return 0
  // Handle timestamp ranges like "00:30 - 00:41", "00:30", "01:14:22", "45s", "30"
  const firstPart = ts.split('-')[0].replace(/s$/i, '').trim()
  const parts = firstPart.split(':').map((p) => {
    const n = parseInt(p.trim(), 10)
    return isNaN(n) ? 0 : n
  })
  if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2]
  if (parts.length === 2) return (parts[0] * 60) + parts[1]
  const num = Number(firstPart)
  return isNaN(num) ? 0 : num
}

const getTargetPageExtraction = (fullText: string, pageNum: number): string | null => {
  if (!fullText || !pageNum) return null
  const pageRegex = new RegExp(
    `(?:(?:\\[Page\\s*${pageNum}\\]|---\\s*Page\\s*${pageNum}\\s*---|Page\\s*${pageNum}:))([\\s\\S]*?)(?=(?:\\[Page\\s*\\d+\\]|---\\s*Page\\s*\\d+\\s*---|Page\\s*\\d+:|$))`,
    'i'
  )
  const match = fullText.match(pageRegex)
  if (match && match[1]?.trim()) {
    return `[Page ${pageNum}]\n` + match[1].trim()
  }
  return null
}

const getTargetTimestampExtraction = (fullText: string, timestamp: string): string | null => {
  if (!fullText || !timestamp) return null
  const idx = fullText.indexOf(timestamp)
  if (idx !== -1) {
    const start = Math.max(0, idx - 80)
    const end = Math.min(fullText.length, idx + 400)
    return `... ${fullText.slice(start, end).trim()} ...`
  }
  return null
}

export const FileViewerModal: React.FC<FileViewerModalProps> = ({
  file,
  fileId,
  initialFilename,
  initialFileType,
  initialPage,
  initialTimestamp,
  highlightEvidence,
  isOpen = true,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'preview' | 'extracted'>('preview')
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [extractedData, setExtractedData] = useState<ExtractedContentResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [docxRendering, setDocxRendering] = useState(false)
  const [showOnlyTarget, setShowOnlyTarget] = useState(true)

  const docxContainerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const hasSeekedRef = useRef(false)

  const effectiveId = file?.id || fileId

  useEffect(() => {
    hasSeekedRef.current = false
  }, [effectiveId, initialTimestamp, highlightEvidence, isOpen])

  useEffect(() => {
    if (!effectiveId || !isOpen) {
      setSignedUrl(null)
      setExtractedData(null)
      setActiveTab('preview')
      setShowOnlyTarget(true)
      return
    }

    let isMounted = true
    setLoading(true)
    setShowOnlyTarget(true)

    // Parallel fetch: signed preview URL and extracted text
    Promise.all([
      getFileSignedUrl(effectiveId).catch(() => null),
      getExtractedText(effectiveId).catch(() => null),
    ]).then(([url, extracted]) => {
      if (isMounted) {
        setSignedUrl(url)
        setExtractedData(extracted)
        setLoading(false)
      }
    })

    return () => {
      isMounted = false
    }
  }, [effectiveId, isOpen, initialPage, initialTimestamp])

  const effectiveTimestamp = getEffectiveTimestamp(highlightEvidence, initialTimestamp)

  const handleMediaSeek = (el: HTMLMediaElement | null) => {
    if (!el || hasSeekedRef.current) return
    hasSeekedRef.current = true
    if (effectiveTimestamp) {
      const secs = parseTimestampToSeconds(effectiveTimestamp)
      if (secs > 0) {
        el.currentTime = secs
      }
    }
    const playPromise = el.play()
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        // Browser autoplay restrictions handled gracefully
      })
    }
  }

  const filename = file?.filename || extractedData?.filename || initialFilename || 'Document'
  const fileType = (
    file?.file_type ||
    extractedData?.file_type ||
    initialFileType ||
    (filename.toLowerCase().endsWith('.pdf') ? 'pdf' :
     filename.toLowerCase().match(/\.(png|jpe?g|webp|gif|svg|bmp)$/) ? 'image' :
     filename.toLowerCase().match(/\.(mp3|wav|ogg|m4a|aac|flac)$/) ? 'audio' :
     filename.toLowerCase().match(/\.(mp4|webm|mov|mkv|avi)$/) ? 'video' :
     filename.toLowerCase().match(/\.(docx?|txt|md)$/) ? 'document' : 'document')
  )

  const isPdf = fileType === 'pdf' || filename.toLowerCase().endsWith('.pdf')
  const isDocx = filename.toLowerCase().endsWith('.docx') || filename.toLowerCase().endsWith('.doc')
  const isImage = fileType === 'image' || Boolean(filename.toLowerCase().match(/\.(png|jpe?g|webp|gif|svg|bmp)$/))
  const isAudio = fileType === 'audio' || Boolean(filename.toLowerCase().match(/\.(mp3|wav|ogg|m4a|aac|flac)$/))
  const isVideo = fileType === 'video' || Boolean(filename.toLowerCase().match(/\.(mp4|webm|mov|mkv|avi)$/))
  
  const directEndpointUrl = isImage
    ? `${API_BASE}/files/${effectiveId}/thumbnail`
    : isAudio || isVideo
    ? `${API_BASE}/files/${effectiveId}/stream`
    : `${API_BASE}/files/${effectiveId}/stream`

  const mediaUrl = signedUrl || directEndpointUrl || (file?.storage_url?.startsWith('http') ? file.storage_url : null)


  const targetPageText = (isPdf || isDocx) && initialPage && extractedData?.extracted_text ? getTargetPageExtraction(extractedData.extracted_text, initialPage) : null
  const targetTimestampText = (isAudio || isVideo) && effectiveTimestamp && extractedData?.extracted_text ? getTargetTimestampExtraction(extractedData.extracted_text, effectiveTimestamp) : null
  const hasTargetedContent = Boolean(targetPageText || targetTimestampText)

  // Render DOCX files directly inside the browser using docx-preview
  useEffect(() => {
    if (isDocx && mediaUrl && activeTab === 'preview' && docxContainerRef.current) {
      let isCancelled = false
      setDocxRendering(true)
      fetch(mediaUrl)
        .then((res) => res.arrayBuffer())
        .then((buffer) => {
          if (!isCancelled && docxContainerRef.current) {
            docxContainerRef.current.innerHTML = ''
            return renderAsync(buffer, docxContainerRef.current, undefined, {
              inWrapper: true,
              ignoreWidth: false,
              ignoreHeight: false,
              breakPages: true,
              useBase64URL: true,
            })
          }
        })
        .catch((err) => {
          console.error('Failed to render DOCX preview:', err)
        })
        .finally(() => {
          if (!isCancelled) setDocxRendering(false)
        })

      return () => {
        isCancelled = true
      }
    }
  }, [isDocx, mediaUrl, activeTab, isOpen])

  if (!effectiveId || !isOpen) return null

  const handleRetryExtraction = async () => {
    if (!effectiveId) return
    setRetrying(true)
    try {
      await reExtractFile(effectiveId)
      setTimeout(async () => {
        const data = await getExtractedText(effectiveId)
        setExtractedData(data)
        setRetrying(false)
      }, 2000)
    } catch (err: any) {
      console.error('Retry failed:', err)
      setRetrying(false)
    }
  }

  const handleCopyText = () => {
    if (extractedData?.extracted_text) {
      navigator.clipboard.writeText(extractedData.extracted_text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1.5rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '16px',
          width: '90%',
          maxWidth: '960px',
          height: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '0.85rem 1.5rem',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'rgba(0, 0, 0, 0.2)',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', overflow: 'hidden' }}>
            <span
              style={{
                background:
                  fileType === 'image'
                    ? 'rgba(234, 179, 8, 0.15)'
                    : fileType === 'audio'
                    ? 'rgba(249, 115, 22, 0.15)'
                    : fileType === 'video'
                    ? 'rgba(168, 85, 247, 0.15)'
                    : 'rgba(14, 165, 233, 0.15)',
                color:
                  fileType === 'image'
                    ? '#facc15'
                    : fileType === 'audio'
                    ? '#fb923c'
                    : fileType === 'video'
                    ? '#c084fc'
                    : '#38bdf8',
                border: `1px solid ${
                  fileType === 'image'
                    ? 'rgba(234, 179, 8, 0.35)'
                    : fileType === 'audio'
                    ? 'rgba(249, 115, 22, 0.35)'
                    : fileType === 'video'
                    ? 'rgba(168, 85, 247, 0.35)'
                    : 'rgba(14, 165, 233, 0.35)'
                }`,
                padding: '0.2rem 0.6rem',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: 600,
                textTransform: 'uppercase',
              }}
            >
              {fileType === 'image' ? '🖼️ ' : fileType === 'audio' ? '🎵 ' : fileType === 'video' ? '🎥 ' : '📄 '}
              {fileType}
            </span>
            <h3
              style={{
                fontSize: '0.95rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '320px',
              }}
            >
              {filename}
            </h3>
          </div>

          {/* Tab Switcher */}
          <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px', padding: '0.2rem', gap: '0.2rem' }}>
            <button
              onClick={() => setActiveTab('preview')}
              style={{
                background: activeTab === 'preview' ? 'var(--accent-blue)' : 'transparent',
                color: activeTab === 'preview' ? '#fff' : 'var(--text-secondary)',
                border: 'none',
                borderRadius: '6px',
                padding: '0.35rem 0.8rem',
                fontSize: '0.78rem',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              👁️ Preview
            </button>
            <button
              onClick={() => setActiveTab('extracted')}
              style={{
                background: activeTab === 'extracted' ? 'var(--accent-blue)' : 'transparent',
                color: activeTab === 'extracted' ? '#fff' : 'var(--text-secondary)',
                border: 'none',
                borderRadius: '6px',
                padding: '0.35rem 0.8rem',
                fontSize: '0.78rem',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              📜 Extracted Text
            </button>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '1.25rem',
                cursor: 'pointer',
                padding: '0.2rem 0.5rem',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '1rem', background: '#090d16' }}>
          {activeTab === 'extracted' ? (
            /* Extracted Text View */
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
              <div
                style={{
                  padding: '0.75rem 1.25rem',
                  background: 'rgba(255, 255, 255, 0.03)',
                  borderBottom: '1px solid var(--border-color)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  <span>Status:</span>
                  <span
                    style={{
                      color:
                        extractedData?.status === 'done'
                          ? '#10b981'
                          : extractedData?.status === 'failed'
                          ? '#ef4444'
                          : '#2dd4bf',
                      fontWeight: 600,
                      textTransform: 'capitalize',
                    }}
                  >
                    {extractedData?.status || 'Processing'}
                  </span>
                  {extractedData?.extracted_text && (
                    <span style={{ marginLeft: '0.5rem' }}>
                      ({extractedData.extracted_text.length.toLocaleString()} characters)
                    </span>
                  )}
                </div>

                {extractedData?.extracted_text && (
                  <button
                    onClick={handleCopyText}
                    style={{
                      background: 'rgba(255, 255, 255, 0.08)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      padding: '0.3rem 0.7rem',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                    }}
                  >
                    {copied ? '✓ Copied' : '📋 Copy Text'}
                  </button>
                )}
              </div>
              <div style={{ flex: 1, padding: '1.25rem', overflow: 'auto' }}>
                {/* Target Page / Timestamp Filter Banner */}
                {hasTargetedContent && (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.6rem 1rem',
                      background: showOnlyTarget ? 'rgba(14, 165, 233, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                      border: `1px solid ${showOnlyTarget ? 'rgba(14, 165, 233, 0.35)' : 'var(--border-color)'}`,
                      borderRadius: '8px',
                      marginBottom: '1rem',
                      flexWrap: 'wrap',
                      gap: '0.5rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: showOnlyTarget ? '#38bdf8' : 'var(--text-secondary)', fontSize: '0.82rem', fontWeight: 600 }}>
                      <span>🎯</span>
                      <span>
                        {showOnlyTarget
                          ? initialPage
                            ? `Showing isolated extraction for Page ${initialPage}`
                            : `Showing isolated transcript near ${initialTimestamp}`
                          : 'Showing full document text'}
                      </span>
                    </div>

                    <button
                      onClick={() => setShowOnlyTarget(!showOnlyTarget)}
                      style={{
                        background: 'rgba(255, 255, 255, 0.1)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '0.25rem 0.65rem',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {showOnlyTarget
                        ? '📄 View Entire Document Text ➔'
                        : `🎯 View Only Page ${initialPage || initialTimestamp} ➔`}
                    </button>
                  </div>
                )}
                {highlightEvidence && (
                  <div
                    style={{
                      marginBottom: '0.75rem',
                      padding: '0.75rem 1rem',
                      background: 'rgba(56, 189, 248, 0.08)',
                      border: '1px solid rgba(56, 189, 248, 0.25)',
                      borderRadius: '8px',
                      fontSize: '0.85rem',
                      color: '#bae6fd',
                      lineHeight: '1.5',
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', marginBottom: '0.3rem', letterSpacing: '0.04em' }}>
                      🎯 Cited Evidence Quote:
                    </div>
                    <div>{renderFormattedSnippet(highlightEvidence)}</div>
                  </div>
                )}

                {extractedData?.extracted_text ? (
                  <div
                    style={{
                      fontSize: '0.9rem',
                      color: '#e2e8f0',
                      lineHeight: '1.65',
                      wordBreak: 'break-word',
                      padding: '0.25rem',
                    }}
                  >
                    <MarkdownRenderer
                      content={
                        showOnlyTarget && (targetPageText || targetTimestampText)
                          ? targetPageText || targetTimestampText || ''
                          : extractedData.extracted_text || ''
                      }
                      onCitationClick={() => {}}
                    />
                  </div>
                ) : extractedData?.extraction_error ? (
                  <div style={{ padding: '1.25rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)', color: '#fca5a5', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div>
                      <strong>Extraction Error:</strong> {extractedData.extraction_error}
                    </div>
                    <button
                      onClick={handleRetryExtraction}
                      disabled={retrying}
                      style={{
                        alignSelf: 'flex-start',
                        background: 'rgba(239, 68, 68, 0.2)',
                        color: '#fff',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                        borderRadius: '6px',
                        padding: '0.4rem 0.85rem',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {retrying ? '🔄 Retrying Extraction...' : '🔄 Retry Extraction'}
                    </button>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏳</div>
                    <p>Processing extraction...</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Media Preview View */
            <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              {/* Page / Timestamp target banner on preview - Only when ready and applicable */}
              {!loading && ((isPdf && initialPage) || ((isAudio || isVideo) && effectiveTimestamp)) && (
                <div
                  style={{
                    width: '100%',
                    padding: '0.45rem 1rem',
                    background: 'rgba(14, 165, 233, 0.12)',
                    borderBottom: '1px solid rgba(14, 165, 233, 0.25)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.78rem',
                    color: '#38bdf8',
                    fontWeight: 600,
                    marginBottom: '0.5rem',
                    borderRadius: '6px',
                  }}
                >
                  <span>
                    🎯 {isPdf && initialPage ? `Viewing Page ${initialPage} Preview` : `Seeked to Timestamp ${effectiveTimestamp}`}
                  </span>
                  <button
                    onClick={() => setActiveTab('extracted')}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#7dd3fc',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      textDecoration: 'underline',
                    }}
                  >
                    View Extraction ➔
                  </button>
                </div>
              )}

              {loading ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                  <div
                    style={{
                      fontSize: '3rem',
                      marginBottom: '0.25rem',
                      filter: 'drop-shadow(0 0 12px rgba(56, 189, 248, 0.4))',
                    }}
                  >
                    {fileType === 'image' ? '🖼️' : fileType === 'audio' ? '🎵' : fileType === 'video' ? '🎥' : '📄'}
                  </div>
                  <div>
                    <h4 style={{ color: 'var(--text-primary)', margin: '0 0 0.35rem 0', fontSize: '1rem', fontWeight: 600 }}>
                      {filename}
                    </h4>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
                      Loading {fileType} preview from storage...
                    </p>
                  </div>
                </div>
              ) : isPdf && mediaUrl ? (
                <iframe
                  src={initialPage ? `${mediaUrl}#page=${initialPage}&toolbar=0` : `${mediaUrl}#toolbar=0`}
                  title={filename}
                  style={{ width: '100%', height: '100%', border: 'none', borderRadius: '8px', background: '#fff' }}
                />
              ) : isDocx && mediaUrl ? (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    overflow: 'auto',
                    background: '#334155',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '1.5rem',
                    borderRadius: '8px',
                  }}
                >
                  {docxRendering && (
                    <div style={{ padding: '3rem', color: '#fff', textAlign: 'center' }}>
                      <div style={{ fontSize: '2.5rem', marginBottom: '1rem', animation: 'pulse 1.5s infinite' }}>📄</div>
                      <p style={{ fontSize: '0.95rem', fontWeight: 500 }}>Rendering Word document...</p>
                    </div>
                  )}
                  <div
                    ref={docxContainerRef}
                    style={{
                      width: '100%',
                      maxWidth: '820px',
                      background: '#ffffff',
                      boxShadow: '0 10px 30px rgba(0, 0, 0, 0.45)',
                      borderRadius: '4px',
                      color: '#0f172a',
                      padding: '2rem',
                      display: docxRendering ? 'none' : 'block',
                      overflowX: 'auto',
                    }}
                  />
                </div>
              ) : isImage && mediaUrl ? (
                <div style={{ maxWidth: '100%', maxHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
                  <img
                    src={mediaUrl}
                    alt={filename}
                    onError={(e) => {
                      const fallback = `${API_BASE}/files/${effectiveId}/thumbnail`
                      if (e.currentTarget.src !== fallback) {
                        e.currentTarget.src = fallback
                      }
                    }}
                    style={{ maxWidth: '100%', maxHeight: '72vh', objectFit: 'contain', borderRadius: '8px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}
                  />
                </div>
              ) : isAudio && mediaUrl ? (
                <div style={{ textAlign: 'center', width: '100%', maxWidth: '500px', padding: '2rem', background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '3.5rem', marginBottom: '0.75rem' }}>🎵</div>
                  <h4 style={{ marginBottom: '1.25rem', color: 'var(--text-primary)' }}>{filename}</h4>
                  
                  {effectiveTimestamp && (
                    <button
                      className="btn btn-primary"
                      style={{ marginBottom: '1.25rem', fontSize: '0.85rem', padding: '0.45rem 1.1rem', borderRadius: '8px' }}
                      onClick={() => {
                        if (audioRef.current) {
                          const secs = parseTimestampToSeconds(effectiveTimestamp)
                          audioRef.current.currentTime = secs
                          audioRef.current.play().catch(() => {})
                        }
                      }}
                    >
                      ▶ Play Spoken Segment ({effectiveTimestamp})
                    </button>
                  )}

                  <audio
                    ref={audioRef}
                    controls
                    autoPlay
                    src={mediaUrl}
                    onError={(e) => {
                      const fallback = `${API_BASE}/files/${effectiveId}/stream`
                      if (e.currentTarget.src !== fallback) {
                        e.currentTarget.src = fallback
                      }
                    }}
                    onLoadedMetadata={(e) => handleMediaSeek(e.currentTarget)}
                    style={{ width: '100%' }}
                  />
                </div>

              ) : isVideo && mediaUrl ? (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <video
                    ref={videoRef}
                    controls
                    autoPlay
                    src={mediaUrl}
                    onLoadedMetadata={(e) => handleMediaSeek(e.currentTarget)}
                    style={{ maxWidth: '100%', maxHeight: '72vh', borderRadius: '8px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}
                  >
                    Your browser does not support native playback for this video format.
                  </video>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '2rem', background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', maxWidth: '500px' }}>
                  <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📄</div>
                  <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>{filename}</h4>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                    Document stored in Supabase. You can view the full extracted text.
                  </p>
                  <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                    <button onClick={() => setActiveTab('extracted')} className="btn btn-primary">
                      📜 View Extracted Text
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
