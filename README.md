# TraceRAG — Self-Correcting Multimodal RAG with Adaptive Knowledge Graph Reasoning

<p align="left">
  <img src="https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi&logoColor=white" />
  <img src="https://img.shields.io/badge/React_18-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Google_Gemini_2.5-8E75C2?style=for-the-badge&logo=google&logoColor=white" />
  <img src="https://img.shields.io/badge/Qdrant_Vector_DB-DC2626?style=for-the-badge&logo=qdrant&logoColor=white" />
  <img src="https://img.shields.io/badge/Supabase_Postgres-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" />
  <img src="https://img.shields.io/badge/NetworkX_Graph-4B8BBE?style=for-the-badge&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge" />
</p>

> **TraceRAG** is a production-grade multimodal RAG framework designed to minimize hallucinations across documents, OCR schematics, and timestamped audio/video. It combines hybrid dense-lexical retrieval and multi-hop Knowledge Graph reasoning with an autonomous reflection critic that detects ungrounded claims, triggers re-retrieval, and provides verifiable, interactive citations.


---

## ✨ Features

| Feature | Details |
|---|---|
| **Multimodal Ingestion** | PDF, DOCX, TXT, images (OCR), audio (Whisper), video (frame + audio) |
| **Hybrid Retrieval** | Dense (Qdrant) + Sparse (BM25) + LLM router |
| **Self-Correcting RAG** | Critic grading → automatic query reformulation on low confidence |
| **Knowledge Graph** | Auto-extracted entity graph with multi-hop traversal |
| **Auth** | Supabase email/password — each user sees only their own data |
| **Deployment Ready** | Railway (backend) + Vercel (frontend) one-click |

---

## 🏗️ Architecture

```
TraceRAG/
├── backend/
│   ├── main.py                   # FastAPI app, CORS, structured logging
│   ├── config.py                 # Pydantic Settings
│   ├── auth.py                   # JWT verification middleware (Phase 8)
│   ├── storage.py                # Supabase Storage + Postgres helpers
│   ├── schema.sql                # Initial DB schema
│   ├── auth_schema.sql           # Phase 8: user_id columns + RLS policies
│   ├── ingest/                   # Multimodal extractors (PDF, image, audio, video)
│   ├── pipeline/                 # Hybrid retrieval, vector store, BM25
│   ├── graph/                    # Knowledge Graph engine + extractor
│   ├── synthesis/                # RAG + Critic pipeline
│   └── routes/                   # FastAPI routers
├── frontend/
│   ├── src/
│   │   ├── api/                  # Typed API clients (auth, files, query, graph...)
│   │   ├── components/           # React UI components
│   │   │   ├── AuthGate.tsx      # Login / Sign-up screen
│   │   │   ├── ChatSynthesisView.tsx
│   │   │   ├── FileManager.tsx
│   │   │   ├── KnowledgeGraphViewer.tsx
│   │   │   └── ...
│   │   └── App.tsx
│   ├── .env                      # Frontend env vars (VITE_*)
│   └── vercel.json               # Vercel SPA routing
├── .env.example                  # Backend env template
├── requirements.txt
├── railway.json                  # Railway deployment config
└── Procfile
```

---

## ⚙️ Setup Guide

### 1. Prerequisites

| Tool | How to install |
|---|---|
| Python 3.11+ | [python.org](https://www.python.org/downloads/) |
| Node.js 18+ | [nodejs.org](https://nodejs.org/) |
| Tesseract OCR | `winget install UB-Mannheim.TesseractOCR` |
| FFmpeg | `winget install Gyan.FFmpeg` |
| Docker (optional) | For local Qdrant |

---

### 2. Clone & Install

```powershell
# Backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Frontend
cd frontend
npm install
```

---

### 3. Supabase Setup

#### A. Create Project
1. Go to [supabase.com](https://supabase.com) → **New Project**.
2. Note your **Project URL** and **API keys** from **Project Settings → API**.

#### B. Create Storage Bucket
1. **Storage** → **New bucket** → name it `trace-files`.
2. Set to **Private** (recommended — the backend uses the service role key for signed URLs).

#### C. Run Database Migrations
Open **SQL Editor** in the Supabase Dashboard and run these files in order:

1. [`backend/schema.sql`](backend/schema.sql) — Creates `conversations`, `files`, `messages` tables.
2. [`backend/auth_schema.sql`](backend/auth_schema.sql) — Adds `user_id` columns + Row Level Security policies.

#### D. Enable Email Auth
1. **Authentication → Providers → Email** → Enable **Email/Password**.
2. (Optional) Disable email confirmation for easier local testing: **Auth → Settings → Disable email confirmations**.

---

### 4. Qdrant Vector DB

**Option A — Local (Docker):**
```powershell
docker run -p 6333:6333 -v qdrant_storage:/qdrant/storage qdrant/qdrant
```

**Option B — Cloud:**
Create a free cluster at [cloud.qdrant.io](https://cloud.qdrant.io) and copy the URL + API key.

---

### 5. Environment Variables

**Backend — copy and fill `.env`:**
```powershell
Copy-Item .env.example .env
```

| Variable | Where to find it | Required |
|---|---|---|
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com/app/apikey) | ✅ |
| `SUPABASE_URL` | Supabase → Project Settings → API | ✅ |
| `SUPABASE_KEY` | Supabase → anon/public key | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → service_role key | ✅ |
| `SUPABASE_JWT_SECRET` | Supabase → Project Settings → API → JWT Secret | 🔐 prod only |
| `QDRANT_URL` | Local: `http://localhost:6333` / Cloud URL | ✅ |
| `QDRANT_API_KEY` | Cloud Qdrant only | ⬜ |
| `FRONTEND_URL` | Your Vercel URL (production) | 🔐 prod only |

**Frontend — `frontend/.env`:**
```env
VITE_API_URL=http://localhost:8000
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

---

### 6. Run Locally

```powershell
# Terminal 1 — Backend
uvicorn backend.main:app --reload --port 8000

# Terminal 2 — Frontend
cd frontend
npm run dev
```

Open **http://localhost:3000** → Sign up → Start uploading files.

---

---

## 🗺️ Interactive App Tour & Navigation Guide

TraceRAG provides an inspectable, 4-tab unified workspace designed for multimodal analysis and self-correcting RAG exploration.

### 1. 📁 **Files & Multimodal Ingest (`Files & Ingest` Tab)**
* **Pre-Seeded Demo Dataset**: Loads with 5 multimodal files covering the **VoltBus Route 101** engineering incident:
  * ![Document](https://img.shields.io/badge/%F0%9F%93%84_PDF-0284C7?style=flat-square) `VoltBus_Master_Operations_Engineering_Brief_Clean.pdf` *(Operations manuals & tolerances)*
  * ![Vision OCR](https://img.shields.io/badge/%F0%9F%96%BC%EF%B8%8F_Vision_OCR-EAB308?style=flat-square) `voltbus_v3_schematic.png` *(Hardware wiring schematics & pinout layouts)*
  * ![Vision OCR](https://img.shields.io/badge/%F0%9F%96%BC%EF%B8%8F_Vision_OCR-EAB308?style=flat-square) `thermal_safety_flowchart.png` *(Logic flowcharts & emergency bypass conditions)*
  * ![Vision OCR](https://img.shields.io/badge/%F0%9F%96%BC%EF%B8%8F_Vision_OCR-EAB308?style=flat-square) `route101_network_map.png` *(Route geographical network topologies)*
  * ![Audio](https://img.shields.io/badge/%F0%9F%8E%B5_Whisper_Audio-F97316?style=flat-square) `voltbus_route101_debrief.mp3` *(Recorded engineer debrief audio with timestamps)*
* **Universal Upload**: Drag & drop custom PDFs, Word (`.docx`), TXT, PNG/JPG images, or MP3/WAV/MP4 audio/video files.
* **In-App File Viewer**: Click **`VIEW ↗`** on any card to launch the modal with zoomable OCR visuals, extracted text views, and audio playback.

---

### 2. 💬 **AI Chat & Grounded Synthesis (`Chat & Synthesis` Tab)**
* **Ask Questions**: Query across your ingested files (e.g., *"What safety thresholds caused the throttling on Route 101?"*).
* **Live 5-Stage Pipeline Badge Stream**:

<p align="left">
  <img src="https://img.shields.io/badge/1._Intent_%26_Routing-3B82F6?style=flat-square&logo=compass&logoColor=white" /> ➔
  <img src="https://img.shields.io/badge/2._Hybrid_Retrieval-06B6D4?style=flat-square&logo=search&logoColor=white" /> ➔
  <img src="https://img.shields.io/badge/3._Graph_Multi--Hop-8B5CF6?style=flat-square&logo=graphql&logoColor=white" /> ➔
  <img src="https://img.shields.io/badge/4._Critic_Grading-EC4899?style=flat-square&logo=shield&logoColor=white" /> ➔
  <img src="https://img.shields.io/badge/5._Cited_Synthesis-10B981?style=flat-square&logo=sparkles&logoColor=white" />
</p>

* **Verifiable Inline Citations**: Click any citation badge (`[Doc 1: Page 4]`, `[Img 2: Schematic]`, `[Aud 1: 02:18]`) to view exact source context or jump to the audio second offset.
* **Critic Hallucination Grading**: Expand the Critic badge above any response to inspect the atomic claim verification matrix, factual groundedness score, and auto-correction retries.

---

### 3. 🔍 **Router & Retrieval Inspector (`Retrieval Inspector` Tab)**
* **Real-Time Score Breakdown**: Inspect exact mathematical score balances:
  * ![Dense](https://img.shields.io/badge/Dense_Vector_Cosine-3B82F6?style=flat-square) (Qdrant semantic vector space)
  * ![BM25](https://img.shields.io/badge/BM25_Lexical_Score-06B6D4?style=flat-square) (Exact term frequency & keyword matching)
  * ![Modality](https://img.shields.io/badge/LLM_Modality_Routing-8B5CF6?style=flat-square) (Document, Image OCR, Audio transcript, Video frames)
* **Chunk Tier Ratings**: Highlights chunks classified as:
  * ![HIGH](https://img.shields.io/badge/HIGH_%E2%97%8F-10B981?style=flat-square) *High Semantic & Keyword Relevance*
  * ![MEDIUM](https://img.shields.io/badge/MEDIUM_%E2%97%91-F59E0B?style=flat-square) *Moderate Contextual Overlap*
  * ![LOW](https://img.shields.io/badge/LOW_%E2%97%8B-EF4444?style=flat-square) *Filtered Noise / Low Weight*

---

### 4. 🕸️ **Adaptive Knowledge Graph (`Knowledge Graph` Tab)**
* **Interactive 2D Physics Canvas**: Explore a NetworkX force-directed graph with **199+ nodes and 178+ cross-file relationships**.
* **Entity Neighborhoods**: Click any entity node to inspect its connected relations, source files, and evidence snippets.
* **Multi-Hop Path Tracer**: Select any **Entity A** and **Entity B** to compute and visualize the shortest reasoning chain:
  > ![Start](https://img.shields.io/badge/Entity_A-3B82F6?style=flat-square) ➔ ![Relay](https://img.shields.io/badge/Multi--Hop_Relay_Node-8B5CF6?style=flat-square) ➔ ![Target](https://img.shields.io/badge/Entity_B-10B981?style=flat-square)

---

### 5. 🔒 **Workspaces & Guest Mode**
* ![Guest](https://img.shields.io/badge/Guest_Mode-64748B?style=flat-square) **Zero-setup exploration** using the pre-loaded canonical VoltBus workspace.
* ![Auth](https://img.shields.io/badge/Authenticated_Mode-6366F1?style=flat-square) Click **`✨ Sign In / Sign Up`** to create private, isolated conversation sessions with persistent Supabase storage and independent Knowledge Graphs.

---

## 🚀 Live Deployment & Cloud Architecture

TraceRAG is fully configured for continuous deployment:

| Component | Platform | Configuration |
|---|---|---|
| **Frontend Web App** | **Vercel** | SPA routing via `frontend/vercel.json`, auto-deployed from `main` |
| **Backend API Engine** | **Railway** | FastAPI containerized with `railway.json` + `Procfile` |
| **Database & Auth** | **Supabase** | Postgres database with Row-Level Security (RLS) & S3-compatible file storage |
| **Vector Index** | **Qdrant** | High-dimensional HNSW cosine vector index |

### Quick API Health Check:
```bash
# Verify backend deployment health
curl https://your-backend.up.railway.app/health
# Returns: {"status": "healthy", "version": "0.8.0", "llm_provider": "gemini"}
```

---

## 📊 API Reference

Interactive OpenAPI documentation is available at `/docs` on the running backend:

| Endpoint | Method | Description |
|---|---|---|
| `/health` | `GET` | Service status and LLM/Supabase configuration readiness |
| `/api/files/upload` | `POST` | Upload and extract multimodal files (PDF, PNG, MP3, MP4) |
| `/api/files` | `GET` | List files and extraction statuses for a conversation |
| `/api/files/{id}` | `DELETE` | Delete a file from storage and prune graph/vector indices |
| `/api/conversations` | `GET/POST` | List user workspaces or optimistically create new sessions |
| `/api/query/stream` | `POST` | Server-Sent Events (SSE) streaming cited RAG generation |
| `/api/graph/{conv_id}` | `GET` | Fetch conversation Knowledge Graph nodes, edges, and statistics |
| `/api/graph/traverse` | `POST` | Execute multi-hop Dijkstra pathfinding between entities |
| `/api/retrieval/query` | `POST` | Inspect hybrid dense+sparse retrieval weights and scores |

