import { apiFetch, API_BASE } from './apiClient'

export interface Conversation {
  id: string
  title: string
  file_count: number
  message_count?: number
  created_at?: string
  updated_at?: string
  is_demo?: boolean
}


export interface PersistedMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  citations?: any[]
  critic_info?: any
  groundedness_score?: number
  retry_info?: any
  graph_hops?: any[]
  graph_entities?: string[]
  graph_context_text?: string
  created_at: string
}

// In-memory conversations cache — 30s TTL for instant sidebar renders
let _convsCache: Conversation[] | null = null
let _convsCacheExpiry = 0

export function getCachedConversations(): Conversation[] | null {
  if (_convsCache && Date.now() < _convsCacheExpiry) return _convsCache
  return null
}

export function setCachedConversations(list: Conversation[]) {
  _convsCache = list
  _convsCacheExpiry = Date.now() + 30_000
}

export function invalidateConversationsCache() {
  _convsCache = null
  _convsCacheExpiry = 0
  for (const k in _msgsCache) {
    delete _msgsCache[k]
  }
}


export async function listConversations(): Promise<Conversation[]> {
  const res = await apiFetch(`${API_BASE}/conversations`)
  if (!res.ok) {
    throw new Error(`Failed to load conversations: ${res.status}`)
  }
  const data = await res.json()
  setCachedConversations(data)
  return data
}

export async function createConversation(title?: string, id?: string): Promise<Conversation> {
  const res = await apiFetch(`${API_BASE}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title || 'New Conversation', id }),
  })
  if (!res.ok) {
    throw new Error(`Failed to create conversation: ${res.status}`)
  }
  const newConv = await res.json()
  const current = getCachedConversations() || []
  setCachedConversations([newConv, ...current.filter((c) => c.id !== newConv.id)])
  return newConv
}


export const CANONICAL_DEMO_MESSAGES: PersistedMessage[] = [
  {
    id: 'msg_u_demo_1',
    conversation_id: 'conv_demo',
    role: 'user',
    content: 'What hardware components and thermal thresholds govern the VoltBus V3 battery system, and what occurred during the July 12 incident at Stop 7?',
    citations: [],
    created_at: '2026-08-23T00:01:00Z',
  },
  {
    id: 'msg_a_demo_1',
    conversation_id: 'conv_demo',
    role: 'assistant',
    content: `Based on the technical documents, engineering briefs, and debrief records, here are the core hardware components, thermal thresholds, and details regarding the July 12 incident for the VoltBus V3 system:

### **VoltBus V3 Core Hardware Components**
* **Battery Architecture**: Equipped with a **600 kWh total capacity** LFP-2 (Lithium Iron Phosphate) battery pack (650V nominal, 923 Ah capacity) split across four under-floor modules [1, 2].
* **Charging System**: Features a top-mounted pantograph charging rail that connects to overhead charging heads, supporting ultra-rapid charging up to **450 kW** [1, 2].
* **Drivetrain & Build**: A 12-meter low-floor urban electric bus featuring an aluminum chassis, 4x 150 kW Permanent Magnet Synchronous Motors (PMSM), and electronic all-wheel drive [2, 3].
* **Sensor & Safety Suite**: Includes 128-beam LiDAR domes, HDR cameras, radar, an Edge AI compute node running Perception OS 4.2, and a dedicated Safety Override Engine (SOE) [2, 4].

---

### **Thermal Thresholds & Management Rules**
The VoltBus V3 thermal management system operates under four defined temperature states [3]:
1. **State 0 — Normal (<42°C)**: Nominal driving and standard thermal management system circulation [3].
2. **State 1 — Warning (42°C to 48°C)**: Coolant pumps jump to 100% output, and pantograph charging power is automatically throttled to 150 kW [1, 3].
3. **State 2 — Critical Fault (>48°C)**: Charging is immediately terminated, the bus is held until temperature drops below 44°C, and it is routed to Depot-Gamma for inspection [3].
4. **State 3 — Emergency (>55°C)**: High-voltage battery contactors trip, pyrofuse isolation triggers, aerosol fire suppression arms, and passenger evacuation protocol begins [3].

---

### **July 12 Incident at Stop 7 (Oak Street)**
* **What Occurred**: During a regional heatwave (39°C ambient temperature under direct sun), VoltBus Unit #09 executed two back-to-back 450 kW rapid charges in 45 minutes [1, 5]. This triggered a **Level 1 Thermal Warning** when the battery pack temperature reached 48°C [1, 5].
* **Automated & Operational Response**:
  * Cooling pumps automatically ramped to 100% capacity, and charging speed was throttled [1, 5].
  * Unit #09 stayed in service throughout with zero passenger disruption, and temperature normalized in 14 minutes [1, 5].
* **Depot Follow-Up (Diagnostic Routine 88)**: Upon returning to Depot-Gamma, Lead Technician David Miller ran Diagnostic Routine 88 (DR-88), discovering a **3.2% internal resistance imbalance in Module 2** caused by minor construction dust accumulation on the radiator intake fins [5]. The intake was cleared, a balance cycle was completed, and the bus returned to the active fleet [5].
* **Permanent Policy Change**: Chief Systems Architect Elena Rostova enacted a strict rule: during ambient heatwaves above 35°C, Stop 7 permits only **one rapid charge per layover** instead of two [1, 5].`,
    citations: [
      {
        status: 'VERIFIED',
        file_id: 'demo_file_pdf_1',
        filename: 'VoltBus_Master_Operations_Engineering_Brief_Clean.pdf',
        page_number: 5,
        claim_text: 'During a regional heatwave (39°C ambient temperature under direct sun), VoltBus Unit #09 executed two back-to-back 450 kW rapid charges in 45 minutes, triggering a Level 1 Thermal Warning.',
        is_grounded: true,
        evidence_quote: 'Stop 7 — Oak Street (39°C, direct sun, heatwave). Cause: Two back-to-back 450 kW rapid charges in 45 minutes. Alert Level: Level 1 Warning.',
        passage_number: 1,
      },
      {
        status: 'VERIFIED',
        file_id: 'demo_file_img_1',
        filename: 'voltbus_v3_schematic.png',
        claim_text: 'Equipped with a 600 kWh total capacity LFP-2 battery pack and top-mounted 450 kW pantograph charging interface.',
        is_grounded: true,
        evidence_quote: 'Dual liquid-cooled Lithium Iron Phosphate (LFP2) battery packs, 600 kWh total storage, 650V nominal bus voltage, 923 Ah capacity; 450 kW overhead pantograph receiver.',
        passage_number: 2,
      },
      {
        status: 'VERIFIED',
        file_id: 'demo_file_img_3',
        filename: 'thermal_safety_flowchart.png',
        claim_text: 'State 1 (42°C - 48°C) Warning Alert ramps pumps to 100%; State 2 (>48°C) Critical Fault halts charging and routes to Depot-Gamma; State 3 (>55°C) Emergency trips contactors.',
        is_grounded: true,
        evidence_quote: 'State 1 (42°C - 48°C) Warning Alert: Automatic ramp of dual coolant pumps to 100% capacity; fast-charge power throttled to maximum 150 kW. State 2 (>48°C) Critical Fault: Immediate charge cessation; reroute to Depot-Gamma.',
        passage_number: 3,
      },
      {
        status: 'VERIFIED',
        file_id: 'demo_file_img_2',
        filename: 'route101_network_map.png',
        claim_text: 'Stop 7 (Oak Street) is located on the 14.2 km Route 101 corridor between Depot-Alpha and Depot-Gamma.',
        is_grounded: true,
        evidence_quote: 'Stop 7 (Oak Street) 39°C Heatwave Incident. Corridor connects 12 Smart Stations from Depot-Alpha to Depot-Gamma.',
        passage_number: 4,
      },
      {
        status: 'VERIFIED',
        file_id: 'demo_file_aud_1',
        filename: 'voltbus_route101_debrief.mp3',
        timestamp: '02:15 - 02:40',
        claim_text: 'Lead Technician David Miller verified cell balance after DR-88 check and Elena Rostova instituted a single-charge layover rule during heatwaves above 35°C.',
        is_grounded: true,
        evidence_quote: 'We performed the DR-88 battery check at Depot-Gamma and confirmed cell resistance balance was within 1.2% nominal. We have enacted a hard operational rule restricting Stop 7 layovers to a single 450 kW charge when ambient temperatures exceed 35°C.',
        passage_number: 5,
      },
    ],
    critic_info: {
      confidence: 'high',
      reason: 'All technical specifications, threshold metrics, and event sequences are strictly verified against the multimodal project repository.',
    },
    groundedness_score: 1.0,
    retry_info: {
      retried: false,
    },
    graph_hops: [
      {
        from_node: 'VoltBus V3',
        from_type: 'PROJECT',
        relation: 'CONTAINS_COMPONENT',
        to_node: 'Pantograph Charging Rail (450 kW)',
        to_type: 'TECH',
        filename: 'voltbus_v3_schematic.png',
        evidence: '450 kW overhead pantograph receiver',
      },
      {
        from_node: 'VoltBus V3',
        from_type: 'PROJECT',
        relation: 'HAS_THERMAL_ESCALATION',
        to_node: 'Level 1 Warning (48°C)',
        to_type: 'SAFETY_RULE',
        filename: 'thermal_safety_flowchart.png',
        evidence: 'State 1 (42°C - 48°C) Warning Alert',
      },
      {
        from_node: 'Stop 7 (Oak Street)',
        from_type: 'LOCATION',
        relation: 'EXPERIENCED_INCIDENT',
        to_node: 'July 12 Heatwave Event',
        to_type: 'EVENT',
        filename: 'route101_network_map.png',
        evidence: 'Stop 7 (Oak Street) 39°C Heatwave Incident',
      },
    ],
    graph_entities: [
      'VoltBus V3',
      'Elena Rostova',
      'Marcus Vance',
      'David Miller',
      'Stop 7 (Oak Street)',
      'Depot-Gamma',
      'Diagnostic Routine 88',
      'Perception OS 4.2',
    ],
    graph_context_text: '### 🕸️ Knowledge Graph Traversal:\n• **VoltBus V3** ➔ `CONTAINS_COMPONENT` ➔ **LFP-2 Battery Pack (600 kWh)** [voltbus_v3_schematic.png]\n• **VoltBus V3** ➔ `GOVERNED_BY` ➔ **Thermal Safety Flowchart** [thermal_safety_flowchart.png]\n• **Stop 7 (Oak Street)** ➔ `EXPERIENCED_INCIDENT` ➔ **July 12 Heatwave Event** [route101_network_map.png]\n• **Depot-Gamma** ➔ `EXECUTES_DIAGNOSTIC` ➔ **Diagnostic Routine 88 (DR-88)** [voltbus_route101_debrief.mp3]',
    created_at: '2026-08-23T00:01:05Z',
  },
  {
    id: 'msg_u_demo_2',
    conversation_id: 'conv_demo',
    role: 'user',
    content: 'What maintenance protocol is executed at Depot-Gamma following a thermal warning, and what were the findings for Unit #09?',
    citations: [],
    created_at: '2026-08-23T00:02:00Z',
  },
  {
    id: 'msg_a_demo_2',
    conversation_id: 'conv_demo',
    role: 'assistant',
    content: `Based on the operations debrief and engineering records, here is the protocol followed at Depot-Gamma and the specific findings for Unit #09:

### **Depot-Gamma Maintenance Protocol for Level 1 Warnings**
Per standard operating procedure, any transit vehicle that registers a Level 1 thermal warning during operations is routed to Depot-Gamma for inspection [1, 2]:
1. **Diagnostic Routine Execution**: Lead Technician David Miller pulled Unit #09 into the diagnostic bay and executed **Diagnostic Routine 88 (DR-88)** [1].
2. **Cell Group Testing**: DR-88 tests internal resistance across all cell groups within the **600 kWh LFP-2 battery array** [1].

### **Findings for Unit #09**
- **Resistance Imbalance**: DR-88 uncovered a **3.2% internal resistance imbalance** in Module 2 [1].
- **Root Cause**: The imbalance was traced to minor construction dust and debris accumulation on the radiator intake fins originating from the Oak Street construction corridor [1].
- **Resolution**:
  - The maintenance team cleared the radiator intake debris [1].
  - A full charge-discharge balance cycle was executed [1].
  - Technicians verified all cell groups returned to within **1.2% nominal baseline tolerances** and signed off on DR-88 clearance [1].
  - Unit #09 was successfully returned to Marcus Vance's active dispatch pool the following morning [2].`,
    citations: [
      {
        status: 'VERIFIED',
        file_id: 'demo_file_aud_1',
        filename: 'voltbus_route101_debrief.mp3',
        timestamp: '02:42 - 03:22',
        claim_text: 'Lead Technician David Miller executed Diagnostic Routine 88, identifying a 3.2% resistance imbalance in Module 2 from intake debris.',
        is_grounded: true,
        evidence_quote: 'DR-88 tests the internal resistance across all cell groups in the LFP-2 array. We found a 3.2 percent internal resistance imbalance in Module 2 due to debris from Oak Street. Unit 09 went straight back into dispatch the next morning.',
        passage_number: 1,
      },
      {
        status: 'VERIFIED',
        file_id: 'demo_file_pdf_1',
        filename: 'VoltBus_Master_Operations_Engineering_Brief_Clean.pdf',
        page_number: 6,
        claim_text: 'Depot-Gamma in the South District holds sole authority for clearing LFP2 cell imbalances and Level 2 events under David Miller.',
        is_grounded: true,
        evidence_quote: 'Depot-Gamma (South District): Handles battery conditioning, sensor calibration, software updates. Lead Technician David Miller maintains the SOP for handling battery cell imbalances.',
        passage_number: 2,
      },
    ],
    critic_info: {
      confidence: 'high',
      reason: 'Verified against audio interview transcripts and Depot-Gamma facility SOP documentation.',
    },
    groundedness_score: 1.0,
    retry_info: {
      retried: false,
    },
    graph_hops: [
      {
        from_node: 'Depot-Gamma',
        from_type: 'FACILITY',
        relation: 'MAINTAINS_SOP',
        to_node: 'Diagnostic Routine 88 (DR-88)',
        to_type: 'TECH',
        filename: 'VoltBus_Master_Operations_Engineering_Brief_Clean.pdf',
        evidence: 'Step 2 Run DR-88 at Depot-Gamma',
      },
      {
        from_node: 'David Miller',
        from_type: 'PERSON',
        relation: 'INSPECTED_VEHICLE',
        to_node: 'VoltBus Unit #09',
        to_type: 'EQUIPMENT',
        filename: 'voltbus_route101_debrief.mp3',
        evidence: 'David Miller executed diagnostic routine 88 on Unit 09',
      },
    ],
    graph_entities: ['Depot-Gamma', 'David Miller', 'Diagnostic Routine 88', 'VoltBus Unit #09'],
    graph_context_text: '### 🕸️ Knowledge Graph Traversal:\n• **Depot-Gamma** ➔ `LEAD_TECHNICIAN` ➔ **David Miller**\n• **David Miller** ➔ `EXECUTED` ➔ **Diagnostic Routine 88** on **VoltBus Unit #09**',
    created_at: '2026-08-23T00:02:05Z',
  },
]

// Per-conversation message cache for instant chat history on tab switch
const _msgsCache: Record<string, PersistedMessage[]> = {
  conv_demo: CANONICAL_DEMO_MESSAGES,
}

export function getCachedMessages(conversationId: string): PersistedMessage[] | null {
  if (conversationId === 'conv_demo' && (!_msgsCache['conv_demo'] || _msgsCache['conv_demo'].length === 0)) {
    _msgsCache['conv_demo'] = CANONICAL_DEMO_MESSAGES
  }
  return _msgsCache[conversationId] ?? null
}

export function setCachedMessages(conversationId: string, msgs: PersistedMessage[]) {
  _msgsCache[conversationId] = msgs
}

export function resetDemoMessages() {
  _msgsCache['conv_demo'] = CANONICAL_DEMO_MESSAGES
}

export function invalidateMessagesCache(conversationId: string) {
  if (conversationId === 'conv_demo') {
    _msgsCache['conv_demo'] = CANONICAL_DEMO_MESSAGES
  } else {
    delete _msgsCache[conversationId]
  }
}

export async function getConversationMessages(conversationId: string): Promise<PersistedMessage[]> {
  if (conversationId === 'conv_demo') {
    try {
      const res = await apiFetch(`${API_BASE}/conversations/${conversationId}/messages`)
      if (res.ok) {
        const data = await res.json()
        if (data && data.length > 0 && !data.some((m: any) => m.content === 'hi')) {
          setCachedMessages(conversationId, data)
          return data
        }
      }
    } catch (e) {
      // Fallback
    }
    setCachedMessages('conv_demo', CANONICAL_DEMO_MESSAGES)
    return CANONICAL_DEMO_MESSAGES
  }

  const res = await apiFetch(`${API_BASE}/conversations/${conversationId}/messages`)
  if (!res.ok) {
    throw new Error(`Failed to load messages: ${res.status}`)
  }
  const data = await res.json()
  setCachedMessages(conversationId, data)
  return data
}

export async function clearConversationMessages(conversationId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/conversations/${conversationId}/messages`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    throw new Error(`Failed to clear messages: ${res.status}`)
  }
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) {
    throw new Error(`Failed to rename conversation: ${res.status}`)
  }
}

export async function deleteConversation(id: string): Promise<void> {
  const current = getCachedConversations() || []
  setCachedConversations(current.filter((c) => c.id !== id))
  invalidateMessagesCache(id)
  const res = await apiFetch(`${API_BASE}/conversations/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    throw new Error(`Failed to delete conversation: ${res.status}`)
  }
}
