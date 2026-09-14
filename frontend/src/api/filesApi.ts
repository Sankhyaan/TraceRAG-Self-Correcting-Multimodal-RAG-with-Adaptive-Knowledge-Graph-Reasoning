import { apiFetch, API_BASE } from './apiClient'

export interface FileItem {
  id: string
  conversation_id: string
  filename: string
  file_type: 'document' | 'image' | 'audio' | 'video'
  storage_path: string
  storage_url: string
  file_size_bytes: number
  mime_type?: string
  extracted_text?: string | null
  status?: 'pending' | 'processing' | 'done' | 'failed'
  extraction_error?: string | null
  uploaded_at: string
}

export interface ListFilesResponse {
  conversation_id: string
  files: FileItem[]
  total: number
  by_type: {
    document: number
    image: number
    audio: number
    video: number
  }
}

export interface ExtractedContentResponse {
  file_id: string
  filename: string
  file_type: string
  status: string
  extracted_text?: string | null
  extraction_error?: string | null
  uploaded_at?: string
}

export const DEMO_FILES: FileItem[] = [
  {
    id: 'demo_file_pdf_1',
    conversation_id: 'conv_demo',
    filename: 'VoltBus_Master_Operations_Engineering_Brief_Clean.pdf',
    file_type: 'document',
    storage_path: 'conv_demo/VoltBus_Master_Operations_Engineering_Brief_Clean.pdf',
    storage_url: '/demo_files/VoltBus_Master_Operations_Engineering_Brief_Clean.pdf',
    file_size_bytes: 329553,
    mime_type: 'application/pdf',
    status: 'done',
    extracted_text: '[VoltBus_Master_Operations_Engineering_Brief_Clean.pdf | Executive Summary & Program Objectives]\nVoltBus Urban Transit System (VUTS)\nMaster Operations & Engineering Brief\nLead Agency: Metro Mobility Innovation Group (MMIG)\nChief Systems Architect: Elena Rostova | Issue Date: August 21, 2026\n\nPhase II Controlled Pilot active on Route 101 connecting 12 smart stations (14.2 km corridor) with Depot-Alpha (North District) and Depot-Gamma (South District).\n\nMaintenance SOP & Thermal Thresholds:\nLevel 0: Normal (<42°C)\nLevel 1 Warning (42°C - 48°C): Ramps cooling pumps to 100%, throttles fast charging.\nLevel 2 Critical (>48°C): Terminates fast charging, reroutes to Depot-Gamma for DR-88 diagnostic battery pack check.\nLevel 3 Emergency (>55°C): Emergency HV contactor disconnect, automated fire suppression prep, passenger evacuation.',
    uploaded_at: '2026-08-23T00:00:00Z',
  },
  {
    id: 'demo_file_img_1',
    conversation_id: 'conv_demo',
    filename: 'voltbus_v3_schematic.png',
    file_type: 'image',
    storage_path: 'conv_demo/voltbus_v3_schematic.png',
    storage_url: '/demo_files/voltbus_v3_schematic.png',
    file_size_bytes: 2175694,
    mime_type: 'image/png',
    status: 'done',
    extracted_text: '[Visual Description - voltbus_v3_schematic.png]:\nHardware engineering blueprint and schematic wiring diagram for the VoltBus V3 12-Meter Low-Floor Electric Bus.\n- Power & Propulsion: Dual liquid-cooled Lithium Iron Phosphate (LFP2) battery packs, 600 kWh total storage, 650V nominal bus voltage, 923 Ah capacity.\n- Drivetrain: 4x 150 kW Permanent Magnet Synchronous Motors (PMSM) configured as dual-axle electronic all-wheel drive.\n- Charging Interface: 450 kW overhead pantograph ultra-fast charging receiver located on roof module B.\n- Thermal Management System (TMS): Active chiller loop with glycol-water coolant, high-capacity dual electric water pumps (P-101 and P-102), and proportional bypass valve.\n- Autonomous Compute Cluster: Perception OS 4.2 redundant dual ECUs with CAN-FD and Automotive Ethernet backbones.',
    uploaded_at: '2026-08-23T00:00:00Z',
  },
  {
    id: 'demo_file_img_2',
    conversation_id: 'conv_demo',
    filename: 'route101_network_map.png',
    file_type: 'image',
    storage_path: 'conv_demo/route101_network_map.png',
    storage_url: '/demo_files/route101_network_map.png',
    file_size_bytes: 1586576,
    mime_type: 'image/png',
    status: 'done',
    extracted_text: '[Visual Description - route101_network_map.png]:\nA digital infographic displaying the network map and station topography for the Route 101 Smart Transit Corridor.\n- Corridor length: 14.2 km corridor connecting Northern Districts to Downtown.\n- 12 Smart Transit Stations: 1. Maple Ave, 2. Pine Road, 3. Lakeview, 4. Central Park, 5. Museum, 6. City Plaza, 7. Oak Street (Incident Site: Level 1 Thermal Warning at 39°C heatwave), 8. Riverside, 9. Union Station, 10. Grandview, 11. Southside, 12. Metro Terminal Hub.\n- Maintenance Depots: Depot-Alpha (North District - structural & chassis) and Depot-Gamma (South District - battery & firmware).',
    uploaded_at: '2026-08-23T00:00:00Z',
  },
  {
    id: 'demo_file_img_3',
    conversation_id: 'conv_demo',
    filename: 'thermal_safety_flowchart.png',
    file_type: 'image',
    storage_path: 'conv_demo/thermal_safety_flowchart.png',
    storage_url: '/demo_files/thermal_safety_flowchart.png',
    file_size_bytes: 1608457,
    mime_type: 'image/png',
    status: 'done',
    extracted_text: '[Visual Description - thermal_safety_flowchart.png]:\nMulti-Tier Operational Escalation Protocol & Thermal Safety Flowchart for VoltBus V3 Fleet.\n- State 0 (<42°C): Nominal cruising and regenerative braking. Standard TMS cooling circulation.\n- State 1 (42°C - 48°C) Warning Alert: Automatic ramp of dual coolant pumps to 100% capacity; fast-charge power throttled to maximum 150 kW; telemetry event logged to Marcus Vance\'s dispatch console.\n- State 2 (>48°C) Critical Fault: Immediate charge cessation; bus held at station until pack temperature drops <44°C; automatic maintenance reroute to Depot-Gamma for David Miller\'s DR-88 diagnostic cell imbalance check.\n- State 3 (>55°C) Emergency: Pyro-fuse isolation, HV battery contactor trip, automated aerosol fire suppression arming, passenger emergency evacuation protocol.',
    uploaded_at: '2026-08-23T00:00:00Z',
  },
  {
    id: 'demo_file_aud_1',
    conversation_id: 'conv_demo',
    filename: 'voltbus_route101_debrief.mp3',
    file_type: 'audio',
    storage_path: 'conv_demo/voltbus_route101_debrief.mp3',
    storage_url: '/demo_files/voltbus_route101_debrief.mp3',
    file_size_bytes: 6433131,
    mime_type: 'audio/mpeg',
    status: 'done',
    extracted_text: '[Audio Transcript - voltbus_route101_debrief.mp3 (Language: en, Duration: 267s)]:\n[00:00 - 00:04] Elena Rostova: Good morning, everyone. This is Elena Rostova, Chief Systems Architect.\n[00:04 - 00:13] Today is August 21st, 2026, and we are kicking off our monthly engineering review for phase two operations on Route 101.\n[00:13 - 00:20] On the line, we have Marcus Vance from Operations at the Metro Terminal Hub and David Miller, lead technician down at Depot Gamma.\n[00:20 - 00:24] Elena: Marcus, let\'s start with high-level throughput.\n[00:24 - 00:34] Marcus Vance: Thanks, Elena. Route 101 has had a solid month overall. We cleared approximately 48,000 passenger rides across our 12 smart stations.\n[00:34 - 00:41] The 14.2 km corridor is holding an average end-to-end travel time of about 24 minutes.\n[00:41 - 00:52] Over at the Metro Terminal Hub, our 450 kilowatt-pantograph charger is averaging 6 to 8 minutes per rapid top-up, keeping our turnaround times tight.\n[00:52 - 01:03] Elena: Now let\'s dig into the primary incident from last month\'s log: the thermal event on July 12 involving VoltBus Unit No. 09.\n[01:03 - 01:17] Marcus: Ambient ground temp reached 39 degrees Celsius at Stop 7, Oak Street. Unit No. 09 had just logged back to back 450 kilowatt rapid charges within a 45-minute window.\n[01:17 - 01:43] Marcus: As it arrived at Stop 7, the internal sensor suite flagged an LFP2 battery pack temperature crossing 48 degrees Celsius, triggering a level 1 warning state in Perception OS 4.2.\n[01:43 - 02:15] David Miller: The cooling pumps immediately ramped to 100%, and the pack cooled down within 14 minutes without taking the bus out of passenger service. We also performed the DR-88 battery check at Depot-Gamma and confirmed cell resistance balance was within 1.2% nominal.\n[02:15 - 02:40] Elena: Follow-up action: we have enacted a hard operational rule restricting Stop 7 layovers to a single 450 kW charge when ambient temperatures exceed 35°C.',
    uploaded_at: '2026-08-23T00:00:00Z',
  },
]

export const getCanonicalDemoResponse = (fileType: string = 'all'): ListFilesResponse => {
  const filtered = fileType && fileType !== 'all'
    ? DEMO_FILES.filter((f) => f.file_type === fileType)
    : DEMO_FILES

  return {
    conversation_id: 'conv_demo',
    files: filtered,
    total: filtered.length,
    by_type: {
      document: DEMO_FILES.filter((f) => f.file_type === 'document').length,
      image: DEMO_FILES.filter((f) => f.file_type === 'image').length,
      audio: DEMO_FILES.filter((f) => f.file_type === 'audio').length,
      video: DEMO_FILES.filter((f) => f.file_type === 'video').length,
    },
  }
}

// In-memory cache for instant tab switches without 0-count flash
const filesCache: Record<string, ListFilesResponse> = {
  'conv_demo:all': getCanonicalDemoResponse('all'),
  'conv_demo:document': getCanonicalDemoResponse('document'),
  'conv_demo:image': getCanonicalDemoResponse('image'),
  'conv_demo:audio': getCanonicalDemoResponse('audio'),
  'conv_demo:video': getCanonicalDemoResponse('video'),
}

export function getCachedFiles(conversationId: string, fileType: string = 'all'): ListFilesResponse | null {
  const key = `${conversationId}:${fileType}`
  if (conversationId === 'conv_demo' && !filesCache[key]) {
    filesCache[key] = getCanonicalDemoResponse(fileType)
  }
  return filesCache[key] || null
}

export function setCachedFiles(conversationId: string, fileType: string = 'all', data: ListFilesResponse) {
  const key = `${conversationId}:${fileType}`
  filesCache[key] = data
}

export function clearFilesCache(conversationId?: string) {
  if (conversationId) {
    Object.keys(filesCache).forEach((k) => {
      if (k.startsWith(conversationId) && conversationId !== 'conv_demo') delete filesCache[k]
    })
  } else {
    Object.keys(filesCache).forEach((k) => {
      if (!k.startsWith('conv_demo')) delete filesCache[k]
    })
  }
}

export async function uploadFiles(
  conversationId: string,
  files: File[],
): Promise<{ uploaded: FileItem[]; errors: any[]; count: number }> {
  const formData = new FormData()
  formData.append('conversation_id', conversationId)
  files.forEach((file) => formData.append('files', file))

  const res = await apiFetch(`${API_BASE}/files/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || `Upload failed with status ${res.status}`)
  }

  clearFilesCache(conversationId)
  return res.json()
}

export async function listFiles(
  conversationId: string,
  fileType?: string,
): Promise<ListFilesResponse> {
  const url = new URL(`${API_BASE}/files`)
  url.searchParams.set('conversation_id', conversationId)
  if (fileType && fileType !== 'all') {
    url.searchParams.set('file_type', fileType)
  }

  try {
    const res = await apiFetch(url.toString())
    if (!res.ok) {
      if (conversationId === 'conv_demo') {
        const fallback = getCanonicalDemoResponse(fileType)
        setCachedFiles(conversationId, fileType || 'all', fallback)
        return fallback
      }
      const cached = getCachedFiles(conversationId, fileType || 'all')
      if (cached) return cached
      return {
        conversation_id: conversationId,
        files: [],
        total: 0,
        by_type: { document: 0, image: 0, audio: 0, video: 0 },
      }
    }

    const data: ListFilesResponse = await res.json()
    if (conversationId === 'conv_demo' && (!data.files || data.files.length === 0)) {
      const fallback = getCanonicalDemoResponse(fileType)
      setCachedFiles(conversationId, fileType || 'all', fallback)
      return fallback
    }

    setCachedFiles(conversationId, fileType || 'all', data)
    return data
  } catch (err: any) {
    if (conversationId === 'conv_demo') {
      const fallback = getCanonicalDemoResponse(fileType)
      setCachedFiles(conversationId, fileType || 'all', fallback)
      return fallback
    }
    const cached = getCachedFiles(conversationId, fileType || 'all')
    if (cached) return cached
    return {
      conversation_id: conversationId,
      files: [],
      total: 0,
      by_type: { document: 0, image: 0, audio: 0, video: 0 },
    }
  }
}

export async function getFileSignedUrl(fileId: string): Promise<string> {
  const findDemo = () => DEMO_FILES.find((f) => f.id === fileId || f.filename === fileId)
  const initialDemo = findDemo()
  if (initialDemo) {
    return `/demo_files/${encodeURIComponent(initialDemo.filename)}`
  }

  try {
    const res = await apiFetch(`${API_BASE}/files/${fileId}/url`)
    if (!res.ok) {
      const fallback = findDemo()
      if (fallback) {
        return `/demo_files/${encodeURIComponent(fallback.filename)}`
      }
      throw new Error(`Failed to get file URL: ${res.status}`)
    }
    const data = await res.json()
    return data.signed_url
  } catch (err: any) {
    const fallback = findDemo()
    if (fallback) {
      return `/demo_files/${encodeURIComponent(fallback.filename)}`
    }
    throw err
  }
}

export async function getExtractedText(fileId: string): Promise<ExtractedContentResponse> {
  const findDemo = () => DEMO_FILES.find((f) => f.id === fileId || f.filename === fileId)

  try {
    const res = await apiFetch(`${API_BASE}/files/${fileId}/extracted`)
    if (!res.ok) {
      const demo = findDemo()
      if (demo) {
        return {
          file_id: demo.id,
          filename: demo.filename,
          file_type: demo.file_type,
          status: 'done',
          extracted_text: demo.extracted_text,
          extraction_error: null,
          uploaded_at: demo.uploaded_at,
        }
      }
      throw new Error(`Failed to fetch extracted text: ${res.status}`)
    }
    return res.json()
  } catch (err: any) {
    const demo = findDemo()
    if (demo) {
      return {
        file_id: demo.id,
        filename: demo.filename,
        file_type: demo.file_type,
        status: 'done',
        extracted_text: demo.extracted_text,
        extraction_error: null,
        uploaded_at: demo.uploaded_at,
      }
    }
    throw err
  }
}

export async function deleteFile(fileId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/files/${fileId}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || `Failed to delete file: ${res.status}`)
  }
}

export async function clearConversationFiles(conversationId: string): Promise<number> {
  const res = await apiFetch(`${API_BASE}/files/conversation/${conversationId}/clear`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || `Failed to clear files: ${res.status}`)
  }
  const data = await res.json()
  return data.deleted_count
}

export async function reExtractFile(fileId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/files/${fileId}/re-extract`, {
    method: 'POST',
  })
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || `Failed to re-extract file: ${res.status}`)
  }
}
