import { apiFetch, API_BASE } from './apiClient'

export interface RetrievedChunk {
  chunk_id: string
  file_id: string
  conversation_id: string
  filename: string
  file_type: string
  chunk_index: number
  text: string
  timestamp?: string | null
  page_number?: number | null
  // Raw scores
  dense_score?: number
  bm25_score?: number
  final_score: number
  // Normalized 0-100% scores
  final_score_pct?: number | null
  dense_score_pct?: number | null
  bm25_score_pct?: number | null
  // Metadata
  confidence_tier?: 'HIGH' | 'MEDIUM' | 'LOW' | null
  coordination_ratio?: number | null
  modality_boost?: number
}

export interface ModalityGap {
  modality: string
  status: string
  message: string
}

export interface RetrievalResponse {
  query: string
  conversation_id: string
  routed_categories: string[]
  router_weights: Record<string, number>
  router_rationale: string
  router_intent_label?: string | null
  alpha: number
  total_candidates: number
  chunks: RetrievedChunk[]
  modality_gaps?: ModalityGap[] | null
}


export async function queryRetrieval(
  conversationId: string,
  query: string,
  topK: number = 5,
  alpha: number = 0.5,
  useRouter: boolean = true,
): Promise<RetrievalResponse> {
  const res = await apiFetch(`${API_BASE}/retrieval/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_id: conversationId,
      query,
      top_k: topK,
      alpha,
      use_router: useRouter,
    }),
  })

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || `Retrieval query failed: ${res.status}`)
  }

  return res.json()
}

export const DEFAULT_DEMO_RETRIEVAL: RetrievalResponse = {
  query: "How are facility duties divided across the transit corridor, and what operational change was enacted post-incident?",
  conversation_id: "conv_demo",
  routed_categories: ["document", "audio", "image", "video"],
  router_weights: {
    document: 1.0,
    image: 1.0,
    audio: 1.0,
    video: 0.0,
  },
  router_rationale: "The user is asking a complex question about facility duties across a transit corridor and post-incident operational changes, which spans multiple document, audio, and diagram sources.",
  router_intent_label: "Multi-Modal",
  alpha: 0.5,
  total_candidates: 16,
  chunks: [
    {
      chunk_id: "4a981b5e-87fb-4844-baf8-11455543a16d_chunk_4",
      file_id: "4a981b5e-87fb-4844-baf8-11455543a16d",
      conversation_id: "conv_demo",
      filename: "VoltBus_Master_Operations_Engineering_Brief_Clean.pdf",
      file_type: "document",
      chunk_index: 4,
      text: "[VoltBus_Master_Operations_Engineering_Brief_Clean.pdf | Page 5]\nVoltBus Urban Transit System (VUTS)\nMaster Operations & Engineering Brief\nPage 5 of 6   |   Metro Mobility Innovation Group\nPAGE 4\nRoute 101 Pilot Data & Incident Analysis\nRoute 101 Overview\n- 14.2 km corridor connecting the northern districts to downtown\n- 12 smart stations with real-time arrival info and, at 4 stops, charging heads\n- Dispatched from the Metro Terminal Hub, led by Operations Supervisor Marcus Vance\nIncident Case Study — July 12 Pilot Run\nDuring a regional heatwave, VoltBus Unit #09 triggered a Level 1 Thermal Warning while stopped at Stop 7 (Oak Street).\nDetail: VoltBus Unit #09 at Stop 7 — Oak Street (39°C, direct sun, heatwave)\nCause: Two back-to-back 450 kW rapid charges in 45 minutes\nAlert Level: Level 1 — Warning\nHow It Was Resolved:\n- Cooling pumps automatically ramped to 100%, as designed\n- Charging speed was reduced until the battery cooled down\n- Unit #09 stayed in service throughout — no passengers were affected and the route stayed on schedule\n- Temperature normalized in 14 minutes, well before it could escalate to a Level 2 Emergency\nFollow-Up Action:\nEngineering, under Elena Rostova, issued a new rule: during heatwaves above 35°C, Stop 7 allows only one rapid charge per layover instead of two. Since this change, no further thermal warnings have occurred on Route 101.",
      timestamp: null,
      page_number: 5,
      dense_score: 0.3792,
      bm25_score: 0.9933,
      final_score: 0.4419,
      final_score_pct: 100.0,
      dense_score_pct: 91.7,
      bm25_score_pct: 98.0,
      confidence_tier: "HIGH",
      coordination_ratio: 0.2949,
      modality_boost: 0.075,
    },
    {
      chunk_id: "4a981b5e-87fb-4844-baf8-11455543a16d_chunk_0",
      file_id: "4a981b5e-87fb-4844-baf8-11455543a16d",
      conversation_id: "conv_demo",
      filename: "VoltBus_Master_Operations_Engineering_Brief_Clean.pdf",
      file_type: "document",
      chunk_index: 0,
      text: "[VoltBus_Master_Operations_Engineering_Brief_Clean.pdf | Page 1]\nVoltBus Urban Transit System (VUTS)\nMaster Operations & Engineering Brief\nPage 1 of 6   |   Metro Mobility Innovation Group\nExecutive Summary & Program Objectives\nVoltBus is MMIG's flagship autonomous electric bus program, built to prove that a fully electric, self-driving transit fleet can run safely and reliably on real city streets.\nThe program is led by Chief Systems Architect Elena Rostova, whose team owns final sign-off on every safety and engineering decision before a change reaches passenger service.\n- Electric propulsion — zero tailpipe emissions on every route\n- Autonomous driving — supported by redundant sensors and a dedicated safety system\n- Smart stations — real-time passenger info and charging integration\nKey System Milestones: Phase I (Complete), Phase II (Controlled Pilot on Route 101 - Active), Phase III (Network Expansion).",
      timestamp: null,
      page_number: 1,
      dense_score: 0.3433,
      bm25_score: 1.0,
      final_score: 0.4302,
      final_score_pct: 97.2,
      dense_score_pct: 79.4,
      bm25_score_pct: 100.0,
      confidence_tier: "HIGH",
      coordination_ratio: 0.2949,
      modality_boost: 0.075,
    },
    {
      chunk_id: "55c70107-9016-40c5-8294-cd4a6085c997_chunk_0",
      file_id: "55c70107-9016-40c5-8294-cd4a6085c997",
      conversation_id: "conv_demo",
      filename: "voltbus_route101_debrief.mp3",
      file_type: "audio",
      chunk_index: 0,
      text: "[voltbus_route101_debrief.mp3]\n[Audio Transcript - voltbus_route101_debrief.mp3 (Language: en, Duration: 267s)]:\n[00:00 - 00:04] Good morning, everyone. This is Elena Rostova, Chief Systems Architect.\n[00:04 - 00:13] Today is August 21st, 2026, and we are kicking off our monthly engineering review for phase two operations on Route 101.\n[00:13 - 00:20] On the line, we have Marcus Vance from Operations at the Metro Terminal Hub and David Miller, lead technician down at Depot Gamma.\n[00:20 - 00:24] Marcus, let's start with high-level throughput.\n[00:24 - 00:29] Thanks, Elena. Route 101 has had a solid month overall.\n[00:29 - 00:34] We cleared approximately 48,000 passenger rides across our 12 smart stations.\n[00:34 - 00:41] The 14.2 km corridor is holding an average end-to-end travel time of about 24 minutes.\n[00:41 - 00:52] Over at the Metro Terminal Hub, our 450 kilowatt-pantograph charger is averaging 6 to 8 minutes per rapid top-up, keeping our turnaround times tight.\n[00:52 - 00:54] That's great, Marcus.\n[00:54 - 00:58] Now, let's dig into the primary incident from last month's log: The thermal event on July 12 involving VoltBus Unit No. 09.\n[01:07 - 01:17] Ambient ground temp reached 39 degrees Celsius at Stop 7, Oak Street. Unit No. 09 had just logged back to back 450 kilowatt rapid charges within 45 minutes.\n[01:29 - 01:43] Internal sensor suite flagged battery temperature crossing 48°C, which triggered a Level 1 warning state.",
      timestamp: "00:00 - 00:04",
      page_number: null,
      dense_score: 0.4033,
      bm25_score: 0.8634,
      final_score: 0.397,
      final_score_pct: 89.3,
      dense_score_pct: 100.0,
      bm25_score_pct: 59.0,
      confidence_tier: "HIGH",
      coordination_ratio: 0.2335,
      modality_boost: 0.075,
    },
    {
      chunk_id: "7d91431d-0d95-4ac6-80ea-67ecc56f7500_chunk_0",
      file_id: "7d91431d-0d95-4ac6-80ea-67ecc56f7500",
      conversation_id: "conv_demo",
      filename: "route101_network_map.png",
      file_type: "image",
      chunk_index: 0,
      text: "[route101_network_map.png]\n[Visual Description - route101_network_map.png]:\nA digital infographic displaying a network map and statistics for \"Route 101 Smart Transit Corridor\":\n- North District: Starts at Depot-Alpha (North District)\n- Route Line: Glowing cyan/blue line connecting 12 transit stations (Maple Ave, Pine Road, Lakeview, Central Park, Museum, City Plaza, Oak Street [Stop 7 39°C Heatwave Incident], Riverside, Union Station, Grandview, Southside)\n- South District: Ends at Depot-Gamma (South District)\n- Transit corridor covers 14.2 km with Depot-Alpha and Depot-Gamma facility hubs.",
      timestamp: null,
      page_number: null,
      dense_score: 0.398,
      bm25_score: 0.9808,
      final_score: 0.0295,
      final_score_pct: 2.2,
      dense_score_pct: 98.2,
      bm25_score_pct: 94.2,
      confidence_tier: "LOW",
      coordination_ratio: 0.1815,
      modality_boost: 0.075,
    },
    {
      chunk_id: "4a981b5e-87fb-4844-baf8-11455543a16d_chunk_5",
      file_id: "4a981b5e-87fb-4844-baf8-11455543a16d",
      conversation_id: "conv_demo",
      filename: "VoltBus_Master_Operations_Engineering_Brief_Clean.pdf",
      file_type: "document",
      chunk_index: 5,
      text: "[VoltBus_Master_Operations_Engineering_Brief_Clean.pdf | Page 6]\nVoltBus Urban Transit System (VUTS)\nMaster Operations & Engineering Brief\nPage 6 of 6   |   Metro Mobility Innovation Group\nPAGE 5\nInfrastructure Expansion & Maintenance Protocols\nFacility Roles:\n- Depot-Alpha (North District): Handles chassis, mechanical assemblies, structural checks.\n- Depot-Gamma (South District): Handles battery conditioning, sensor calibration, software updates.\nAny bus that trips a Level 2 thermal event is automatically routed to Depot-Gamma for inspection before it can return to service.\nMaintenance SOP — Battery Cell Imbalance:\nLead Technician David Miller maintains the standard procedure for handling battery cell imbalances at Depot-Gamma. If a battery pack shows more than 5% internal resistance imbalance between cell groups, it's automatically flagged for inspection (Step 1 Isolate, Step 2 Run DR-88, Step 3 Classify, Step 4 Sign off).",
      timestamp: null,
      page_number: 6,
      dense_score: 0.3259,
      bm25_score: 0.9589,
      final_score: 0.0279,
      final_score_pct: 1.8,
      dense_score_pct: 73.4,
      bm25_score_pct: 87.7,
      confidence_tier: "LOW",
      coordination_ratio: 0.1901,
      modality_boost: 0.075,
    },
  ],
  modality_gaps: [],
}

