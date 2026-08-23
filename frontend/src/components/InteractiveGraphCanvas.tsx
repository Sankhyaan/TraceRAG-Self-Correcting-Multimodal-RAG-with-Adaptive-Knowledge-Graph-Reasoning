import React, { useRef, useEffect, useState, useCallback } from 'react'
import { GraphNode, GraphEdge, GraphPathHop } from '../api/graphApi'

interface InteractiveGraphCanvasProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedNode: GraphNode | null
  secondaryNode?: GraphNode | null
  pathChain?: GraphNode[]
  highlightedPath?: GraphPathHop[] | null
  activeCategoryFilter: string | null
  searchQuery: string
  onSelectNode: (node: GraphNode | null) => void
  onSetStartEntity?: (name: string) => void
  onSetTargetEntity?: (name: string) => void
}

interface SimNode extends GraphNode {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  color: string
  borderColor: string
  isPinned?: boolean
}

interface SimEdge {
  sourceName: string
  targetName: string
  relation: string
  edge: GraphEdge
  isHighlighted: boolean
}

export const getNodeStyle = (type: string = '', name: string = '') => {
  const text = (name || type || 'entity').trim().toLowerCase()

  // 1. High-Entropy Universal String Hash (DJB2)
  let hash = 5381
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) + text.charCodeAt(i)
    hash |= 0
  }
  const absHash = Math.abs(hash)

  // 2. Golden Ratio Hue (0° - 360°) for perfectly even, vibrant color spread
  const goldenRatio = 0.618033988749895
  const hue = Math.round(((absHash * goldenRatio) % 1) * 360)

  // 3. High Saturation & Luminous Lightness for crystalline electric UI
  const saturation = 90 + (absHash % 10) // 90% to 100%
  const lightness = 62 + (absHash % 12)  // 62% to 74%
  const borderLightness = Math.min(90, lightness + 15)

  const bg = `hsl(${hue}, ${saturation}%, ${lightness}%)`
  const border = `hsl(${hue}, ${saturation}%, ${borderLightness}%)`

  return {
    bg,
    border,
    label: type || 'Entity',
    icon: '●',
  }
}

export const isMatchingNode = (nodeNameOrId: string, node: GraphNode | null | undefined): boolean => {
  if (!node) return false
  return Boolean(
    nodeNameOrId === node.name ||
    nodeNameOrId === node.id ||
    nodeNameOrId === node.canonical_id ||
    (node.aliases && node.aliases.includes(nodeNameOrId))
  )
}

export const InteractiveGraphCanvas: React.FC<InteractiveGraphCanvasProps> = ({
  nodes,
  edges,
  selectedNode,
  secondaryNode,
  pathChain,
  highlightedPath,
  activeCategoryFilter,
  searchQuery,
  onSelectNode,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Synchronized state & refs for zero-lag pan and zoom (Defaulting to zoomed-out galaxy view)
  const [, setZoomState] = useState(0.33)
  const [, setPanState] = useState({ x: 500, y: 300 })
  const zoomRef = useRef(0.33)
  const panRef = useRef({ x: 500, y: 300 })

  const setZoom = useCallback((updater: number | ((prev: number) => number)) => {
    setZoomState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      zoomRef.current = next
      return next
    })
  }, [])

  const setPan = useCallback((updater: { x: number; y: number } | ((prev: { x: number; y: number }) => { x: number; y: number })) => {
    setPanState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      panRef.current = next
      return next
    })
  }, [])

  const [isPhysicsRunning, setIsPhysicsRunning] = useState(true)
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null)

  // Simulation state refs
  const simNodesRef = useRef<Map<string, SimNode>>(new Map())
  const simEdgesRef = useRef<SimEdge[]>([])
  const draggedNodeRef = useRef<SimNode | null>(null)
  const isDraggingNodeRef = useRef(false)
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ x: 0, y: 0 })
  const mouseDownPosRef = useRef({ x: 0, y: 0 })
  const animFrameIdRef = useRef<number | null>(null)
  const particleOffsetRef = useRef(0)

  // Directional Pan helper
  const panBy = useCallback((dx: number, dy: number) => {
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }))
  }, [setPan])

  // Center & Fit View (Zoomed-out comprehensive overview centered in viewport)
  const fitToView = useCallback(() => {
    if (simNodesRef.current.size === 0) return
    const width = containerRef.current?.clientWidth || 1000
    const height = containerRef.current?.clientHeight || 600
    if (width <= 50 || height <= 50) return

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity
    simNodesRef.current.forEach((n) => {
      if (n.x < minX) minX = n.x
      if (n.x > maxX) maxX = n.x
      if (n.y < minY) minY = n.y
      if (n.y > maxY) maxY = n.y
    })

    const graphW = Math.max(120, maxX - minX + 160)
    const graphH = Math.max(120, maxY - minY + 160)
    const graphCenterX = (minX + maxX) / 2
    const graphCenterY = (minY + maxY) / 2

    const scaleX = (width - 60) / graphW
    const scaleY = (height - 60) / graphH
    const newZoom = Math.max(0.18, Math.min(0.55, Math.min(scaleX, scaleY)))

    setZoom(newZoom)
    setPan({
      x: width / 2 - graphCenterX * newZoom,
      y: height / 2 - graphCenterY * newZoom,
    })
  }, [setZoom, setPan])

  // Zoom centered on the viewport middle (for UI button controls)
  const zoomAroundCenter = useCallback((factor: number) => {
    const width = containerRef.current?.clientWidth || 1000
    const height = containerRef.current?.clientHeight || 600
    const cx = width / 2
    const cy = height / 2

    const prevZoom = zoomRef.current
    const newZoom = Math.max(0.12, Math.min(4.0, prevZoom * factor))
    if (newZoom !== prevZoom) {
      const currentPan = panRef.current
      const newPanX = cx - (cx - currentPan.x) * (newZoom / prevZoom)
      const newPanY = cy - (cy - currentPan.y) * (newZoom / prevZoom)

      panRef.current = { x: newPanX, y: newPanY }
      zoomRef.current = newZoom
      setZoomState(newZoom)
      setPanState({ x: newPanX, y: newPanY })
    }
  }, [])

  // Initialize or update simulation nodes & edges centered at (0, 0)
  useEffect(() => {
    const nodeMap = simNodesRef.current

    // Remove nodes that no longer exist
    const activeKeys = new Set(nodes.map((n) => n.id || n.name))
    for (const key of Array.from(nodeMap.keys())) {
      if (!activeKeys.has(key)) {
        nodeMap.delete(key)
      }
    }

    // Sort nodes by degree descending so central hub entity sits right at the spiral core (i=0)
    const sortedNodes = [...nodes].sort((a, b) => (b.degree || 0) - (a.degree || 0))
    const goldenAngle = 2.39996323 // Fermat's golden ratio spiral angle: Math.PI * (3 - Math.sqrt(5))
    const cx = 0
    const cy = 0
    const rSpacing = Math.max(75, Math.min(135, 750 / Math.sqrt(sortedNodes.length || 1)))

    // Place active nodes in pristine Fermat golden spiral formation around (0, 0)
    sortedNodes.forEach((n, idx) => {
      const style = getNodeStyle(n.type, n.name)
      const radius = Math.max(20, Math.min(36, 20 + (n.degree || 1) * 2.5))
      const key = n.id || n.name

      const angle = idx * goldenAngle
      const r = idx === 0 ? 0 : rSpacing * Math.sqrt(idx)

      const existing = nodeMap.get(key)
      if (existing) {
        existing.name = n.name
        existing.canonical_id = n.canonical_id
        existing.aliases = n.aliases
        existing.type = n.type
        existing.degree = n.degree
        existing.file_ids = n.file_ids
        existing.radius = radius
        existing.color = style.bg
        existing.borderColor = style.border
      } else {
        nodeMap.set(key, {
          ...n,
          x: cx + Math.cos(angle) * r,
          y: cy + Math.sin(angle) * r,
          vx: 0,
          vy: 0,
          radius,
          color: style.bg,
          borderColor: style.border,
        })
      }
    })

    // Build SimEdges with node id keys
    const simEdges: SimEdge[] = []
    edges.forEach((e) => {
      let isHighlighted = false
      if (highlightedPath && highlightedPath.length > 0) {
        isHighlighted = highlightedPath.some(
          (p) =>
            (p.from_id === e.source && p.to_id === e.target) ||
            (p.from_id === e.target && p.to_id === e.source) ||
            (p.from_node === e.source && p.to_node === e.target) ||
            (p.from_node === e.target && p.to_node === e.source)
        )
      }

      simEdges.push({
        sourceName: e.source,
        targetName: e.target,
        relation: e.relation,
        edge: e,
        isHighlighted,
      })
    })
    simEdgesRef.current = simEdges
  }, [nodes, edges, highlightedPath])

  // Auto fit and center whenever container mounts, resizes, or tab becomes visible
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    fitToView()

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 50) {
          fitToView()
        }
      }
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [fitToView, nodes.length])

  // Isolated Native Non-Passive Wheel Event Listener (Smooth 2-finger trackpad panning & continuous pinch-to-zoom)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      // 1. PINCH-TO-ZOOM: Expanding 2 fingers apart (Zoom In) or Pinching 2 fingers together (Zoom Out)
      // Browsers fire wheel with ctrlKey=true on trackpad pinch gestures or Ctrl+Wheel
      if (e.ctrlKey) {
        // Continuous smooth exponential zoom proportional to finger pinch speed
        const zoomFactor = Math.pow(0.993, e.deltaY)
        const prevZoom = zoomRef.current
        const newZoom = Math.max(0.12, Math.min(4.5, prevZoom * zoomFactor))

        if (newZoom !== prevZoom) {
          const scaleRatio = newZoom / prevZoom
          const newPanX = mouseX - (mouseX - panRef.current.x) * scaleRatio
          const newPanY = mouseY - (mouseY - panRef.current.y) * scaleRatio

          panRef.current = { x: newPanX, y: newPanY }
          zoomRef.current = newZoom
          setZoomState(newZoom)
          setPanState({ x: newPanX, y: newPanY })
        }
        return
      }

      // 2. TWO-FINGER TRACKPAD SWIPE / PAN: Moving 2 fingers Up, Down, Left, or Right smoothly pans the canvas
      let deltaX = e.deltaX
      let deltaY = e.deltaY

      // Normalize line/page delta modes if present
      if (e.deltaMode === 1) {
        deltaX *= 18
        deltaY *= 18
      } else if (e.deltaMode === 2) {
        deltaX *= 80
        deltaY *= 80
      }

      if (e.shiftKey && !deltaX) {
        deltaX = deltaY
        deltaY = 0
      }

      const nextPanX = panRef.current.x - deltaX
      const nextPanY = panRef.current.y - deltaY

      panRef.current = { x: nextPanX, y: nextPanY }
      setPanState({ x: nextPanX, y: nextPanY })
    }

    canvas.addEventListener('wheel', handleNativeWheel, { passive: false })
    return () => {
      canvas.removeEventListener('wheel', handleNativeWheel)
    }
  }, [])

  // Main Canvas Render & Smooth Physics Loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let isRunning = true

    const stepPhysics = () => {
      if (!isPhysicsRunning) return

      const simNodes = Array.from(simNodesRef.current.values())

      // 1. Slow Ambient Spiral Galaxy Rotation (Smooth celestial revolving motion around 0, 0)
      if (!isDraggingNodeRef.current && !hoveredNode && !selectedNode) {
        const dTheta = 0.0012 // Smooth continuous cosmic revolving motion
        simNodes.forEach((n) => {
          if (n.isPinned || draggedNodeRef.current === n) return
          const dx = n.x
          const dy = n.y
          const r = Math.sqrt(dx * dx + dy * dy)
          if (r < 5) return
          const currAngle = Math.atan2(dy, dx)
          const nextAngle = currAngle + dTheta
          n.x = Math.cos(nextAngle) * r
          n.y = Math.sin(nextAngle) * r
        })
      }

      // 2. Local Anti-Collision & Repulsion (Prevents any node overlap while keeping the galaxy wide & spread out)
      for (let i = 0; i < simNodes.length; i++) {
        const n1 = simNodes[i]
        if (draggedNodeRef.current === n1 || n1.isPinned) continue
        for (let j = i + 1; j < simNodes.length; j++) {
          const n2 = simNodes[j]
          if (draggedNodeRef.current === n2 || n2.isPinned) continue

          const dx = n2.x - n1.x
          const dy = n2.y - n1.y
          const dist = Math.max(0.1, Math.sqrt(dx * dx + dy * dy))

          // Anti-Collision clearance
          const minDistance = n1.radius + n2.radius + 140
          if (dist < minDistance) {
            const overlap = minDistance - dist
            const push = (overlap / dist) * 0.35
            const fx = dx * push
            const fy = dy * push
            n1.vx -= fx
            n1.vy -= fy
            n2.vx += fx
            n2.vy += fy
          }
        }
      }

      // 3. Smooth Damping & Velocity Integration (Zero inward spring contraction — galaxy stays permanently spread out!)
      simNodes.forEach((n) => {
        if (draggedNodeRef.current === n || n.isPinned) {
          n.vx = 0
          n.vy = 0
          return // User placed node stays permanently at its exact position
        }

        // Smooth friction damping
        n.vx *= 0.80
        n.vy *= 0.80

        // Sleep threshold: lock in place once settled
        if (Math.abs(n.vx) < 0.01) n.vx = 0
        if (Math.abs(n.vy) < 0.01) n.vy = 0

        // Cap speed
        const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy)
        if (speed > 4) {
          n.vx = (n.vx / speed) * 4
          n.vy = (n.vy / speed) * 4
        }

        n.x += n.vx
        n.y += n.vy
      })
    }

    const render = () => {
      if (!canvas || !ctx) return

      const dpr = window.devicePixelRatio || 1
      const width = canvas.clientWidth
      const height = canvas.clientHeight

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr
        canvas.height = height * dpr
      }

      // Reset canvas matrix cleanly with DPR
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)

      // Background Grid Effect
      ctx.fillStyle = '#090d16'
      ctx.fillRect(0, 0, width, height)

      // Subtle Grid Dots (World-aligned)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)'
      const gridSize = 32 * zoomRef.current
      const offsetX = panRef.current.x % gridSize
      const offsetY = panRef.current.y % gridSize
      for (let x = offsetX; x < width; x += gridSize) {
        for (let y = offsetY; y < height; y += gridSize) {
          ctx.beginPath()
          ctx.arc(x, y, 1, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // Apply Pan & Zoom Matrix for all nodes and edges
      ctx.setTransform(
        dpr * zoomRef.current,
        0,
        0,
        dpr * zoomRef.current,
        dpr * panRef.current.x,
        dpr * panRef.current.y
      )

      const simNodes = Array.from(simNodesRef.current.values())
      const simEdges = simEdgesRef.current
      // Collect all node IDs/names in the active multi-hop path chain
      const pathNodeNames = new Set<string>()
      if (pathChain && pathChain.length > 0) {
        pathChain.forEach((n) => {
          pathNodeNames.add(n.name)
          if (n.id) pathNodeNames.add(n.id)
          if (n.canonical_id) pathNodeNames.add(n.canonical_id)
        })
      }
      if (highlightedPath && highlightedPath.length > 0) {
        highlightedPath.forEach((p) => {
          pathNodeNames.add(p.from_node)
          pathNodeNames.add(p.to_node)
          if (p.from_id) pathNodeNames.add(p.from_id)
          if (p.to_id) pathNodeNames.add(p.to_id)
        })
      }
      if (selectedNode) {
        pathNodeNames.add(selectedNode.name)
        if (selectedNode.id) pathNodeNames.add(selectedNode.id)
        if (selectedNode.canonical_id) pathNodeNames.add(selectedNode.canonical_id)
      }
      if (secondaryNode) {
        pathNodeNames.add(secondaryNode.name)
        if (secondaryNode.id) pathNodeNames.add(secondaryNode.id)
        if (secondaryNode.canonical_id) pathNodeNames.add(secondaryNode.canonical_id)
      }

      const hasActivePath = Boolean(
        (pathChain && pathChain.length > 1) ||
        (highlightedPath && highlightedPath.length > 0) ||
        (selectedNode && secondaryNode)
      )

      // Hovered Node Neighbors Set (Enlightens all adjacent connected nodes when hovering on any node)
      const hoveredNeighbors = new Set<string>()
      if (hoveredNode) {
        hoveredNeighbors.add(hoveredNode.name)
        if (hoveredNode.id) hoveredNeighbors.add(hoveredNode.id)
        if (hoveredNode.canonical_id) hoveredNeighbors.add(hoveredNode.canonical_id)

        simEdges.forEach(({ sourceName, targetName }) => {
          if (isMatchingNode(sourceName, hoveredNode)) {
            hoveredNeighbors.add(targetName)
            const tNode = simNodesRef.current.get(targetName)
            if (tNode) {
              hoveredNeighbors.add(tNode.name)
              if (tNode.id) hoveredNeighbors.add(tNode.id)
            }
          }
          if (isMatchingNode(targetName, hoveredNode)) {
            hoveredNeighbors.add(sourceName)
            const sNode = simNodesRef.current.get(sourceName)
            if (sNode) {
              hoveredNeighbors.add(sNode.name)
              if (sNode.id) hoveredNeighbors.add(sNode.id)
            }
          }
        })
      }

      // Highlighted Node Neighbors Set (for single node inspection)
      const connectedNeighbors = new Set<string>()
      const isPairActive = Boolean(selectedNode && secondaryNode)

      if (selectedNode && !hasActivePath) {
        connectedNeighbors.add(selectedNode.name)
        connectedNeighbors.add(selectedNode.id)
        if (selectedNode.canonical_id) connectedNeighbors.add(selectedNode.canonical_id)

        simEdges.forEach(({ sourceName, targetName }) => {
          if (isMatchingNode(sourceName, selectedNode)) {
            connectedNeighbors.add(targetName)
            const tNode = simNodesRef.current.get(targetName)
            if (tNode) {
              connectedNeighbors.add(tNode.name)
              if (tNode.id) connectedNeighbors.add(tNode.id)
            }
          }
          if (isMatchingNode(targetName, selectedNode)) {
            connectedNeighbors.add(sourceName)
            const sNode = simNodesRef.current.get(sourceName)
            if (sNode) {
              connectedNeighbors.add(sNode.name)
              if (sNode.id) connectedNeighbors.add(sNode.id)
            }
          }
        })
      }

      // Update particle animation offset
      particleOffsetRef.current = (particleOffsetRef.current + 0.015) % 1

      // 1. Draw Edges
      simEdges.forEach(({ sourceName, targetName, relation, isHighlighted }) => {
        const source = simNodesRef.current.get(sourceName)
        const target = simNodesRef.current.get(targetName)
        if (!source || !target) return

        let isEdgeInPath = isHighlighted
        if (!isEdgeInPath && isPairActive && selectedNode && secondaryNode) {
          isEdgeInPath =
            (isMatchingNode(sourceName, selectedNode) && isMatchingNode(targetName, secondaryNode)) ||
            (isMatchingNode(sourceName, secondaryNode) && isMatchingNode(targetName, selectedNode))
        }

        let isEdgeActive = isEdgeInPath
        if (!isEdgeActive && selectedNode && !hasActivePath) {
          isEdgeActive = isMatchingNode(sourceName, selectedNode) || isMatchingNode(targetName, selectedNode)
        }

        const isHoveredEdge = Boolean(
          hoveredNode && (isMatchingNode(sourceName, hoveredNode) || isMatchingNode(targetName, hoveredNode))
        )

        const isFiltered = (hasActivePath || selectedNode) && !isEdgeInPath && !isEdgeActive && !isHoveredEdge
        const z = zoomRef.current

          // Calculate line angle and length
          const dx = target.x - source.x
          const dy = target.y - source.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 1) return
          const theta = Math.atan2(dy, dx)

          // 1. Draw Connecting Line
          ctx.save()
          ctx.beginPath()
          ctx.moveTo(source.x, source.y)
          ctx.lineTo(target.x, target.y)

          if (isEdgeInPath) {
            ctx.strokeStyle = '#38bdf8'
            ctx.lineWidth = Math.max(3.2, 4.0 / Math.sqrt(z))
            ctx.shadowColor = '#38bdf8'
            ctx.shadowBlur = isHoveredEdge ? 24 : 16
          } else if (isHoveredEdge) {
            ctx.strokeStyle = '#60a5fa'
            ctx.lineWidth = Math.max(2.4, 3.2 / Math.sqrt(z))
            ctx.shadowColor = '#60a5fa'
            ctx.shadowBlur = 14
          } else if (!hasActivePath && isEdgeActive) {
            ctx.strokeStyle = '#60a5fa'
            ctx.lineWidth = Math.max(2.4, 3.0 / Math.sqrt(z))
            ctx.shadowColor = '#60a5fa'
            ctx.shadowBlur = 10
          } else {
            ctx.strokeStyle = isFiltered
              ? (hasActivePath ? 'rgba(148, 163, 184, 0.02)' : 'rgba(148, 163, 184, 0.05)')
              : 'rgba(148, 163, 184, 0.35)'
            ctx.lineWidth = Math.max(1.0, 1.4 / Math.sqrt(z))
          }
          ctx.stroke()
          ctx.restore()

          // 2. Draw Target Directional Arrowhead
          const shouldShowArrowhead = isEdgeInPath || isHoveredEdge || (!hasActivePath && !isFiltered)
          if (shouldShowArrowhead) {
            const arrowLen = isEdgeInPath ? 15 : isHoveredEdge ? 13 : 10
            const arrowWidth = isEdgeInPath ? 8 : isHoveredEdge ? 7 : 5
            const tx = target.x - Math.cos(theta) * (target.radius + 3)
            const ty = target.y - Math.sin(theta) * (target.radius + 3)

            ctx.save()
            ctx.fillStyle = isEdgeInPath
              ? '#38bdf8'
              : isHoveredEdge
              ? '#60a5fa'
              : 'rgba(148, 163, 184, 0.65)'
            if (isEdgeInPath || isHoveredEdge) {
              ctx.shadowColor = isEdgeInPath ? '#38bdf8' : '#60a5fa'
              ctx.shadowBlur = 10
            }
            ctx.beginPath()
            ctx.moveTo(tx, ty)
            ctx.lineTo(
              tx - arrowLen * Math.cos(theta) + arrowWidth * Math.sin(theta),
              ty - arrowLen * Math.sin(theta) - arrowWidth * Math.cos(theta)
            )
            ctx.lineTo(
              tx - (arrowLen * 0.7) * Math.cos(theta),
              ty - (arrowLen * 0.7) * Math.sin(theta)
            )
            ctx.lineTo(
              tx - arrowLen * Math.cos(theta) - arrowWidth * Math.sin(theta),
              ty - arrowLen * Math.sin(theta) + arrowWidth * Math.cos(theta)
            )
            ctx.closePath()
            ctx.fill()
            ctx.restore()
          }

          // 3. Animated Travelling Direction Arrows
          if (isEdgeInPath || isHoveredEdge || (!hasActivePath && isEdgeActive)) {
            const travelOffsets = [particleOffsetRef.current, (particleOffsetRef.current + 0.5) % 1]

            travelOffsets.forEach((tOffset) => {
              const px = source.x + dx * tOffset
              const py = source.y + dy * tOffset
              const chevSize = isEdgeInPath ? 9.5 : 7.5

              ctx.save()
              ctx.translate(px, py)
              ctx.rotate(theta)

              // Outer Neon Glow Dot
              ctx.beginPath()
              ctx.arc(0, 0, isEdgeInPath ? 4.5 : 3.5, 0, Math.PI * 2)
              ctx.fillStyle = isEdgeInPath ? '#38bdf8' : '#93c5fd'
              ctx.shadowColor = '#38bdf8'
              ctx.shadowBlur = 12
              ctx.fill()

              // Direction Travelling Chevron Arrowhead (>)
              ctx.beginPath()
              ctx.moveTo(-chevSize, -chevSize * 0.65)
              ctx.lineTo(chevSize * 0.4, 0)
              ctx.lineTo(-chevSize, chevSize * 0.65)
              ctx.strokeStyle = '#ffffff'
              ctx.lineWidth = 2.2
              ctx.lineCap = 'round'
              ctx.lineJoin = 'round'
              ctx.shadowColor = '#38bdf8'
              ctx.shadowBlur = 8
              ctx.stroke()

              ctx.restore()
            })
          }

          // 4. Draw Relation Label with Direction Indicator
          const shouldShowEdgeLabel = isEdgeInPath || isHoveredEdge || (!hasActivePath && (z >= 0.55 && !isFiltered))
          if (shouldShowEdgeLabel) {
            const midX = (source.x + target.x) / 2
            const midY = (source.y + target.y) / 2

            ctx.save()
            const fontSize = Math.max(9, Math.round((isEdgeInPath ? 12 : 10) / Math.sqrt(z)))
            ctx.font = `bold ${fontSize}px Inter, sans-serif`
            const labelText = `➔ ${relation.replace(/_/g, ' ')}`
            const textW = ctx.measureText(labelText).width
            const padX = 7 / Math.sqrt(z)
            const padY = 4 / Math.sqrt(z)
            const badgeH = fontSize + padY * 2
            const radius = 6 / Math.sqrt(z)

            ctx.fillStyle = isEdgeInPath
              ? 'rgba(14, 165, 233, 0.95)'
              : isHoveredEdge
              ? 'rgba(37, 99, 235, 0.95)'
              : 'rgba(15, 23, 42, 0.92)'
            ctx.beginPath()
            ctx.roundRect(midX - textW / 2 - padX, midY - badgeH / 2, textW + padX * 2, badgeH, radius)
            ctx.fill()

            ctx.strokeStyle = isEdgeInPath
              ? '#38bdf8'
              : isHoveredEdge
              ? '#60a5fa'
              : 'rgba(255,255,255,0.35)'
            ctx.lineWidth = 1.4 / Math.sqrt(z)
            ctx.stroke()

            ctx.fillStyle = '#ffffff'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(labelText, midX, midY)
            ctx.restore()
          }
        })

        // 2. Draw Nodes
        simNodes.forEach((node) => {
          const isPartOfActivePath =
            pathNodeNames.has(node.name) ||
            pathNodeNames.has(node.id) ||
            (node.canonical_id && pathNodeNames.has(node.canonical_id))

          const isPartOfHovered = Boolean(
            hoveredNode &&
            (isMatchingNode(node.id, hoveredNode) ||
             isMatchingNode(node.name, hoveredNode) ||
             hoveredNeighbors.has(node.name) ||
             hoveredNeighbors.has(node.id) ||
             (node.canonical_id && hoveredNeighbors.has(node.canonical_id)))
          )

          const isPrimarySelected = isMatchingNode(node.id, selectedNode) || isMatchingNode(node.name, selectedNode)
          const isSecondarySelected = isMatchingNode(node.id, secondaryNode) || isMatchingNode(node.name, secondaryNode)
          const isSelected = isPrimarySelected || isSecondarySelected || isPartOfActivePath
          const isHovered = isMatchingNode(node.id, hoveredNode) || isMatchingNode(node.name, hoveredNode)
          const isNeighbor =
            connectedNeighbors.has(node.name) ||
            connectedNeighbors.has(node.id) ||
            (node.canonical_id && connectedNeighbors.has(node.canonical_id))
          const isSearchMatch =
            searchQuery.trim().length > 0 &&
            (node.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              node.type.toLowerCase().includes(searchQuery.toLowerCase()))

          const isFilteredOut = hasActivePath
            ? (!isPartOfActivePath && !isPartOfHovered)
            : (selectedNode ? (!isNeighbor && !isSelected && !isPartOfHovered) : false)

          ctx.save()

          // Set opacity: full opacity for path nodes & hovered adjacent neighbors
          ctx.globalAlpha = isFilteredOut ? 0.04 : 1.0

          // Outer Glow for Selected / Path Nodes / Search Match / Hovered Adjacent Neighbors
          if (isSelected || isPartOfActivePath) {
            ctx.beginPath()
            ctx.arc(node.x, node.y, node.radius + 8, 0, Math.PI * 2)
            ctx.fillStyle = 'rgba(56, 189, 248, 0.45)'
            ctx.fill()
          } else if (isPartOfHovered) {
            ctx.beginPath()
            ctx.arc(node.x, node.y, node.radius + 6, 0, Math.PI * 2)
            ctx.fillStyle = 'rgba(96, 165, 250, 0.35)'
            ctx.fill()
          } else if (isSearchMatch || isHovered) {
            ctx.beginPath()
            ctx.arc(node.x, node.y, node.radius + 8, 0, Math.PI * 2)
            ctx.fillStyle = isSearchMatch ? 'rgba(251, 191, 36, 0.4)' : 'rgba(255, 255, 255, 0.25)'
            ctx.fill()
          } else if (isNeighbor && !hasActivePath) {
            ctx.beginPath()
            ctx.arc(node.x, node.y, node.radius + 5, 0, Math.PI * 2)
            ctx.fillStyle = 'rgba(96, 165, 250, 0.25)'
            ctx.fill()
          }

          // Node Circle - Always use vibrant node.color!
          ctx.beginPath()
          ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2)
          ctx.fillStyle = node.color
          ctx.fill()

          ctx.lineWidth = isSelected || isPartOfActivePath ? 3.5 : isPartOfHovered ? 2.5 : 1.5
          ctx.strokeStyle = isSelected || isPartOfActivePath ? '#ffffff' : isPartOfHovered ? '#93c5fd' : node.borderColor
          ctx.stroke()

          // Sleek Inner Dot
          ctx.beginPath()
          ctx.arc(node.x, node.y, Math.max(3.5, node.radius * 0.32), 0, Math.PI * 2)
          ctx.fillStyle = '#ffffff'
          ctx.fill()

          // Node Name Label: Show for path nodes, hovered adjacent neighbors, and search matches!
          const shouldShowNodeLabel =
            isPartOfActivePath ||
            isPartOfHovered ||
            (!hasActivePath && (isSelected || isNeighbor || isSearchMatch || (zoomRef.current >= 0.32 && !isFilteredOut)))

          if (shouldShowNodeLabel) {
            const z = zoomRef.current
            const isKeyNode = isSelected || isPartOfActivePath
            const nodeFontSize = Math.max(8, Math.round((isKeyNode ? 13 : 11) / Math.sqrt(z)))
            ctx.font = `${isKeyNode ? 'bold ' : ''}${nodeFontSize}px Inter, sans-serif`
            const label = node.name.length > 24 ? node.name.slice(0, 22) + '...' : node.name
            const textWidth = ctx.measureText(label).width

            const padX = 6 / Math.sqrt(z)
            const padY = 3 / Math.sqrt(z)
            const labelBoxH = nodeFontSize + padY * 2
            const labelY = node.y + node.radius + 6 + labelBoxH / 2

            ctx.fillStyle = isKeyNode
              ? 'rgba(14, 165, 233, 0.95)'
              : isPartOfHovered
              ? 'rgba(30, 41, 59, 0.95)'
              : isNeighbor
              ? 'rgba(30, 41, 59, 0.92)'
              : 'rgba(15, 23, 42, 0.85)'
            ctx.beginPath()
            ctx.roundRect(node.x - textWidth / 2 - padX, labelY - labelBoxH / 2, textWidth + padX * 2, labelBoxH, 5 / Math.sqrt(z))
            ctx.fill()

            ctx.strokeStyle = isKeyNode ? '#38bdf8' : isPartOfHovered ? '#60a5fa' : isNeighbor ? '#60a5fa' : 'rgba(255,255,255,0.2)'
            ctx.lineWidth = 1.2 / Math.sqrt(z)
            ctx.stroke()

            ctx.fillStyle = '#ffffff'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(label, node.x, labelY)
          }

          ctx.restore()
        })

        if (isRunning) {
          stepPhysics()
          animFrameIdRef.current = requestAnimationFrame(render)
        }
      }

      render()

      return () => {
        isRunning = false
        if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current)
      }
    }, [isPhysicsRunning, selectedNode, secondaryNode, hoveredNode, activeCategoryFilter, searchQuery, nodes, edges, highlightedPath, pathChain])

  // Mouse / Touch Event Handlers for Canvas Interaction with exact transform mapping
  const getCanvasCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const screenX = clientX - rect.left
    const screenY = clientY - rect.top
    return {
      x: (screenX - panRef.current.x) / zoomRef.current,
      y: (screenY - panRef.current.y) / zoomRef.current,
    }
  }

  const findNodeAtPos = (worldX: number, worldY: number): SimNode | null => {
    const nodesArr = Array.from(simNodesRef.current.values())
    for (let i = nodesArr.length - 1; i >= 0; i--) {
      const n = nodesArr[i]
      const dx = n.x - worldX
      const dy = n.y - worldY
      const hitRadius = Math.max(n.radius + 10, 26)
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        return n
      }
    }
    return null
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e.clientX, e.clientY)
    const hitNode = findNodeAtPos(coords.x, coords.y)
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY }

    if (hitNode) {
      draggedNodeRef.current = hitNode
      isDraggingNodeRef.current = true
      isPanningRef.current = false
      onSelectNode(hitNode)
    } else {
      draggedNodeRef.current = null
      isDraggingNodeRef.current = false
      isPanningRef.current = true
      panStartRef.current = {
        x: e.clientX - panRef.current.x,
        y: e.clientY - panRef.current.y,
      }
      if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing'
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDraggingNodeRef.current && draggedNodeRef.current) {
      const coords = getCanvasCoords(e.clientX, e.clientY)
      draggedNodeRef.current.x = coords.x
      draggedNodeRef.current.y = coords.y
      draggedNodeRef.current.vx = 0
      draggedNodeRef.current.vy = 0
      draggedNodeRef.current.isPinned = true
    } else if (isPanningRef.current) {
      const nextPanX = e.clientX - panStartRef.current.x
      const nextPanY = e.clientY - panStartRef.current.y
      panRef.current = { x: nextPanX, y: nextPanY }
      setPanState({ x: nextPanX, y: nextPanY })
    } else {
      const coords = getCanvasCoords(e.clientX, e.clientY)
      const hit = findNodeAtPos(coords.x, coords.y)
      setHoveredNode(hit)
      if (canvasRef.current) {
        canvasRef.current.style.cursor = hit ? 'pointer' : 'grab'
      }
    }
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const distMoved = Math.hypot(
      e.clientX - mouseDownPosRef.current.x,
      e.clientY - mouseDownPosRef.current.y
    )

    if (draggedNodeRef.current && distMoved >= 6) {
      // Release the node back into physics simulation from its dropped position
      draggedNodeRef.current.isPinned = false
      draggedNodeRef.current.vx = 0
      draggedNodeRef.current.vy = 0
    }

    // Reset highlight only if user clicked on empty canvas background without dragging
    if (!isDraggingNodeRef.current && isPanningRef.current && distMoved < 6) {
      onSelectNode(null)
    }

    draggedNodeRef.current = null
    isDraggingNodeRef.current = false
    isPanningRef.current = false
    if (canvasRef.current) {
      canvasRef.current.style.cursor = hoveredNode ? 'pointer' : 'grab'
    }
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '620px',
        background: '#090d16',
        borderRadius: '16px',
        border: '1px solid var(--border-color)',
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
      }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab' }}
      />

      {/* Floating Modern HUD Control Overlay */}
      <div
        style={{
          position: 'absolute',
          bottom: '1rem',
          right: '1rem',
          display: 'flex',
          gap: '0.4rem',
          alignItems: 'center',
          background: 'rgba(15, 23, 42, 0.9)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '10px',
          padding: '0.4rem 0.5rem',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
        }}
      >
        {/* Directional Pan Buttons */}
        <div style={{ display: 'flex', gap: '0.2rem', paddingRight: '0.4rem', borderRight: '1px solid rgba(255, 255, 255, 0.1)' }}>
          <button
            onClick={() => panBy(80, 0)}
            title="Pan Left"
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              color: '#fff',
              borderRadius: '6px',
              width: '30px',
              height: '30px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.85rem',
            }}
          >
            ⬅️
          </button>
          <button
            onClick={() => panBy(-80, 0)}
            title="Pan Right"
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              color: '#fff',
              borderRadius: '6px',
              width: '30px',
              height: '30px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.85rem',
            }}
          >
            ➡️
          </button>
          <button
            onClick={() => panBy(0, 80)}
            title="Pan Up"
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              color: '#fff',
              borderRadius: '6px',
              width: '30px',
              height: '30px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.85rem',
            }}
          >
            ⬆️
          </button>
          <button
            onClick={() => panBy(0, -80)}
            title="Pan Down"
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              color: '#fff',
              borderRadius: '6px',
              width: '30px',
              height: '30px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.85rem',
            }}
          >
            ⬇️
          </button>
        </div>

        {/* Zoom Controls */}
        <button
          onClick={() => zoomAroundCenter(1.25)}
          title="Zoom In"
          style={{
            background: 'rgba(255, 255, 255, 0.08)',
            border: 'none',
            color: '#fff',
            borderRadius: '6px',
            width: '30px',
            height: '30px',
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: '1rem',
          }}
        >
          +
        </button>
        <button
          onClick={() => zoomAroundCenter(0.80)}
          title="Zoom Out"
          style={{
            background: 'rgba(255, 255, 255, 0.08)',
            border: 'none',
            color: '#fff',
            borderRadius: '6px',
            width: '30px',
            height: '30px',
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: '1rem',
          }}
        >
          -
        </button>
        <button
          onClick={fitToView}
          title="Fit to Screen"
          style={{
            background: 'rgba(56, 189, 248, 0.15)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            color: '#38bdf8',
            borderRadius: '6px',
            padding: '0 0.6rem',
            height: '30px',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '0.8rem',
          }}
        >
          ⛶ Fit
        </button>
        <button
          onClick={() => setIsPhysicsRunning((r) => !r)}
          title={isPhysicsRunning ? 'Pause Physics' : 'Resume Physics'}
          style={{
            background: isPhysicsRunning ? 'rgba(255, 255, 255, 0.08)' : 'rgba(245, 158, 11, 0.2)',
            border: isPhysicsRunning ? 'none' : '1px solid rgba(245, 158, 11, 0.4)',
            color: isPhysicsRunning ? '#cbd5e1' : '#fbbf24',
            borderRadius: '6px',
            padding: '0 0.6rem',
            height: '30px',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '0.8rem',
          }}
        >
          {isPhysicsRunning ? '⏸️ Freeze' : '▶️ Float'}
        </button>
      </div>
    </div>
  )
}
