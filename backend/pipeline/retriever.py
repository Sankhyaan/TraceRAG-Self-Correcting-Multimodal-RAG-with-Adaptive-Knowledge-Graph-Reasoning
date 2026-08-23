import re
import logging
from typing import List, Dict, Any, Optional
from backend.storage import get_supabase
from backend.pipeline.chunker import chunker, DocumentChunk
from backend.pipeline.embeddings import embedding_engine
from backend.pipeline.vector_store import vector_store
from backend.pipeline.bm25_index import bm25_manager, tokenize, ORDINAL_MAP, STOPWORDS
from backend.pipeline.router import query_router

logger = logging.getLogger("trace.retriever")

# Minimum normalized score (0–100 scale) for a chunk to be non-ghost
GHOST_SCORE_THRESHOLD = 8.0  # i.e. 8%


def expand_query_terms(query: str) -> str:
    """Universal query expansion for ordinals."""
    tokens = re.findall(r"\b\w+\b", query.lower())
    expansions = []
    for tok in tokens:
        if tok in ORDINAL_MAP:
            expansions.append(ORDINAL_MAP[tok])
    if expansions:
        return query + " " + " ".join(expansions)
    return query


def _min_max_normalize(values: List[float]) -> List[float]:
    """Min-Max normalize a list of floats to [0, 1]. Returns 1.0 for all if max == min > 0."""
    if not values:
        return values
    mn, mx = min(values), max(values)
    if mx == mn:
        return [1.0 if mx > 0 else 0.0 for _ in values]
    return [(v - mn) / (mx - mn) for v in values]


def _confidence_tier(pct: float) -> str:
    """Map 0-100 normalized score to a confidence tier label."""
    if pct >= 70.0:
        return "HIGH"
    if pct >= 40.0:
        return "MEDIUM"
    return "LOW"


class HybridRetriever:
    """
    Generalized Hybrid Retriever using Reciprocal Rank Fusion (RRF),
    Dense Vector Similarity (Qdrant), Sparse Keyword Search (BM25Plus),
    Coordination Matching, and Modality Routing.

    Scores are Min-Max normalized to a 0-100% scale for display.
    Ghost chunks (router-requested modalities with no quality results) are reported
    separately in `modality_gaps` rather than being padded into results.
    """

    def index_file(
        self,
        file_id: str,
        conversation_id: str,
        filename: str,
        file_type: str,
        extracted_text: str,
    ) -> List[DocumentChunk]:
        """
        Chunks extracted text, embeds with Sentence-Transformers, and indexes in Qdrant & BM25.
        """
        if not extracted_text or not extracted_text.strip():
            return []

        chunks = chunker.chunk_document(
            file_id=file_id,
            conversation_id=conversation_id,
            filename=filename,
            file_type=file_type,
            text=extracted_text,
        )
        if not chunks:
            return []

        chunk_texts = [c.text for c in chunks]
        vectors = embedding_engine.embed_texts(chunk_texts)
        vector_store.upsert_chunks(chunks, vectors)
        bm25_manager.add_chunks(conversation_id, chunks)

        logger.info(f"Indexed {len(chunks)} chunks for file '{filename}' in Qdrant & BM25.")
        return chunks

    def reindex_conversation(self, conversation_id: str):
        """Wipes in-memory cache and re-indexes all extracted files for the conversation."""
        bm25_manager.clear_conversation(conversation_id)
        vector_store.delete_conversation_chunks(conversation_id)
        self.index_conversation_if_needed(conversation_id, force=True)

    def index_conversation_if_needed(self, conversation_id: str, force: bool = False):
        """
        Backfills lightweight in-memory BM25 index for conversation files in < 50ms
        without slow re-embedding.
        """
        bm25_idx = bm25_manager.get_index(conversation_id)
        if bm25_idx.chunks and not force:
            return

        try:
            sb = get_supabase()
            res = (
                sb.table("files")
                .select("id, conversation_id, filename, file_type, extracted_text")
                .eq("conversation_id", conversation_id)
                .execute()
            )
            for row in res.data or []:
                text = row.get("extracted_text")
                if text and text.strip():
                    chunks = chunker.chunk_document(
                        file_id=row["id"],
                        conversation_id=row["conversation_id"],
                        filename=row["filename"],
                        file_type=row.get("file_type", "document"),
                        text=text,
                    )
                    if chunks:
                        bm25_manager.add_chunks(conversation_id, chunks)
        except Exception as e:
            logger.warning(f"Notice hydrating BM25 index: {str(e)}")

    def retrieve(
        self,
        conversation_id: str,
        query: str,
        top_k: int = 5,
        alpha: float = 0.5,
        use_router: bool = True,
        rrf_k: int = 40,
    ) -> Dict[str, Any]:
        """
        Executes Reciprocal Rank Fusion (RRF) combining Dense Vector and BM25 search
        with Coordination Level Matching.

        Scores are Min-Max normalized to 0-100% for the Inspector UI.
        Ghost chunk detection prevents low-relevance filler from appearing.
        """
        self.index_conversation_if_needed(conversation_id)
        expanded_query = expand_query_terms(query)

        # ── 1. Modality Intent Routing ──────────────────────────────────────
        routing_info = query_router.route_query(query) if use_router else {
            "primary_categories": ["document", "image", "audio", "video"],
            "weights": {"document": 0.5, "image": 0.5, "audio": 0.5, "video": 0.5},
            "rationale": "Router disabled; balanced search across all modalities.",
            "intent_label": "Balanced",
        }
        raw_weights = routing_info.get("weights", {})
        routed_categories = list(routing_info.get("primary_categories", []))
        router_intent_label = routing_info.get("intent_label", "Document (PDF/Docx)")

        # ── 2. Dense Vector Search (Qdrant) ─────────────────────────────────
        query_vector = embedding_engine.embed_query(expanded_query)
        dense_hits = vector_store.search(
            query_vector=query_vector,
            conversation_id=conversation_id,
            limit=top_k * 6,
        )

        # ── 3. Sparse Keyword Search (BM25Plus) ─────────────────────────────
        bm25_hits = bm25_manager.search(
            conversation_id=conversation_id,
            query=expanded_query,
            top_k=top_k * 6,
        )

        query_concepts = set(tokenize(query, remove_stopwords=True, apply_stem=True))

        # Active File Validation + Modality Census
        # Fetch id AND file_type in a single query so we can:
        #   (a) prevent retrieval of deleted-file chunks
        #   (b) clamp router weights to 0% for modalities with zero uploaded files
        try:
            sb = get_supabase()
            sb_res = (
                sb.table("files")
                .select("id, file_type")
                .eq("conversation_id", conversation_id)
                .execute()
            )
            active_file_ids: set = set()
            uploaded_modalities: set = set()  # modalities that actually have files
            for row in sb_res.data or []:
                active_file_ids.add(row["id"])
                ft = (row.get("file_type") or "document").lower()
                uploaded_modalities.add(ft)
        except Exception:
            active_file_ids = set()
            uploaded_modalities = {"document", "audio", "image", "video"}  # fail-open

        # Clamp router weights: zero out any modality with zero uploaded files
        clamped_weights: Dict[str, float] = {}
        for mod, w in raw_weights.items():
            clamped_weights[mod] = w if mod in uploaded_modalities else 0.0
        weights = clamped_weights

        # ── 4. Build Chunk Map ──────────────────────────────────────────────
        chunk_map: Dict[str, Dict[str, Any]] = {}

        for rank, h in enumerate(dense_hits):
            if active_file_ids and h.get("file_id") not in active_file_ids:
                try:
                    vector_store.delete_file_chunks(h["file_id"])
                except Exception:
                    pass
                continue
            cid = h["chunk_id"]
            chunk_map[cid] = {
                "chunk_id": cid,
                "file_id": h["file_id"],
                "conversation_id": h["conversation_id"],
                "filename": h["filename"],
                "file_type": h["file_type"],
                "chunk_index": h["chunk_index"],
                "text": h["text"],
                "timestamp": h["timestamp"],
                "page_number": h["page_number"],
                "dense_rank": rank + 1,
                "bm25_rank": None,
                "dense_raw_score": h["score"],
                "bm25_raw_score": 0.0,
                "metadata": h["metadata"],
            }

        for rank, (chunk, bm25_score) in enumerate(bm25_hits):
            if active_file_ids and chunk.file_id not in active_file_ids:
                try:
                    bm25_manager.remove_file(conversation_id, chunk.file_id)
                except Exception:
                    pass
                continue
            cid = chunk.id
            if cid in chunk_map:
                chunk_map[cid]["bm25_rank"] = rank + 1
                chunk_map[cid]["bm25_raw_score"] = bm25_score
            else:
                chunk_map[cid] = {
                    "chunk_id": cid,
                    "file_id": chunk.file_id,
                    "conversation_id": chunk.conversation_id,
                    "filename": chunk.filename,
                    "file_type": chunk.file_type,
                    "chunk_index": chunk.chunk_index,
                    "text": chunk.text,
                    "timestamp": chunk.timestamp,
                    "page_number": chunk.page_number,
                    "dense_rank": None,
                    "bm25_rank": rank + 1,
                    "dense_raw_score": 0.0,
                    "bm25_raw_score": bm25_score,
                    "metadata": chunk.metadata,
                }

        # ── 5. RRF + Coordination Scoring ───────────────────────────────────
        max_possible_rrf = 1.0 / (rrf_k + 1)
        ranked_chunks: List[Dict[str, Any]] = []

        for cid, item in chunk_map.items():
            f_type = item["file_type"]
            modality_weight = weights.get(f_type, 0.5)

            dense_component = (alpha / (rrf_k + item["dense_rank"])) if item["dense_rank"] is not None else 0.0
            bm25_component = ((1.0 - alpha) / (rrf_k + item["bm25_rank"])) if item["bm25_rank"] is not None else 0.0
            raw_rrf = dense_component + bm25_component
            normalized_rrf = raw_rrf / max_possible_rrf if max_possible_rrf > 0 else 0.0

            chunk_tokens = set(tokenize(item["text"], remove_stopwords=True, apply_stem=True))
            total_query_weight = sum(bm25_manager.get_idf(conversation_id, qc) for qc in query_concepts)
            matched_weight = sum(
                bm25_manager.get_idf(conversation_id, qc) for qc in query_concepts
                if qc in chunk_tokens or (qc in ORDINAL_MAP and ORDINAL_MAP[qc] in chunk_tokens)
            )
            coordination_ratio = matched_weight / total_query_weight if total_query_weight > 0 else 1.0

            modality_boost = (modality_weight - 0.5) * 0.15

            if query_concepts and coordination_ratio <= 0.2:
                coordination_factor = 0.05
            else:
                coordination_factor = 0.4 + (0.6 * (coordination_ratio ** 0.6)) if query_concepts else 1.0

            raw_combined = ((normalized_rrf * 0.45) + (coordination_ratio * 0.45) + modality_boost) * coordination_factor
            raw_score = max(0.0, min(1.0, raw_combined))

            item["_raw_final"] = raw_score
            item["coordination_ratio"] = round(coordination_ratio, 4)
            item["modality_boost"] = round(modality_boost, 4)
            ranked_chunks.append(item)

        # ── 6. Min-Max Normalization across all candidates ──────────────────
        raw_finals = [c["_raw_final"] for c in ranked_chunks]
        raw_denss  = [c["dense_raw_score"] for c in ranked_chunks]
        raw_bm25s  = [c["bm25_raw_score"] for c in ranked_chunks]

        norm_finals = _min_max_normalize(raw_finals)
        norm_denss  = _min_max_normalize(raw_denss)
        norm_bm25s  = _min_max_normalize(raw_bm25s)

        for i, item in enumerate(ranked_chunks):
            item["final_score"]     = round(item["_raw_final"], 4)       # raw [0-1] kept for pipeline compat
            item["final_score_pct"] = round(norm_finals[i] * 100, 1)    # normalized 0-100
            item["dense_score"]     = round(item["dense_raw_score"], 4)
            item["dense_score_pct"] = round(norm_denss[i] * 100, 1)
            item["bm25_score"]      = round(item["bm25_raw_score"], 4)
            item["bm25_score_pct"]  = round(norm_bm25s[i] * 100, 1)
            item["confidence_tier"] = _confidence_tier(item["final_score_pct"])
            item.pop("_raw_final", None)

        # Sort descending by normalized final score
        ranked_chunks.sort(key=lambda x: x["final_score_pct"], reverse=True)
        top_chunks = ranked_chunks[:top_k]

        # ── 7. Ghost Chunk / Modality Gap Detection ──────────────────────────
        modality_gaps: List[Dict[str, str]] = []
        non_conv_categories = [c for c in routed_categories if c != "conversational"]
        if non_conv_categories:
            for modality in non_conv_categories:
                # Case A: Modality was requested by router, but NO files of this modality exist in the conversation
                if modality not in uploaded_modalities:
                    modality_gaps.append({
                        "modality": modality,
                        "status": "no_matching_chunks",
                        "message": f"No matching {modality} context found",
                    })
                    continue

                # Case B: Files exist, but no chunks reached the relevance quality threshold
                modality_chunks = [c for c in ranked_chunks if c["file_type"] == modality]
                has_quality = any(c["final_score_pct"] >= GHOST_SCORE_THRESHOLD for c in modality_chunks)
                if not has_quality or not modality_chunks:
                    modality_gaps.append({
                        "modality": modality,
                        "status": "no_matching_chunks",
                        "message": f"No matching {modality} context found",
                    })

        # ── 8. Multi-hop graph traversal ─────────────────────────────────────
        multihop_data = None
        try:
            from backend.graph.traverser import multi_hop_traverser
            mh_res = multi_hop_traverser.traverse(conversation_id, query)
            if mh_res and (mh_res.is_multihop or mh_res.detected_entities or mh_res.paths):
                multihop_data = mh_res.to_dict()
        except Exception as mh_err:
            logger.warning(f"Notice during multihop graph check: {str(mh_err)}")

        return {
            "query": query,
            "conversation_id": conversation_id,
            "routed_categories": routed_categories,
            "router_weights": clamped_weights,
            "router_rationale": routing_info.get("rationale", ""),
            "router_intent_label": router_intent_label,
            "alpha": alpha,
            "total_candidates": len(ranked_chunks),
            "chunks": top_chunks,
            "modality_gaps": modality_gaps,
            "multihop": multihop_data,
        }


hybrid_retriever = HybridRetriever()
