# TraceRAG — Self-Correcting Multimodal RAG with Adaptive Knowledge Graph Reasoning

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

## 🚀 Deployment

### Backend → Railway

1. Push your repo to GitHub.
2. Go to [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**.
3. Railway auto-detects `railway.json` and `Procfile`.
4. Set environment variables in Railway **Variables** tab (all values from your `.env`).
5. Set `FRONTEND_URL` to your Vercel URL (after frontend deploy).
6. Note your Railway URL (e.g., `https://trace-rag-backend.up.railway.app`).

### Frontend → Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project → Import from GitHub**.
2. Set **Root Directory** to `frontend`.
3. Set environment variables:
   - `VITE_API_URL` → Your Railway backend URL
   - `VITE_SUPABASE_URL` → Your Supabase URL
   - `VITE_SUPABASE_ANON_KEY` → Your Supabase anon key
4. Deploy.

### Post-Deploy Checklist

- [ ] `https://your-backend.up.railway.app/health` returns `{"status": "healthy"}`
- [ ] Set `FRONTEND_URL` in Railway to your Vercel URL and redeploy backend
- [ ] Set `SUPABASE_JWT_SECRET` in Railway → auth becomes fully enforced
- [ ] Sign up and verify you can upload files, query, and see the Knowledge Graph

---

## 🛡️ Security Notes

- The backend uses the **service role key** (bypasses RLS) for all DB operations — keep it secret.
- RLS policies ensure users can only access their own data **via the Supabase anon client** (frontend auth).
- Setting `SUPABASE_JWT_SECRET` enables backend JWT verification — without it, all routes are open (fine for local dev).
- Never commit `.env` to source control.

---

## 📊 API Reference

Interactive docs available at `/docs` when the backend is running.

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Service status and config check |
| `/api/files/upload` | POST | Upload files (multipart/form-data) |
| `/api/files` | GET | List files for a conversation |
| `/api/files/{id}` | DELETE | Delete a file |
| `/api/conversations` | GET/POST | List or create conversations |
| `/api/query/stream` | POST | Streaming RAG query |
| `/api/graph/{conv_id}` | GET | Get Knowledge Graph data |
| `/api/graph/traverse` | POST | Multi-hop graph traversal |
| `/api/retrieval/query` | POST | Test hybrid retrieval |
