import React, { useEffect, useState } from 'react'
import { getGraphData, traverseGraph, rebuildGraph, GraphDataResponse, GraphNode, MultiHopResponse } from '../api/graphApi'
import { listFiles } from '../api/filesApi'
import { InteractiveGraphCanvas, getNodeStyle, isMatchingNode } from './InteractiveGraphCanvas'
import { renderFormattedSnippet } from '../utils/textFormatter'

interface KnowledgeGraphViewerProps {
  conversationId: string
}

export const KnowledgeGraphViewer: React.FC<KnowledgeGraphViewerProps> = ({ conversationId }) => {
  const [graphData, setGraphData] = useState<GraphDataResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [isGraphUpdating, setIsGraphUpdating] = useState(false)
  const [processingFiles, setProcessingFiles] = useState<string[]>([])
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [secondaryNode, setSecondaryNode] = useState<GraphNode | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<'canvas' | 'list'>('canvas')

  // Multi-hop path tracer states
  const [entityA, setEntityA] = useState('')
  const [entityB, setEntityB] = useState('')
  const [pathResult, setPathResult] = useState<MultiHopResponse | null>(null)
  const [tracingPath, setTracingPath] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const checkFilesAndLoadGraph = async (silent: boolean = false) => {
    if (!conversationId) {
      if (!silent) setLoading(false)
      setIsGraphUpdating(false)
      return false
    }
    if (!silent) setLoading(true)
    setError(null)
    try {
      // 1. Check if any file in this conversation is actively extracting in background
      const fileData = await listFiles(conversationId).catch(() => null)
      const files = fileData?.files || []

      // If NO files exist in this session at all, immediately clear and show empty state
      if (files.length === 0) {
        setGraphData({
          conversation_id: conversationId,
          node_count: 0,
          edge_count: 0,
          nodes: [],
          edges: [],
        })
        setProcessingFiles([])
        setIsGraphUpdating(false)
        return false
      }

      const active = files.filter(
        (f) => f.status === 'processing' || f.status === 'pending'
      )

      if (active.length > 0) {


        setProcessingFiles(active.map((f) => f.filename))
        setIsGraphUpdating(true)
      } else {
        setProcessingFiles([])
        setIsGraphUpdating(false)
      }

      // Always load and render latest graph data
      const data = await getGraphData(conversationId)
      setGraphData(data)
      return active.length > 0

    } catch (err: any) {
      if (!silent) setError(err.message || 'Failed to load knowledge graph.')
      setIsGraphUpdating(false)
      return false
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const fetchGraph = async () => {
    await checkFilesAndLoadGraph(false)
  }

  useEffect(() => {
    // Reset conversation-scoped states
    setGraphData(null)
    setSelectedNode(null)
    setSecondaryNode(null)
    setEntityA('')
    setEntityB('')
    setPathResult(null)
    setSearchQuery('')
    setError(null)
    setIsGraphUpdating(false)
    setProcessingFiles([])

    // NOTE: Initial load is handled below in startPolling block

    // Check files & refresh graph whenever files are modified
    const handleFilesChanged = (e: any) => {
      setSelectedNode(null)
      setSecondaryNode(null)
      setPathResult(null)
      setPathChain([])
      pathChainRef.current = []

      const count = e.detail?.count
      const action = e.detail?.action

      if (count === 0 || action === 'deleted_all') {
        // 1. ALL files deleted / 0 files: ZERO-LATENCY INSTANT EMPTY STATE
        setGraphData({
          conversation_id: conversationId,
          node_count: 0,
          edge_count: 0,
          nodes: [],
          edges: [],
        })
        setProcessingFiles([])
        setIsGraphUpdating(false)
        setLoading(false)
        return
      } else if (action === 'uploading' || action === 'deleted_partial') {
        // 2. Files added or partial file deleted: ZERO-LATENCY INSTANT UPDATE SCREEN
        setIsGraphUpdating(true)
        setGraphData(null)
        setLoading(false)
      } else if (action === 'sync') {
        // 3. Final server sync after backend DB operation finishes
        checkFilesAndLoadGraph(false)
      }
    }

    window.addEventListener('trace_files_changed', handleFilesChanged)

    // Only poll if files are actively being processed; 8s is enough to catch completions
    // without flooding the backend (the old 1.2s poll was saturating connections)
    let pollInterval: ReturnType<typeof setInterval> | null = null

    const startPolling = () => {
      if (pollInterval) return
      pollInterval = setInterval(() => {
        checkFilesAndLoadGraph(true)
      }, 8000)
    }

    const stopPolling = () => {
      if (pollInterval) { clearInterval(pollInterval); pollInterval = null }
    }

    // Start polling only if there are actively processing files
    checkFilesAndLoadGraph(false).then((hasActive) => {
      if (hasActive) startPolling()
    })

    // Listen for file changes to start/stop polling appropriately
    const handlePollControl = (e: any) => {
      if (e.detail?.action === 'uploading') startPolling()
      else if (e.detail?.action === 'deleted_all') stopPolling()
    }
    window.addEventListener('trace_files_changed', handlePollControl)

    return () => {
      window.removeEventListener('trace_files_changed', handleFilesChanged)
      window.removeEventListener('trace_files_changed', handlePollControl)
      stopPolling()
    }
  }, [conversationId])

  const handleRebuild = async () => {
    setRebuilding(true)
    setError(null)
    try {
      await rebuildGraph(conversationId)
      await checkFilesAndLoadGraph(false)
    } catch (err: any) {
      setError(err.message || 'Failed to sync graph.')
    } finally {
      setRebuilding(false)
    }
  }

  const [pathChain, setPathChain] = useState<GraphNode[]>([])
  const pathChainRef = React.useRef<GraphNode[]>([])

  // Helper: does an edge endpoint string match a node?
  // edges store source/target as node ID (graph key), but display name may differ.
  const edgeEndpointMatchesNode = (endpoint: string, node: GraphNode): boolean => {
    if (!endpoint || !node) return false
    // Primary: node.id IS the graph key stored in edge.source/target
    if (endpoint === node.id) return true
    if (node.canonical_id && endpoint === node.canonical_id) return true
    // Fallback: display name match (some edges may store by name)
    if (endpoint === node.name) return true
    // Case-insensitive name match for robustness
    if (endpoint.toLowerCase() === node.name?.toLowerCase()) return true
    if (node.aliases?.some(a => endpoint === a || endpoint.toLowerCase() === a.toLowerCase())) return true
    return false
  }

  // Two-pass search: ALWAYS prefer forward (nodeA→nodeB) over reverse.
  // Only returns {forward: false} if there is genuinely no forward edge between them.
  const findConnectingEdge = (nodeA: GraphNode, nodeB: GraphNode) => {
    if (!graphData?.edges) return null

    let reverseMatch: (typeof graphData.edges)[0] | null = null

    for (const e of graphData.edges) {
      const sMatchesA = edgeEndpointMatchesNode(e.source, nodeA)
      const tMatchesB = edgeEndpointMatchesNode(e.target, nodeB)
      // Forward match — return immediately (highest priority)
      if (sMatchesA && tMatchesB) return { edge: e, forward: true }

      // Reverse match — record but keep scanning for a forward match
      if (!reverseMatch) {
        const sMatchesB = edgeEndpointMatchesNode(e.source, nodeB)
        const tMatchesA = edgeEndpointMatchesNode(e.target, nodeA)
        if (sMatchesB && tMatchesA) reverseMatch = e
      }
    }

    return reverseMatch ? { edge: reverseMatch, forward: false } : null
  }

  const buildHopsFromChain = (chain: GraphNode[]) => {
    if (chain.length < 2 || !graphData?.edges) return []
    const hops: any[] = []

    for (let i = 0; i < chain.length - 1; i++) {
      const fromNode = chain[i]
      const toNode = chain[i + 1]
      const result = findConnectingEdge(fromNode, toNode)

      if (result) {
        const { edge } = result
        // Always display in chain order (fromNode→toNode), relation name as stored
        hops.push({
          from_node: fromNode.name,
          from_type: fromNode.type || 'Entity',
          from_id: fromNode.id,
          relation: edge.relation,
          to_node: toNode.name,
          to_type: toNode.type || 'Entity',
          to_id: toNode.id,
          evidence: edge.evidence || `Connection: ${fromNode.name} ➔ ${edge.relation} ➔ ${toNode.name}`,
          filename: edge.filename || 'Document',
          file_id: edge.file_id || '',
          page_number: edge.page_number,
          timestamp: edge.timestamp,
        })
      } else {
        hops.push({
          from_node: fromNode.name,
          from_type: fromNode.type || 'Entity',
          from_id: fromNode.id,
          relation: 'CONNECTED_TO',
          to_node: toNode.name,
          to_type: toNode.type || 'Entity',
          to_id: toNode.id,
          evidence: `Connection: ${fromNode.name} ➔ ${toNode.name}`,
          filename: 'Knowledge Graph',
          file_id: '',
        })
      }
    }
    return hops
  }

  const applyChain = (chain: GraphNode[]) => {
    const head = chain[0]
    const tail = chain[chain.length - 1]
    pathChainRef.current = chain  // Keep ref in sync for stale-closure safety
    setPathChain(chain)
    setSelectedNode(head)
    setSecondaryNode(chain.length > 1 ? tail : null)
    setEntityA(head.name)
    setEntityB(chain.length > 1 ? tail.name : '')
    if (chain.length > 1) {
      const hops = buildHopsFromChain(chain)
      setPathResult({
        is_multihop: true,
        query: `${head.name} to ${tail.name}`,
        detected_entities: chain.map((n) => n.name),
        paths: [hops],
        graph_context_text: `Path connecting ${chain.map((n) => n.name).join(' ➔ ')}`,
      })
    } else {
      setPathResult(null)
    }
  }

  const handleSelectNode = (hitNode: GraphNode | null) => {
    if (!hitNode) {
      handleClearPath()
      return
    }

    // Always read from ref to avoid stale closure issues
    const chain = pathChainRef.current

    if (chain.length === 0) {
      applyChain([hitNode])
      return
    }

    // 1. Rollback: clicked a node already in chain
    const existingIndex = chain.findIndex((n) => {
      if (n === hitNode) return true
      if (n.id && hitNode.id && n.id === hitNode.id) return true
      if (n.canonical_id && hitNode.canonical_id && n.canonical_id === hitNode.canonical_id) return true
      if (n.name && hitNode.name && n.name === hitNode.name) return true
      return isMatchingNode(hitNode.id, n) || isMatchingNode(hitNode.name, n)
    })
    if (existingIndex >= 0) {
      applyChain(chain.slice(0, existingIndex + 1))
      return
    }

    // 2. Try connecting hitNode to current tail
    const tailNode = chain[chain.length - 1]
    const tailResult = findConnectingEdge(tailNode, hitNode)
    if (tailResult) {
      if (!tailResult.forward) {
        // Reverse connection: hitNode is the true source, tailNode is the target.
        // Replace entire chain with [hitNode, tailNode] — 1 hop.
        applyChain([hitNode, tailNode])
      } else {
        // Forward: extend the chain
        applyChain([...chain, hitNode])
      }
      return
    }

    // 3. Try branching from earlier nodes — only forward connections
    for (let j = chain.length - 2; j >= 0; j--) {
      const branchResult = findConnectingEdge(chain[j], hitNode)
      if (branchResult && branchResult.forward) {
        applyChain([...chain.slice(0, j + 1), hitNode])
        return
      }
    }

    // 4. Completely unconnected -> start fresh
    applyChain([hitNode])
  }

  const handleManualTrace = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!entityA.trim() || !entityB.trim()) return

    setTracingPath(true)
    setError(null)
    try {
      const res = await traverseGraph(conversationId, '', entityA.trim(), entityB.trim())
      setPathResult(res)
    } catch (err: any) {
      setError(err.message || 'Path traversal failed.')
    } finally {
      setTracingPath(false)
    }
  }

  const handleClearPath = () => {
    setPathChain([])
    setEntityA('')
    setEntityB('')
    setPathResult(null)
    setSelectedNode(null)
    setSecondaryNode(null)
  }

  const getNodeColor = (type: string, name: string = '') => {
    const style = getNodeStyle(type, name)
    return { bg: style.bg, text: '#fff', border: style.border, icon: style.icon }
  }

  const selectedNodeEdges = React.useMemo(() => {
    if (!selectedNode || !graphData?.edges) return []
    const sName = selectedNode.name
    const sId = selectedNode.id
    return graphData.edges.filter(
      (e) => e.source === sName || e.target === sName || e.source === sId || e.target === sId
    )
  }, [selectedNode, graphData])

  const filteredNodes = React.useMemo(() => {
    if (!graphData?.nodes) return []
    const edges = graphData.edges || []

    return graphData.nodes.filter((n) => {
      // Exclude isolated / unconnected nodes with 0 edges
      const hasConnection =
        (n.degree !== undefined && n.degree > 0) ||
        edges.some(
          (e) =>
            e.source === n.id ||
            e.target === n.id ||
            e.source === n.name ||
            e.target === n.name
        )

      if (!hasConnection) return false

      return (
        n.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.type.toLowerCase().includes(searchQuery.toLowerCase())
      )
    })
  }, [graphData, searchQuery])

  const activeHighlightedHops = React.useMemo(() => {
    if (pathResult && pathResult.paths.length > 0) {
      return pathResult.paths[0]
    }
    return null
  }, [pathResult])

  const getNodeDisplayName = (nodeId: string) => {
    const found = graphData?.nodes.find((n) => n.id === nodeId || n.canonical_id === nodeId || n.name === nodeId)
    return found ? found.name : nodeId
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', width: '100%', maxWidth: '1600px', margin: '0 auto' }}>
      {/* Top Toolbar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: '0.85rem 1.25rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          {/* View Mode Switcher */}
          <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px', padding: '0.2rem', border: '1px solid var(--border-color)' }}>
            <button
              onClick={() => setViewMode('canvas')}
              style={{
                background: viewMode === 'canvas' ? '#3b82f6' : 'transparent',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '0.35rem 0.75rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              🌌 Interactive Canvas
            </button>
            <button
              onClick={() => setViewMode('list')}
              style={{
                background: viewMode === 'list' ? '#3b82f6' : 'transparent',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '0.35rem 0.75rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              📑 Structured List
            </button>
          </div>

          {/* Graph Stats Pills */}
          {graphData && (
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                ⚡ <strong style={{ color: 'var(--text-primary)' }}>{graphData.node_count}</strong> Entities
              </span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                🔗 <strong style={{ color: 'var(--text-primary)' }}>{graphData.edge_count}</strong> Relations
              </span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* Search Input */}
          <input
            type="text"
            placeholder="Search entities or types..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '0.4rem 0.75rem',
              fontSize: '0.82rem',
              color: 'var(--text-primary)',
              width: '220px',
              outline: 'none',
            }}
          />

          <button
            onClick={handleRebuild}
            disabled={rebuilding}
            className="btn btn-secondary"
            style={{ padding: '0.4rem 0.85rem', fontSize: '0.8rem', borderRadius: '8px' }}
          >
            {rebuilding ? 'Rebuilding...' : '🔄 Sync & Re-Extract'}
          </button>

          <button
            onClick={fetchGraph}
            disabled={loading}
            className="btn btn-primary"
            style={{ padding: '0.4rem 0.85rem', fontSize: '0.8rem', borderRadius: '8px' }}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Cross-File Multi-Hop Path Tracer Card */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(30, 27, 75, 0.5) 0%, rgba(15, 23, 42, 0.75) 100%)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(168, 85, 247, 0.35)',
          borderRadius: '14px',
          padding: '1.1rem 1.35rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.85rem',
          boxShadow: '0 8px 25px rgba(0, 0, 0, 0.35), 0 0 20px rgba(168, 85, 247, 0.14)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              🧭 Cross-File Multi-Hop Path Tracer
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              (Click any node on canvas for Start Entity, then click a connecting node to auto-trace)
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {activeHighlightedHops && (
              <span style={{ fontSize: '0.75rem', color: '#34d399', fontWeight: 700, background: 'rgba(16, 185, 129, 0.15)', padding: '0.2rem 0.6rem', borderRadius: '6px' }}>
                ✨ Path Illuminated on Canvas
              </span>
            )}
            {tracingPath && (
              <span style={{ fontSize: '0.75rem', color: '#93c5fd', fontWeight: 600, background: 'rgba(59, 130, 246, 0.15)', padding: '0.2rem 0.6rem', borderRadius: '6px' }}>
                🔄 Tracing path...
              </span>
            )}
            {(pathResult || entityA || entityB) && (
              <button
                type="button"
                onClick={handleClearPath}
                title="Stop tracing path and clear canvas illumination"
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#f87171',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  borderRadius: '6px',
                  padding: '0.2rem 0.6rem',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ✕ Stop Tracing
              </button>
            )}
          </div>
        </div>

        <form onSubmit={handleManualTrace} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Start Entity (click node on graph)"
            value={entityA}
            onChange={(e) => setEntityA(e.target.value)}
            style={{
              flex: 1,
              minWidth: '200px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '0.55rem 0.85rem',
              color: '#fff',
              fontSize: '0.85rem',
              outline: 'none',
            }}
          />

          <span style={{ color: '#38bdf8', fontWeight: 800, fontSize: '1rem' }}>➔</span>

          <input
            type="text"
            placeholder="Target Entity (click connecting node)"
            value={entityB}
            onChange={(e) => setEntityB(e.target.value)}
            style={{
              flex: 1,
              minWidth: '200px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '0.55rem 0.85rem',
              color: '#fff',
              fontSize: '0.85rem',
              outline: 'none',
            }}
          />
        </form>

        {/* Path Traversal Output */}
        {pathResult && (
          <div
            style={{
              background: '#090d18',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '10px',
              padding: '0.9rem 1.1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            {pathResult.is_multihop && pathResult.paths.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#34d399' }}>
                    ✅ Shortest Connecting Path ({pathResult.paths[0].length} Hops):
                  </span>
                  <button
                    type="button"
                    onClick={handleClearPath}
                    title="Close path view"
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      color: 'var(--text-muted)',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '0.2rem 0.5rem',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    ✕ Close
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                  {pathResult.paths[0].map((hop, hIdx) => {
                    const cFrom = getNodeColor(hop.from_type, hop.from_node)
                    const cTo = getNodeColor(hop.to_type, hop.to_node)
                    return (
                      <div
                        key={hIdx}
                        style={{
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: '1px solid rgba(56, 189, 248, 0.25)',
                          borderRadius: '8px',
                          padding: '0.65rem 0.9rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.3rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#38bdf8' }}>
                            Hop {hIdx + 1}:
                          </span>
                          <span style={{ background: cFrom.bg, color: cFrom.text, padding: '0.12rem 0.45rem', borderRadius: '5px', fontSize: '0.75rem', fontWeight: 600 }}>
                            {hop.from_node}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: '#93c5fd', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                            ➔ [{hop.relation}] ➔
                          </span>
                          <span style={{ background: cTo.bg, color: cTo.text, padding: '0.12rem 0.45rem', borderRadius: '5px', fontSize: '0.75rem', fontWeight: 600 }}>
                            {hop.to_node}
                          </span>

                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                            📁 {hop.filename} {hop.page_number ? `(Page ${hop.page_number})` : ''} {hop.timestamp ? `(⏱️ ${hop.timestamp})` : ''}
                          </span>
                        </div>

                        <div style={{ fontSize: '0.8rem', color: '#cbd5e1', lineHeight: '1.45', background: 'rgba(0,0,0,0.3)', padding: '0.45rem 0.65rem', borderRadius: '6px', margin: 0 }}>
                          {renderFormattedSnippet(hop.evidence)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {pathResult.graph_context_text || 'No connecting path found between these entities.'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Error Alert */}
      {error && (
        <div style={{ padding: '0.85rem 1.25rem', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '10px', color: '#fca5a5', fontSize: '0.9rem' }}>
          ⚠️ {error}
        </div>
      )}

      {/* VIEW MODE: 1. INTERACTIVE CANVAS (Default) */}
      {isGraphUpdating || rebuilding || (loading && !graphData) ? (
        <div
          style={{
            height: '620px',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'radial-gradient(ellipse at center, rgba(30, 58, 138, 0.25) 0%, #090d16 75%)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: '16px',
            padding: '3rem 2rem',
            textAlign: 'center',
            gap: '1.5rem',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          }}
        >
          <div style={{ position: 'relative', width: '80px', height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                border: '3px solid transparent',
                borderTopColor: '#38bdf8',
                borderBottomColor: '#818cf8',
                animation: 'spin 1.5s cubic-bezier(0.68, -0.55, 0.27, 1.55) infinite',
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: '8px',
                borderRadius: '50%',
                border: '2px dashed rgba(56, 189, 248, 0.4)',
                animation: 'spin 4s linear infinite reverse',
              }}
            />
            <span style={{ fontSize: '2.2rem' }}>🕸️</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '580px' }}>
            <h3 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#f8fafc', margin: 0, letterSpacing: '-0.01em' }}>
              Knowledge Graph update in progress...
            </h3>
            <p style={{ fontSize: '0.88rem', color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
              Extracting and syncing multimodal entities, relationships, and cross-file connections.
            </p>
          </div>

          {processingFiles.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center', maxWidth: '640px' }}>
              {processingFiles.map((fn) => (
                <span
                  key={fn}
                  style={{
                    fontSize: '0.78rem',
                    color: '#38bdf8',
                    background: 'rgba(56, 189, 248, 0.12)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    padding: '0.35rem 0.85rem',
                    borderRadius: '999px',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <span style={{ animation: 'spin 1.2s linear infinite', display: 'inline-block' }}>⏳</span>
                  {fn}
                </span>
              ))}
            </div>
          )}

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.78rem',
              color: '#64748b',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              padding: '0.4rem 1rem',
              borderRadius: '8px',
            }}
          >
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38bdf8', animation: 'pulse 1.5s infinite' }} />
            The interactive canvas will automatically render once graph synchronization completes.
          </div>
        </div>
      ) : viewMode === 'canvas' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {!graphData || graphData.nodes.length === 0 ? (
            <div
              style={{
                height: '560px',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'radial-gradient(ellipse at center, rgba(30, 41, 59, 0.4) 0%, #090d16 80%)',
                border: '1px solid var(--border-color)',
                borderRadius: '16px',
                gap: '1.2rem',
                color: 'var(--text-muted)',
                padding: '2.5rem 2rem',
                textAlign: 'center',
                boxShadow: 'inset 0 0 40px rgba(0, 0, 0, 0.4)',
              }}
            >
              <div
                style={{
                  width: '68px',
                  height: '68px',
                  borderRadius: '20px',
                  background: 'rgba(56, 189, 248, 0.08)',
                  border: '1px solid rgba(56, 189, 248, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '2.2rem',
                }}
              >
                🕸️
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', maxWidth: '480px' }}>
                <span style={{ fontSize: '1.1rem', color: '#f8fafc', fontWeight: 700, letterSpacing: '-0.01em' }}>
                  No Knowledge Graph Entities Yet
                </span>
                <span style={{ fontSize: '0.88rem', color: '#94a3b8', lineHeight: 1.55 }}>
                  Upload documents, PDFs, images, audio, or video files in the <strong>Files & Ingest</strong> tab to automatically extract entities, cross-file relations, and interactive graph networks.
                </span>
              </div>
            </div>
          ) : (
            <InteractiveGraphCanvas
              nodes={filteredNodes}
              edges={graphData?.edges || []}
              selectedNode={selectedNode}
              secondaryNode={secondaryNode}
              pathChain={pathChain}
              highlightedPath={activeHighlightedHops}
              activeCategoryFilter={null}
              searchQuery={searchQuery}
              onSelectNode={handleSelectNode}
            />
          )}
        </div>
      ) : (
        /* VIEW MODE: 2. STRUCTURED LIST VIEW */
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '1.25rem', minHeight: '400px' }}>
          {/* Left Column: Entity Nodes Explorer */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Entity Nodes ({filteredNodes.length})
            </span>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', maxHeight: '450px', overflowY: 'auto' }}>
              {filteredNodes.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '1rem', textAlign: 'center', width: '100%' }}>
                  {loading ? 'Extracting entities...' : 'No entities found.'}
                </div>
              ) : (
                filteredNodes.map((node) => {
                  const c = getNodeColor(node.type, node.name)
                  const isSelected = selectedNode?.name === node.name
                  return (
                    <button
                      key={node.id}
                      onClick={() => setSelectedNode(node)}
                      style={{
                        background: isSelected ? c.bg : 'rgba(255, 255, 255, 0.04)',
                        color: isSelected ? c.text : 'var(--text-primary)',
                        border: `1px solid ${isSelected ? c.border : 'var(--border-color)'}`,
                        borderRadius: '8px',
                        padding: '0.4rem 0.75rem',
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span style={{ fontSize: '0.65rem', opacity: 0.8, textTransform: 'uppercase', background: 'rgba(0,0,0,0.3)', padding: '0.1rem 0.35rem', borderRadius: '4px' }}>
                        {node.type}
                      </span>
                      <span style={{ fontWeight: 600 }}>{node.name}</span>
                      <span style={{ fontSize: '0.7rem', color: isSelected ? '#fff' : 'var(--text-muted)', opacity: 0.7 }}>
                        ({node.degree})
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {/* Right Column: Node Relationships & Citations Inspector */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {selectedNode ? `Relationships for "${selectedNode.name}"` : 'Select an Entity Node to Inspect Relations'}
            </span>

            {selectedNode ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', maxHeight: '450px', overflowY: 'auto' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      background: getNodeColor(selectedNode.type, selectedNode.name).bg,
                      color: '#fff',
                      padding: '0.2rem 0.6rem',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                    }}
                  >
                    {selectedNode.type}
                  </span>
                  {(() => {
                    const rawName = selectedNode.canonical_id || selectedNode.name
                    const canonId = rawName.startsWith('ENTITY_')
                      ? rawName
                      : `ENTITY_${rawName.replace(/[\s\-_/\\|:,\.]+/g, '_').replace(/[^\w]/g, '').toUpperCase()}`
                    return (
                      <span
                        style={{
                          background: 'rgba(56, 189, 248, 0.12)',
                          color: '#38bdf8',
                          border: '1px solid rgba(56, 189, 248, 0.3)',
                          borderRadius: '6px',
                          padding: '0.2rem 0.5rem',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          fontFamily: 'var(--font-mono)',
                        }}
                        title="Canonical Entity Node ID"
                      >
                        🔑 {canonId}
                      </span>
                    )
                  })()}
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Connected to {selectedNodeEdges.length} relation(s)
                  </span>
                  <button
                    onClick={() => setEntityA(selectedNode.name)}
                    style={{
                      marginLeft: 'auto',
                      background: 'rgba(99, 102, 241, 0.2)',
                      color: '#93c5fd',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                      borderRadius: '6px',
                      padding: '0.2rem 0.6rem',
                      fontSize: '0.72rem',
                      cursor: 'pointer',
                    }}
                  >
                    Set as Start Entity
                  </button>
                </div>

                {selectedNodeEdges.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>No direct edges recorded.</div>
                ) : (
                  selectedNodeEdges.map((edge) => (
                    <div
                      key={edge.id}
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        padding: '0.85rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.4rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                          {getNodeDisplayName(edge.source)}
                        </span>
                        <span style={{ color: '#60a5fa', fontSize: '0.75rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                          ➔ [{edge.relation}] ➔
                        </span>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                          {getNodeDisplayName(edge.target)}
                        </span>

                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                          📁 {edge.filename} {edge.page_number ? `(Page ${edge.page_number})` : ''} {edge.timestamp ? `(⏱️ ${edge.timestamp})` : ''}
                        </span>
                      </div>

                      <div style={{ fontSize: '0.8rem', color: '#cbd5e1', lineHeight: '1.45', background: '#090d18', padding: '0.5rem 0.75rem', borderRadius: '6px', margin: 0 }}>
                        {renderFormattedSnippet(edge.evidence)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '3rem' }}>
                Click any entity chip on the left to inspect its multi-modal facts, connecting relations, and document citations.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
