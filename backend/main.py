import time
import uuid
import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from backend.config import get_settings
from backend.routes.files import router as files_router
from backend.routes.conversations import router as conversations_router
from backend.routes.retrieval import router as retrieval_router
from backend.routes.graph import router as graph_router
from backend.routes.query import router as query_router

# ── Structured Logging Setup ──────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("trace.main")

settings = get_settings()

app = FastAPI(
    title="Trace RAG Backend",
    description="Self-correcting multimodal RAG assistant API",
    version="0.8.0",
)

# ── CORS ─────────────────────────────────────────────────────────────────────
# In production, restrict to the exact frontend origin.
# In dev (no FRONTEND_URL set), allow both localhost ports.
_allowed_origins: list[str] = [
    "http://localhost:3000",
    "http://localhost:5173",
]
if settings.frontend_url and settings.frontend_url not in _allowed_origins:
    _allowed_origins.append(settings.frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response Logging Middleware ─────────────────────────────────────
@app.middleware("http")
async def log_requests(request: Request, call_next):
    req_id = str(uuid.uuid4())[:8]
    start = time.perf_counter()
    logger.info(f"[{req_id}] → {request.method} {request.url.path}")
    try:
        response = await call_next(request)
        elapsed = (time.perf_counter() - start) * 1000
        logger.info(f"[{req_id}] ← {response.status_code} ({elapsed:.1f}ms)")
        response.headers["X-Request-ID"] = req_id
        return response
    except Exception as exc:
        elapsed = (time.perf_counter() - start) * 1000
        logger.error(f"[{req_id}] ✗ Unhandled exception after {elapsed:.1f}ms: {exc}")
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})


# ── API Routes ────────────────────────────────────────────────────────────────
app.include_router(files_router, prefix="/api")
app.include_router(conversations_router, prefix="/api")
app.include_router(retrieval_router, prefix="/api")
app.include_router(graph_router, prefix="/api")
app.include_router(query_router, prefix="/api")


@app.get("/")
def root():
    return {
        "app": "Trace RAG API",
        "status": "online",
        "version": "0.8.0",
        "docs": "/docs",
    }


@app.get("/health")
def health_check():
    """Health check endpoint displaying configuration readiness."""
    llm_configured = bool(
        (settings.llm_provider == "gemini" and settings.gemini_api_key)
        or (settings.llm_provider == "anthropic" and settings.anthropic_api_key)
    )
    auth_enabled = bool(settings.supabase_jwt_secret)

    return {
        "status": "healthy",
        "version": "0.8.0",
        "llm_provider": settings.llm_provider,
        "llm_configured": llm_configured,
        "gemini_model": settings.gemini_model if settings.llm_provider == "gemini" else None,
        "claude_model": settings.anthropic_model if settings.llm_provider == "anthropic" else None,
        "supabase_configured": bool(
            settings.supabase_url
            and (settings.supabase_key or settings.supabase_service_role_key)
        ),
        "supabase_bucket": settings.supabase_storage_bucket,
        "auth_enabled": auth_enabled,
        "qdrant_url": settings.qdrant_url,
        "max_upload_size_mb": settings.max_upload_size_mb,
        "max_files_per_conversation": settings.max_files_per_conversation,
        "allowed_file_types": settings.allowed_file_types,
    }
