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
  // Exchange 0: Greeting
  {
    id: 'msg_u_demo_0',
    conversation_id: 'conv_demo',
    role: 'user',
    content: 'hi',
    citations: [],
    created_at: '2026-08-23T00:00:00Z',
  },
  {
    id: 'msg_a_demo_0',
    conversation_id: 'conv_demo',
    role: 'assistant',
    content: `Hey there! Welcome to the **VoltBus Engineering & Route 101 Operations** demo workspace.

I have indexed and verified your complete multimodal repository:
* 📄 **VoltBus Master Operations & Engineering Brief** (\`.pdf\`)
* 🖼️ **VoltBus V3 Hardware & Blueprint Schematic** (\`.png\`)
* 🗺️ **Route 101 Transit Corridor & Station Network Map** (\`.png\`)
* 📊 **Thermal Safety & Dynamic Throttle Flowchart** (\`.png\`)
* 🎵 **Incident Post-Mortem & Maintenance Audio Debrief** (\`.mp3\`)

Every technical claim is validated by our **Self-Correcting Critic Engine** with grounded multimodal citations and knowledge graph relation proofs. Feel free to click any of the suggested inquiries below or ask any custom question!`,
    citations: [],
    critic_info: {
      confidence: 'high',
      reason: 'Direct conversational greeting with multimodal repository grounding and context overview.',
    },
    groundedness_score: 1.0,
    retry_info: {
      retried: false,
    },
    graph_hops: [],
    graph_entities: ['VoltBus V3', 'Route 101', 'Depot-Alpha', 'Depot-Gamma'],
    graph_context_text: '### 🕸️ Knowledge Graph Overview:\n• **VoltBus V3** ➔ `OPERATES_ON` ➔ **Route 101 Transit Corridor**\n• **Route 101** ➔ `MANAGED_BY` ➔ **Depot-Alpha** & **Depot-Gamma**',
    created_at: '2026-08-23T00:00:03Z',
  },

  // Exchange 1: Battery Architecture & Stop 7 Incident
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

  // Exchange 2: Depot-Gamma Maintenance SOP
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

  // Exchange 3: Thermal Safety Escalation Protocol States 0–3
  {
    id: 'msg_u_demo_3',
    conversation_id: 'conv_demo',
    role: 'user',
    content: 'What operational actions distinguish State 1 Warning from State 2 Critical and State 3 Emergency in the thermal safety flowchart?',
    citations: [],
    created_at: '2026-08-23T00:03:00Z',
  },
  {
    id: 'msg_a_demo_3',
    conversation_id: 'conv_demo',
    role: 'assistant',
    content: `According to the **Thermal Safety & Dynamic Throttle Flowchart** (\`thermal_safety_flowchart.png\`) and the **Master Operations Brief** [1, 2], the escalation protocols are strictly partitioned by temperature thresholds and automated control actions:

### **State 1: Warning Alert (42°C – 48°C)**
* **Threshold**: Pack temperature between **42.0°C and 48.0°C** [1].
* **Automated Actions**:
  * Dual coolant pumps instantly ramp to **100% capacity** (up from nominal 45% duty cycle) [1, 2].
  * Overhead pantograph charging rate is actively throttled down from 450 kW to a maximum of **150 kW** [1].
* **Operational Impact**: Vehicle remains in active transit service with passengers onboard [2].

---

### **State 2: Critical Fault Alert (>48°C)**
* **Threshold**: Temperature exceeds **48.0°C** [1].
* **Automated Actions**:
  * **Immediate cessation** of pantograph fast-charging [1].
  * Vehicle is held at the station or layover platform until temperatures drop below **44°C** [1, 2].
* **Operational Impact**: Vehicle is taken out of passenger circulation and automatically rerouted directly to **Depot-Gamma** for Diagnostic Routine 88 (DR-88) inspection [1, 2].

---

### **State 3: Emergency Alarm (>55°C)**
* **Threshold**: Temperature surpasses **55.0°C** or thermal runaway rate exceeds **1.5°C/sec** [1].
* **Automated Actions**:
  * **Pyrofuse trip & HV Contactor Open**: Instantly disconnects high-voltage 650V circuit to isolate the battery pack [1, 2].
  * **Fire Suppression Pre-arming**: Aerosol thermal mitigation canisters are armed for automatic deployment [1].
* **Operational Impact**: Immediate emergency stop, automated audible alarm broadcast, and mandatory **passenger evacuation protocol** [1, 2].`,
    citations: [
      {
        status: 'VERIFIED',
        file_id: 'demo_file_img_3',
        filename: 'thermal_safety_flowchart.png',
        claim_text: 'State 1 (42°C-48°C) ramps pumps to 100% and throttles charging to 150 kW; State 2 (>48°C) ceases charging and reroutes to Depot-Gamma; State 3 (>55°C) triggers pyrofuse isolation and passenger evacuation.',
        is_grounded: true,
        evidence_quote: 'State 1 (42°C - 48°C) Warning Alert: Ramp coolant pumps 100%, throttle fast-charge to 150 kW. State 2 (>48°C) Critical Fault: Immediate charge cessation; reroute to Depot-Gamma. State 3 (>55°C) Emergency: Pyrofuse trip, HV contactors open, evacuation.',
        passage_number: 1,
      },
      {
        status: 'VERIFIED',
        file_id: 'demo_file_pdf_1',
        filename: 'VoltBus_Master_Operations_Engineering_Brief_Clean.pdf',
        page_number: 5,
        claim_text: 'Thermal management protocol tiers enforce automatic cooling pump overdrive and station layover cooling limits.',
        is_grounded: true,
        evidence_quote: 'Under Section 4.2 Thermal Safety Rules: State 1 Warning triggers full pump overdrive. Vehicles in State 2 must be inspected under DR-88.',
        passage_number: 2,
      },
    ],
    critic_info: {
      confidence: 'high',
      reason: 'Cross-verified across the thermal escalation flowchart logic blocks and Section 4.2 of the Master Operations Engineering Brief.',
    },
    groundedness_score: 1.0,
    retry_info: {
      retried: false,
    },
    graph_hops: [
      {
        from_node: 'Thermal Safety Flowchart',
        from_type: 'SPECIFICATION',
        relation: 'DEFINES_THRESHOLD',
        to_node: 'State 1 Warning (42°C-48°C)',
        to_type: 'SAFETY_RULE',
        filename: 'thermal_safety_flowchart.png',
        evidence: 'State 1 (42°C - 48°C) Warning Alert',
      },
      {
        from_node: 'Thermal Safety Flowchart',
        from_type: 'SPECIFICATION',
        relation: 'TRIGGERS_ACTION',
        to_node: 'State 2 Critical Fault (>48°C)',
        to_type: 'SAFETY_RULE',
        filename: 'thermal_safety_flowchart.png',
        evidence: 'Reroute to Depot-Gamma for DR-88',
      },
      {
        from_node: 'Thermal Safety Flowchart',
        from_type: 'SPECIFICATION',
        relation: 'TRIGGERS_ACTION',
        to_node: 'State 3 Emergency (>55°C)',
        to_type: 'SAFETY_RULE',
        filename: 'thermal_safety_flowchart.png',
        evidence: 'Pyrofuse trip & Evacuation Protocol',
      },
    ],
    graph_entities: ['Thermal Safety Flowchart', 'State 1 Warning', 'State 2 Critical Fault', 'State 3 Emergency', 'Depot-Gamma'],
    graph_context_text: '### 🕸️ Knowledge Graph Traversal:\n• **Thermal Safety Flowchart** ➔ `DEFINES_THRESHOLD` ➔ **State 1 Warning (42°C-48°C)**\n• **Thermal Safety Flowchart** ➔ `TRIGGERS_ACTION` ➔ **State 2 Critical Fault (>48°C)** [Depot-Gamma DR-88]\n• **Thermal Safety Flowchart** ➔ `TRIGGERS_ACTION` ➔ **State 3 Emergency (>55°C)** [Pyrofuse Isolation]',
    created_at: '2026-08-23T00:03:05Z',
  },

  // Exchange 4: Corridor Geography & Facility Responsibilities
  {
    id: 'msg_u_demo_4',
    conversation_id: 'conv_demo',
    role: 'user',
    content: 'How are facility duties divided across the transit corridor between Depot-Alpha and Depot-Gamma?',
    citations: [],
    created_at: '2026-08-23T00:04:00Z',
  },
  {
    id: 'msg_a_demo_4',
    conversation_id: 'conv_demo',
    role: 'assistant',
    content: `Based on the **Route 101 Network Map** (\`route101_network_map.png\`), the **Master Operations Brief** [1, 2], and audio debrief records [3], facility responsibilities are divided geographically across the 14.2 km corridor:

### **Transit Corridor Geography**
* **Corridor Extent**: Route 101 spans **14.2 km** across 12 smart stations, connecting **Maple Ave** in the north to **Metro Terminal Hub** in the south [1, 2].
* **Station Infrastructure**: Fast pantograph charging (450 kW) is strategically installed at high-density stops, including **Stop 7 (Oak Street)** and terminal stations [1, 2].

---

### **Division of Facility Responsibilities**
1. **Depot-Alpha (North District Facility)**:
   * **Primary Domain**: Mechanical infrastructure, structural chassis integrity, suspension, and HVAC maintenance [2].
   * **Fleet Oversight**: Routine mechanical inspections, wheel alignments, and overnight exterior staging for North District routes [2].
   * **Management**: Coordinated under Transit Operations Manager Marcus Vance [3].

2. **Depot-Gamma (South District Facility)**:
   * **Primary Domain**: High-voltage electrical powertrain, **600 kWh LFP-2 battery conditioning**, and cell resistance balancing [2, 3].
   * **Specialized Capabilities**: Dedicated battery diagnostic bays for **Diagnostic Routine 88 (DR-88)**, sensor suite calibration (LiDAR/Radar), and Perception OS firmware staging [2, 3].
   * **Lead Personnel**: Under the direct authority of Lead Electrical Technician David Miller and Chief Architect Elena Rostova [2, 3].`,
    citations: [
      {
        status: 'VERIFIED',
        file_id: 'demo_file_pdf_1',
        filename: 'VoltBus_Master_Operations_Engineering_Brief_Clean.pdf',
        page_number: 6,
        claim_text: 'Depot-Alpha handles chassis and mechanical checks; Depot-Gamma handles high-voltage battery conditioning, cell resistance balancing, and sensor calibration.',
        is_grounded: true,
        evidence_quote: 'Depot-Alpha (North District): Mechanical infrastructure, chassis inspections, HVAC. Depot-Gamma (South District): Handles battery conditioning, sensor calibration, software updates.',
        passage_number: 1,
      },
      {
        status: 'VERIFIED',
        file_id: 'demo_file_img_2',
        filename: 'route101_network_map.png',
        claim_text: 'The 14.2 km Route 101 corridor links 12 smart stations from Depot-Alpha in the north to Depot-Gamma in the south.',
        is_grounded: true,
        evidence_quote: 'Route 101 Transit Corridor: 14.2 km total length, 12 Smart Stations connecting Depot-Alpha (North) to Depot-Gamma (South).',
        passage_number: 2,
      },
      {
        status: 'VERIFIED',
        file_id: 'demo_file_aud_1',
        filename: 'voltbus_route101_debrief.mp3',
        timestamp: '01:10 - 01:45',
        claim_text: 'Marcus Vance coordinates North District fleet logistics while David Miller oversees Depot-Gamma battery diagnostics.',
        is_grounded: true,
        evidence_quote: 'Depot-Gamma is our primary hub for all high-voltage electronics and battery health diagnostics. We keep routine mechanical work at Depot-Alpha.',
        passage_number: 3,
      },
    ],
    critic_info: {
      confidence: 'high',
      reason: 'Triangulated across geographic corridor map, operations manual Section 5, and maintenance debrief recordings.',
    },
    groundedness_score: 1.0,
    retry_info: {
      retried: false,
    },
    graph_hops: [
      {
        from_node: 'Route 101',
        from_type: 'CORRIDOR',
        relation: 'TERMINATES_AT',
        to_node: 'Depot-Alpha (North)',
        to_type: 'FACILITY',
        filename: 'route101_network_map.png',
        evidence: 'North terminal anchor Depot-Alpha',
      },
      {
        from_node: 'Route 101',
        from_type: 'CORRIDOR',
        relation: 'TERMINATES_AT',
        to_node: 'Depot-Gamma (South)',
        to_type: 'FACILITY',
        filename: 'route101_network_map.png',
        evidence: 'South terminal anchor Depot-Gamma',
      },
      {
        from_node: 'Depot-Gamma',
        from_type: 'FACILITY',
        relation: 'SPECIALIZES_IN',
        to_node: 'LFP-2 Battery Pack (600 kWh)',
        to_type: 'TECH',
        filename: 'VoltBus_Master_Operations_Engineering_Brief_Clean.pdf',
        evidence: 'Sole authority for battery conditioning and DR-88',
      },
    ],
    graph_entities: ['Route 101', 'Depot-Alpha', 'Depot-Gamma', 'Marcus Vance', 'David Miller', 'LFP-2 Battery Pack'],
    graph_context_text: '### 🕸️ Knowledge Graph Traversal:\n• **Route 101** ➔ `NORTH_TERMINUS` ➔ **Depot-Alpha** [Mechanical & Chassis]\n• **Route 101** ➔ `SOUTH_TERMINUS` ➔ **Depot-Gamma** [HV Battery & Sensor Diagnostics]\n• **Depot-Gamma** ➔ `SPECIALIZES_IN` ➔ **LFP-2 Battery Conditioning (DR-88)**',
    created_at: '2026-08-23T00:04:05Z',
  },

  // Exchange 5: Hardware Blueprint & Specifications
  {
    id: 'msg_u_demo_5',
    conversation_id: 'conv_demo',
    role: 'user',
    content: 'What are the exact voltage, capacity, motor drivetrain, and sensor specifications shown on the VoltBus V3 schematic?',
    citations: [],
    created_at: '2026-08-23T00:05:00Z',
  },
  {
    id: 'msg_a_demo_5',
    conversation_id: 'conv_demo',
    role: 'assistant',
    content: `According to the **VoltBus V3 Hardware Schematic** (\`voltbus_v3_schematic.png\`) and the **Engineering Specifications Section** [1, 2], the vehicle specifications include:

### **1. Powertrain & High-Voltage Battery Architecture**
* **Nominal Voltage**: **650V DC** nominal bus voltage [1].
* **Battery Capacity**: **923 Ah total capacity**, delivering **600 kWh storage** via dual under-floor liquid-cooled LFP-2 modules [1, 2].
* **Charging Interface**: Top-mounted inverted pantograph mechanism capable of receiving up to **450 kW DC** fast charge [1].

---

### **2. Drivetrain & Motors**
* **Motor Setup**: **4x 150 kW Permanent Magnet Synchronous Motors (PMSM)** configured for independent wheel-hub or dual-axle electronic all-wheel drive (AWD) [1, 2].
* **Total Peak Power Output**: **600 kW** (approx. 805 hp) with integrated regenerative braking up to 250 kW [1].
* **Chassis & Body**: 12-meter lightweight extruded aluminum monocoque with low-floor step-free passenger boarding [1].

---

### **3. Autonomous Sensor Suite & Edge Compute**
* **LiDAR Array**: 4x 128-beam solid-state LiDAR domes providing 360° point cloud coverage [1].
* **Vision & Radar**: 8 high-dynamic-range (HDR) automotive cameras and 2 long-range 77 GHz millimetric radar units [1].
* **Onboard Intelligence**: Redundant Edge AI Compute Node executing **Perception OS 4.2** with a hardware-isolated **Safety Override Engine (SOE)** [1, 2].`,
    citations: [
      {
        status: 'VERIFIED',
        file_id: 'demo_file_img_1',
        filename: 'voltbus_v3_schematic.png',
        claim_text: 'The VoltBus V3 features 650V nominal voltage, 923 Ah / 600 kWh LFP-2 battery, 4x 150 kW PMSM motors, and 4x 128-beam LiDAR domes.',
        is_grounded: true,
        evidence_quote: '650V Nominal Voltage, 923 Ah, 600 kWh LFP-2 Battery; 4x 150 kW PMSM Electric Drive; 450 kW Inverted Pantograph; 4x 128-beam LiDAR; Perception OS 4.2 Node.',
        passage_number: 1,
      },
      {
        status: 'VERIFIED',
        file_id: 'demo_file_pdf_1',
        filename: 'VoltBus_Master_Operations_Engineering_Brief_Clean.pdf',
        page_number: 4,
        claim_text: 'Vehicle engineering section confirms 600 kW total drivetrain output and Safety Override Engine fail-safe integration.',
        is_grounded: true,
        evidence_quote: 'Section 3.1 Drivetrain Specs: 4x 150 kW PMSM drive units deliver 600 kW combined peak power, managed by Perception OS 4.2 with hardware SOE isolation.',
        passage_number: 2,
      },
    ],
    critic_info: {
      confidence: 'high',
      reason: 'Fully validated against the VoltBus V3 engineering blueprint schematic annotations and Section 3.1 technical specifications.',
    },
    groundedness_score: 1.0,
    retry_info: {
      retried: false,
    },
    graph_hops: [
      {
        from_node: 'VoltBus V3',
        from_type: 'PROJECT',
        relation: 'POWERED_BY',
        to_node: 'LFP-2 Battery Pack (600 kWh / 650V)',
        to_type: 'TECH',
        filename: 'voltbus_v3_schematic.png',
        evidence: '650V nominal, 923 Ah, 600 kWh battery pack',
      },
      {
        from_node: 'VoltBus V3',
        from_type: 'PROJECT',
        relation: 'DRIVEN_BY',
        to_node: 'PMSM Motors (4x 150 kW)',
        to_type: 'TECH',
        filename: 'voltbus_v3_schematic.png',
        evidence: '4x 150 kW Permanent Magnet Synchronous Motors',
      },
      {
        from_node: 'VoltBus V3',
        from_type: 'PROJECT',
        relation: 'CONTROLLED_BY',
        to_node: 'Perception OS 4.2 & SOE Node',
        to_type: 'SOFTWARE',
        filename: 'voltbus_v3_schematic.png',
        evidence: 'Perception OS 4.2 Compute Node with Safety Override Engine',
      },
    ],
    graph_entities: ['VoltBus V3', 'LFP-2 Battery Pack', 'PMSM Motors', 'Perception OS 4.2', 'Safety Override Engine', 'LiDAR Suite'],
    graph_context_text: '### 🕸️ Knowledge Graph Traversal:\n• **VoltBus V3** ➔ `POWERED_BY` ➔ **LFP-2 Battery (600 kWh / 650V / 923 Ah)** [voltbus_v3_schematic.png]\n• **VoltBus V3** ➔ `DRIVEN_BY` ➔ **PMSM Motors (4x 150 kW = 600 kW Peak)** [voltbus_v3_schematic.png]\n• **VoltBus V3** ➔ `CONTROLLED_BY` ➔ **Perception OS 4.2 Compute Node & SOE** [VoltBus_Master_Operations_Engineering_Brief_Clean.pdf]',
    created_at: '2026-08-23T00:05:05Z',
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
    const cached = _msgsCache['conv_demo']
    if (cached && cached.length >= CANONICAL_DEMO_MESSAGES.length) {
      return cached
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
