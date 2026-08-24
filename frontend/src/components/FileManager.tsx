import { useState, useEffect, useRef } from 'react'
import { FileItem, listFiles, uploadFiles, deleteFile, clearConversationFiles, reExtractFile, getCachedFiles } from '../api/filesApi'
import { FileViewerModal } from './FileViewerModal'

interface FileManagerProps {
  conversationId: string
  onFilesChanged?: () => void
  onFileCountChange?: (count: number) => void
  onNavigateTab?: (tab: 'chat' | 'retrieval' | 'graph') => void
  isGuest?: boolean
  onOpenAuth?: () => void
}

export const FileManager: React.FC<FileManagerProps> = ({
  conversationId,
  onFilesChanged,
  onFileCountChange,
  onNavigateTab,
  isGuest = false,
  onOpenAuth,
}) => {


  const initialCache = getCachedFiles(conversationId, 'all')
  const [files, setFiles] = useState<FileItem[]>(() => initialCache?.files || [])
  const [counts, setCounts] = useState(() => initialCache?.by_type || { document: 0, image: 0, audio: 0, video: 0 })
  const [filterType, setFilterType] = useState<string>('all')
  const [loading, setLoading] = useState(() => !initialCache)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [showClearModal, setShowClearModal] = useState(false)
  const [fileToDelete, setFileToDelete] = useState<{ id: string; filename: string } | null>(null)
  const [viewingFile, setViewingFile] = useState<FileItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set())
  const [retryingAll, setRetryingAll] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const notifyFilesChanged = (newCount?: number, action?: 'uploading' | 'deleted_all' | 'deleted_partial' | 'sync') => {
    if (typeof newCount === 'number') {
      onFileCountChange?.(newCount)
    }
    onFilesChanged?.()
    window.dispatchEvent(
      new CustomEvent('trace_files_changed', {
        detail: { conversationId, count: newCount, action },
      })
    )
  }

  const loadFiles = async (silent: boolean = false) => {
    if (!conversationId) {
      if (!silent) setLoading(false)
      setFiles([])
      return
    }
    if (!silent) setLoading(true)
    setError(null)
    try {
      const data = await listFiles(conversationId, filterType)
      setFiles(data.files)
      setCounts(data.by_type)
      onFileCountChange?.(data.total)
    } catch (err: any) {
      if (!silent) setError(err.message || 'Failed to load files from server.')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    const cached = getCachedFiles(conversationId, filterType)
    if (cached) {
      setFiles(cached.files)
      setCounts(cached.by_type)
      onFileCountChange?.(cached.total)
      loadFiles(true) // Silent background refresh
    } else {
      loadFiles(false)
    }
  }, [conversationId, filterType])

  // Auto-poll only when files are actively extracting; 6s is frequent enough without flooding
  useEffect(() => {
    const hasActiveExtraction = files.some((f) => f.status === 'processing' || f.status === 'pending')
    if (!hasActiveExtraction) return

    const interval = setInterval(() => {
      loadFiles(true)
    }, 6000)

    return () => clearInterval(interval)
  }, [files, conversationId, filterType])

  const handleFileUpload = async (selectedFiles: FileList | File[]) => {
    if (isGuest || conversationId === 'conv_demo') {
      setError('File uploads are disabled in Guest Demo Mode. Please sign in to create personal workspaces and upload custom files.')
      if (onOpenAuth) onOpenAuth()
      return
    }
    if (!selectedFiles || selectedFiles.length === 0) return
    setUploading(true)
    setError(null)
    setSuccessMsg(null)

    const fileArray = Array.from(selectedFiles)

    // Check file sizes on client-side (50 MB limit)
    const MAX_SIZE = 50 * 1024 * 1024
    for (const file of fileArray) {
      if (file.size > MAX_SIZE) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1)
        setError(`File "${file.name}" (${sizeMB} MB) exceeds the 50 MB upload limit.`)
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }
    }

    // Immediately signal Knowledge Graph that files are uploading
    notifyFilesChanged(files.length + fileArray.length, 'uploading')

    try {
      const result = await uploadFiles(conversationId, fileArray)
      if (result.errors && result.errors.length > 0) {
        setError(`Upload issue: ${result.errors[0].error}`)
      } else {
        setSuccessMsg(`Uploaded ${result.count} file(s). Multimodal extraction started in background!`)
        setTimeout(() => setSuccessMsg(null), 4000)
      }
      await loadFiles()
      notifyFilesChanged(files.length + (result?.count || 0), 'uploading')
    } catch (err: any) {
      setError(err.message || 'Upload failed.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const confirmDeleteFile = async () => {
    if (!fileToDelete) return
    const { id: fileId, filename } = fileToDelete
    setFileToDelete(null)

    const remaining = files.filter((f) => f.id !== fileId)
    setFiles(remaining)
    setCounts((prev) => {
      const removed = files.find((f) => f.id === fileId)
      if (removed && prev[removed.file_type] !== undefined) {
        return { ...prev, [removed.file_type]: Math.max(0, prev[removed.file_type] - 1) }
      }
      return prev
    })

    const deleteAction = remaining.length === 0 ? 'deleted_all' : 'deleted_partial'
    notifyFilesChanged(remaining.length, deleteAction)

    try {
      await deleteFile(fileId)
      setSuccessMsg(`Deleted "${filename}"`)
      setTimeout(() => setSuccessMsg(null), 3000)
      notifyFilesChanged(remaining.length, 'sync')
    } catch (err: any) {
      setError(err.message || 'Failed to delete file.')
      await loadFiles(true)
    }
  }

  const handleClearAll = async () => {
    setFiles([])
    setCounts({ document: 0, image: 0, audio: 0, video: 0 })
    setShowClearModal(false)
    notifyFilesChanged(0, 'deleted_all')

    try {
      const count = await clearConversationFiles(conversationId)
      setSuccessMsg(`Cleared ${count} file(s) for this conversation.`)
      setTimeout(() => setSuccessMsg(null), 3000)
      notifyFilesChanged(0, 'sync')
    } catch (err: any) {
      setError(err.message || 'Failed to clear files.')
      await loadFiles(true)
    }
  }

  const handleRetryFile = async (fileId: string) => {
    setRetryingIds((prev) => new Set(prev).add(fileId))
    try {
      await reExtractFile(fileId)
      setSuccessMsg('Re-extraction started in background!')
      setTimeout(() => setSuccessMsg(null), 3000)
      setTimeout(() => loadFiles(true), 1500)
    } catch (err: any) {
      setError(err.message || 'Failed to re-extract file.')
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev)
        next.delete(fileId)
        return next
      })
    }
  }

  const handleRetryAllFailed = async () => {
    const failedFiles = files.filter((f) => f.status === 'failed')
    if (failedFiles.length === 0) return
    setRetryingAll(true)
    try {
      await Promise.allSettled(failedFiles.map((f) => reExtractFile(f.id)))
      setSuccessMsg(`Re-extracting ${failedFiles.length} failed file(s) in background!`)
      setTimeout(() => setSuccessMsg(null), 4000)
      setTimeout(() => loadFiles(true), 2000)
    } catch (err: any) {
      setError(err.message || 'Failed to trigger re-extraction.')
    } finally {
      setRetryingAll(false)
    }
  }

  const handleOpenPreview = (file: FileItem) => {
    setViewingFile(file)
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const formatDate = (isoString: string) => {
    if (!isoString) return ''
    const d = new Date(isoString)
    return d.toLocaleDateString()
  }


  // Distinct, high-contrast type color styling
  const getTypeColor = (type: string) => {
    switch (type) {
      case 'document':
        return { bg: 'rgba(14, 165, 233, 0.15)', text: '#38bdf8', border: 'rgba(14, 165, 233, 0.35)', icon: '📄' }
      case 'image':
        return { bg: 'rgba(234, 179, 8, 0.15)', text: '#facc15', border: 'rgba(234, 179, 8, 0.35)', icon: '🖼️' }
      case 'audio':
        return { bg: 'rgba(249, 115, 22, 0.15)', text: '#fb923c', border: 'rgba(249, 115, 22, 0.35)', icon: '🎵' }
      case 'video':
        return { bg: 'rgba(168, 85, 247, 0.15)', text: '#c084fc', border: 'rgba(168, 85, 247, 0.35)', icon: '🎥' }
      default:
        return { bg: 'rgba(148, 163, 184, 0.15)', text: '#cbd5e1', border: 'rgba(148, 163, 184, 0.35)', icon: '📁' }
    }
  }

  // Distinguishable status badges - sleek modern micro-pills with glowing status dots
  const getStatusBadge = (file: FileItem) => {
    const isRetrying = retryingIds.has(file.id)

    if (isRetrying || file.status === 'processing' || file.status === 'pending') {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            background: 'rgba(6, 182, 212, 0.12)',
            color: '#38bdf8',
            border: '1px solid rgba(6, 182, 212, 0.35)',
            borderRadius: '999px',
            padding: '0.18rem 0.52rem',
            fontSize: '0.69rem',
            fontWeight: 600,
            lineHeight: 1,
            animation: 'pulse 1.5s infinite',
          }}
        >
          <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#38bdf8', display: 'inline-block' }} />
          <span>{isRetrying ? 'Retrying...' : 'Extracting...'}</span>
        </span>
      )
    }
    if (file.status === 'failed') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              background: 'rgba(239, 68, 68, 0.12)',
              color: '#f87171',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '999px',
              padding: '0.18rem 0.52rem',
              fontSize: '0.69rem',
              fontWeight: 600,
              lineHeight: 1,
            }}
          >
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
            <span>Failed</span>
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleRetryFile(file.id)
            }}
            title="Retry extraction"
            style={{
              background: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#fff',
              borderRadius: '6px',
              padding: '0.15rem 0.45rem',
              fontSize: '0.68rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            🔄 Retry
          </button>
        </div>
      )
    }
    if (file.status === 'done' || file.extracted_text) {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.32rem',
            background: 'rgba(16, 185, 129, 0.12)',
            color: '#34d399',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: '999px',
            padding: '0.18rem 0.52rem',
            fontSize: '0.69rem',
            fontWeight: 600,
            lineHeight: 1,
            boxShadow: '0 0 8px rgba(16, 185, 129, 0.12)',
          }}
        >
          <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 6px #10b981' }} />
          <span>Extracted</span>
        </span>
      )
    }
    return null
  }

  const totalFilesCount = counts.document + counts.image + counts.audio + counts.video
  const failedCount = files.filter((f) => f.status === 'failed').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      {/* Interactive Workflow & Navigation Directions Guide (Compact) */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(30, 27, 75, 0.5) 0%, rgba(15, 23, 42, 0.75) 100%)',
          border: '1px solid rgba(99, 102, 241, 0.35)',
          borderRadius: '12px',
          padding: '0.75rem 1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.55rem',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1rem' }}>🧭</span>
          <div>
            <h4 style={{ margin: 0, fontSize: '0.86rem', fontWeight: 700, color: '#f8fafc', letterSpacing: '-0.01em' }}>
              Multimodal Ingest Workspace & Exploration Guide
            </h4>
            <p style={{ margin: '0.1rem 0 0 0', fontSize: '0.72rem', color: '#94a3b8' }}>
              These files are transcribed, OCR-extracted, and indexed into vectors & knowledge graphs. Explore next steps:
            </p>
          </div>
        </div>

        {/* Guest Demo Mode Explanatory Notice */}
        {isGuest && (
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.08) 0%, rgba(99, 102, 241, 0.08) 100%)',
              border: '1px solid rgba(56, 189, 248, 0.22)',
              borderRadius: '8px',
              padding: '0.45rem 0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.73rem',
              color: '#e2e8f0',
              lineHeight: '1.4',
            }}
          >
            <span style={{ fontSize: '0.95rem', flexShrink: 0 }}>💡</span>
            <div>
              <span style={{ fontWeight: 700, color: '#38bdf8' }}>Guest Demo Mode: </span>
              <span>
                You are currently in Guest Mode. You can freely explore, test queries, inspect retrieval weights, and traverse the Knowledge Graph. To upload your own custom files, create private workspaces, and save changes, please <strong>Sign In</strong>. Note that in Guest Mode, refreshing the page will reset Chat Synthesis and Retrieval Inspector back to their default demo state.
              </span>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.55rem' }}>
          {/* Card 1: Chat */}
          <div
            onClick={() => onNavigateTab?.('chat')}
            style={{
              background: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.25)',
              borderRadius: '9px',
              padding: '0.6rem 0.75rem',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '0.35rem',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)'
              e.currentTarget.style.background = 'rgba(59, 130, 246, 0.16)'
              e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.55)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'none'
              e.currentTarget.style.background = 'rgba(59, 130, 246, 0.08)'
              e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.25)'
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.15rem' }}>
                <span style={{ fontSize: '0.9rem' }}>💬</span>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#60a5fa' }}>1. Chat & Synthesis</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.7rem', color: '#cbd5e1', lineHeight: '1.35' }}>
                Ask questions to have deep conversations grounded across files with verifiable citations.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#93c5fd', fontSize: '0.7rem', fontWeight: 700 }}>
              <span>Go to Chat</span>
              <span>→</span>
            </div>
          </div>

          {/* Card 2: Retrieval Inspector */}
          <div
            onClick={() => onNavigateTab?.('retrieval')}
            style={{
              background: 'rgba(6, 182, 212, 0.08)',
              border: '1px solid rgba(6, 182, 212, 0.25)',
              borderRadius: '9px',
              padding: '0.6rem 0.75rem',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '0.35rem',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)'
              e.currentTarget.style.background = 'rgba(6, 182, 212, 0.16)'
              e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.55)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'none'
              e.currentTarget.style.background = 'rgba(6, 182, 212, 0.08)'
              e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.25)'
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.15rem' }}>
                <span style={{ fontSize: '0.9rem' }}>🔍</span>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#38bdf8' }}>2. Retrieval Inspector</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.7rem', color: '#cbd5e1', lineHeight: '1.35' }}>
                Inspect vector dense embeddings, BM25 exact matches, and LLM modality routing weights.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#7dd3fc', fontSize: '0.7rem', fontWeight: 700 }}>
              <span>Inspect Retrieval</span>
              <span>→</span>
            </div>
          </div>

          {/* Card 3: Knowledge Graph */}
          <div
            onClick={() => onNavigateTab?.('graph')}
            style={{
              background: 'rgba(168, 85, 247, 0.08)',
              border: '1px solid rgba(168, 85, 247, 0.25)',
              borderRadius: '9px',
              padding: '0.6rem 0.75rem',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '0.35rem',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)'
              e.currentTarget.style.background = 'rgba(168, 85, 247, 0.16)'
              e.currentTarget.style.borderColor = 'rgba(168, 85, 247, 0.55)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'none'
              e.currentTarget.style.background = 'rgba(168, 85, 247, 0.08)'
              e.currentTarget.style.borderColor = 'rgba(168, 85, 247, 0.25)'
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.15rem' }}>
                <span style={{ fontSize: '0.9rem' }}>🕸️</span>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#c084fc' }}>3. Knowledge Graph</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.7rem', color: '#cbd5e1', lineHeight: '1.35' }}>
                Visualize cross-file entity networks, multi-hop reasoning relationships, and node connections.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#d8b4fe', fontSize: '0.7rem', fontWeight: 700 }}>
              <span>Explore Graph</span>
              <span>→</span>
            </div>
          </div>
        </div>
      </div>

      {/* Upload Zone (Compact Sleek Bar) */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!isGuest && conversationId !== 'conv_demo') setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (isGuest || conversationId === 'conv_demo') {
            setError('File uploads are disabled in Guest Demo Mode. Please sign in to create personal workspaces and upload custom files.')
            if (onOpenAuth) onOpenAuth()
            return
          }
          if (e.dataTransfer.files) handleFileUpload(e.dataTransfer.files)
        }}
        style={{
          border: isGuest || conversationId === 'conv_demo'
            ? '1px dashed rgba(255, 255, 255, 0.1)'
            : `1.5px dashed ${dragOver ? '#3b82f6' : 'rgba(255, 255, 255, 0.15)'}`,
          background: isGuest || conversationId === 'conv_demo'
            ? 'rgba(255, 255, 255, 0.015)'
            : dragOver ? 'rgba(59, 130, 246, 0.08)' : 'rgba(255, 255, 255, 0.02)',
          borderRadius: '12px',
          padding: '0.85rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
          transition: 'all 0.2s ease',
          cursor: isGuest || conversationId === 'conv_demo' ? 'default' : 'pointer',
        }}
        onClick={() => {
          if (isGuest || conversationId === 'conv_demo') {
            if (onOpenAuth) onOpenAuth()
          } else {
            fileInputRef.current?.click()
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          disabled={isGuest || conversationId === 'conv_demo'}
          onChange={(e) => {
            if (e.target.files) handleFileUpload(e.target.files)
          }}
          style={{ display: 'none' }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flex: 1, minWidth: '240px' }}>
          <div style={{ fontSize: '1.6rem', flexShrink: 0 }}>
            {uploading ? '⏳' : isGuest || conversationId === 'conv_demo' ? '🔒' : '📤'}
          </div>
          <div>
            <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              {isGuest || conversationId === 'conv_demo'
                ? 'File Uploads Locked in Guest Mode'
                : uploading
                ? 'Uploading & Extracting Content...'
                : 'Drag & drop files here, or browse to upload'}
            </h3>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.15rem 0 0 0' }}>
              {isGuest || conversationId === 'conv_demo'
                ? 'Sign in to create your own personal workspaces, upload custom documents, and persist chats.'
                : 'Supports PDF, DOCX, TXT, PNG, JPG, WEBP, MP3, M4A, WAV, MP4, MKV (Auto OCR & Speech-to-Text).'}
            </p>
          </div>
        </div>

        {isGuest || conversationId === 'conv_demo' ? (
          <button
            type="button"
            className="btn"
            style={{
              padding: '0.42rem 0.95rem',
              fontSize: '0.78rem',
              fontWeight: 700,
              flexShrink: 0,
              background: 'linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)',
              color: '#fff',
              borderRadius: '8px',
              border: 'none',
              boxShadow: '0 2px 10px rgba(99, 102, 241, 0.35)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (onOpenAuth) onOpenAuth()
            }}
          >
            <span>🔒</span>
            <span>Sign In to Upload</span>
          </button>
        ) : (
          <button
            type="button"
            disabled={uploading}
            className="btn btn-primary"
            style={{
              padding: '0.42rem 0.95rem',
              fontSize: '0.78rem',
              fontWeight: 700,
              flexShrink: 0,
              boxShadow: '0 2px 10px rgba(99, 102, 241, 0.35)',
            }}
            onClick={(e) => {
              e.stopPropagation()
              fileInputRef.current?.click()
            }}
          >
            {uploading ? 'Uploading...' : 'Select Files'}
          </button>
        )}
      </div>


      {/* Alerts */}
      {error && (
        <div style={{ padding: '0.85rem 1.25rem', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '10px', color: '#fca5a5', fontSize: '0.9rem' }}>
          ⚠️ {error}
        </div>
      )}
      {successMsg && (
        <div style={{ padding: '0.85rem 1.25rem', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '10px', color: '#6ee7b7', fontSize: '0.9rem' }}>
          ✅ {successMsg}
        </div>
      )}

      {/* Filter Tabs & Header Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        {/* Filter Chips */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {[
            { id: 'all', label: 'All Files', count: totalFilesCount, activeColor: '#6366f1', activeBorder: '#818cf8' },
            { id: 'document', label: 'Documents', count: counts.document, activeColor: '#0ea5e9', activeBorder: '#38bdf8' },
            { id: 'image', label: 'Images', count: counts.image, activeColor: '#d97706', activeBorder: '#facc15' },
            { id: 'audio', label: 'Audio', count: counts.audio, activeColor: '#ea580c', activeBorder: '#fb923c' },
            { id: 'video', label: 'Video', count: counts.video, activeColor: '#9333ea', activeBorder: '#c084fc' },
          ].map((tab) => {
            const isActive = filterType === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setFilterType(tab.id)}
                style={{
                  background: isActive ? tab.activeColor : 'rgba(255, 255, 255, 0.05)',
                  color: isActive ? '#fff' : 'var(--text-secondary)',
                  border: `1px solid ${isActive ? tab.activeBorder : 'var(--border-color)'}`,
                  borderRadius: '20px',
                  padding: '0.4rem 0.9rem',
                  fontSize: '0.82rem',
                  fontWeight: isActive ? 600 : 500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  transition: 'all 0.2s ease',
                  boxShadow: isActive ? `0 2px 8px ${tab.activeColor}40` : 'none',
                }}
              >
                <span>{tab.label}</span>
                <span
                  style={{
                    background: isActive ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.1)',
                    borderRadius: '10px',
                    padding: '0.1rem 0.45rem',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                  }}
                >
                  {tab.count}
                </span>
              </button>
            )
          })}
        </div>

        {/* Action Buttons: Reload, Retry Failed, Clear All */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {/* Reload / Refresh Button */}
          <button
            onClick={() => loadFiles(false)}
            disabled={loading}
            title="Reload files from Supabase"
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              color: 'var(--text-primary)',
              padding: '0.45rem 0.85rem',
              fontSize: '0.82rem',
              cursor: 'pointer',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
          >
            <span>{loading ? '⏳' : '🔄'}</span>
            <span>{loading ? 'Reloading...' : 'Reload Files'}</span>
          </button>

          {/* Re-extract All Failed Button */}
          {failedCount > 0 && (
            <button
              onClick={handleRetryAllFailed}
              disabled={retryingAll}
              title="Re-run extraction for all failed files"
              style={{
                background: 'rgba(239, 68, 68, 0.18)',
                color: '#fca5a5',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                borderRadius: '8px',
                padding: '0.45rem 0.85rem',
                fontSize: '0.82rem',
                cursor: 'pointer',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              <span>{retryingAll ? '⏳' : '🔄'}</span>
              <span>{retryingAll ? 'Retrying...' : `Re-extract Failed (${failedCount})`}</span>
            </button>
          )}

          {/* Clear All Button — Authenticated only */}
          {!isGuest && conversationId !== 'conv_demo' && files.length > 0 && (
            <button
              onClick={() => setShowClearModal(true)}
              style={{
                background: 'rgba(239, 68, 68, 0.12)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '8px',
                padding: '0.45rem 0.85rem',
                fontSize: '0.82rem',
                cursor: 'pointer',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              🗑️ Clear All ({files.length})
            </button>
          )}
        </div>
      </div>

      {/* Files List / Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          Loading files from Supabase...
        </div>
      ) : files.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3.5rem 1rem', background: 'rgba(255, 255, 255, 0.01)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.5 }}>📂</div>
          <h4 style={{ color: 'var(--text-primary)', fontWeight: 500 }}>No files uploaded yet</h4>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
            Upload PDFs, Word docs, images, audio, or video files to scope them to this conversation.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '0.75rem' }}>
          {files.map((file) => {
            const style = getTypeColor(file.file_type)
            const statusBadge = getStatusBadge(file)

            return (
              <div
                key={file.id}
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '12px',
                  padding: '0.95rem 1.05rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  transition: 'transform 0.15s ease, border-color 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.35)'
                  e.currentTarget.style.transform = 'translateY(-2px)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-color)'
                  e.currentTarget.style.transform = 'none'
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          background: style.bg,
                          color: style.text,
                          border: `1px solid ${style.border}`,
                          borderRadius: '999px',
                          padding: '0.18rem 0.52rem',
                          fontSize: '0.69rem',
                          fontWeight: 600,
                          textTransform: 'capitalize',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          lineHeight: 1,
                        }}
                      >
                        <span>{style.icon}</span>
                        <span>{file.file_type}</span>
                      </span>
                      {statusBadge}
                    </div>

                    {!isGuest && conversationId !== 'conv_demo' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setFileToDelete({ id: file.id, filename: file.filename })
                        }}
                        title="Delete file"
                        style={{
                          background: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.25)',
                          color: '#f87171',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          padding: '0.2rem 0.45rem',
                          borderRadius: '6px',
                          lineHeight: 1,
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)'
                          e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.5)'
                          e.currentTarget.style.color = '#fff'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'
                          e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.25)'
                          e.currentTarget.style.color = '#f87171'
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <h4
                    title={file.filename}
                    style={{
                      fontSize: '0.86rem',
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      marginTop: '0.5rem',
                      lineHeight: '1.4',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      wordBreak: 'break-word',
                      overflowWrap: 'break-word',
                    }}
                  >
                    {file.filename.replace(/[_-]/g, ' ')}
                  </h4>

                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                    paddingTop: '0.45rem',
                    gap: '0.4rem',
                    flexWrap: 'nowrap',
                    overflow: 'hidden',
                  }}
                >
                  <span style={{
                    fontSize: '0.7rem',
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    flexShrink: 1,
                  }}>
                    {formatFileSize(file.file_size_bytes)}
                    {file.uploaded_at && <>
                      <span style={{ margin: '0 0.25rem', opacity: 0.5 }}>•</span>
                      <span>{formatDate(file.uploaded_at)}</span>
                    </>}
                  </span>

                  <button
                    onClick={() => handleOpenPreview(file)}
                    title="Open preview"
                    style={{
                      background: 'rgba(56, 189, 248, 0.12)',
                      border: '1px solid rgba(56, 189, 248, 0.5)',
                      color: '#38bdf8',
                      padding: '0.22rem 0.7rem',
                      borderRadius: '999px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      transition: 'all 0.15s ease',
                      lineHeight: 1.5,
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(56, 189, 248, 0.25)'
                      e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.9)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(56, 189, 248, 0.12)'
                      e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.5)'
                    }}
                  >
                    View ↗
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* In-App File Viewer Modal */}
      <FileViewerModal
        file={viewingFile}
        isOpen={Boolean(viewingFile)}
        onClose={() => setViewingFile(null)}
      />

      {/* Single File Delete Confirmation Modal */}
      {fileToDelete && (
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
          onClick={() => setFileToDelete(null)}
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
              Delete File?
            </h3>

            <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: '1.75rem', lineHeight: '1.55' }}>
              Are you sure you want to delete <strong style={{ color: '#fca5a5', wordBreak: 'break-word' }}>"{fileToDelete.filename}"</strong>?
              <br />
              <span style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginTop: '0.4rem' }}>
                This will remove its extracted text, vectors, and relations from the knowledge graph.
              </span>
            </p>

            <div style={{ display: 'flex', gap: '0.85rem', justifyContent: 'center' }}>
              <button
                onClick={() => setFileToDelete(null)}
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
                onClick={confirmDeleteFile}
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
                Yes, Delete File
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear All Confirmation Modal */}
      {showClearModal && (
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
          onClick={() => setShowClearModal(false)}
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
              ⚠️
            </div>

            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc', marginBottom: '0.6rem', letterSpacing: '-0.01em' }}>
              Clear All Files?
            </h3>

            <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: '1.75rem', lineHeight: '1.55' }}>
              This will delete all <strong style={{ color: '#fca5a5' }}>{files.length} file(s)</strong> in this session from Supabase storage and vector database.
            </p>

            <div style={{ display: 'flex', gap: '0.85rem', justifyContent: 'center' }}>
              <button
                onClick={() => setShowClearModal(false)}
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
                onClick={handleClearAll}
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
                Yes, Delete All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
