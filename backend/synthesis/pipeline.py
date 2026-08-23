import re
import logging
from typing import Dict, Any, Optional, List, Tuple
from backend.synthesis.models import SynthesisResult, RetryInfo
from backend.synthesis.critic import retrieval_critic, CriticResult
from backend.synthesis.reformulator import query_reformulator
from backend.synthesis.generator import answer_generator
from backend.synthesis.verifier import citation_verifier
from backend.synthesis.contextualizer import query_contextualizer
from backend.synthesis.intent import is_conversational_query, generate_conversational_response
from backend.pipeline.retriever import hybrid_retriever
from backend.pipeline.router import query_router
from backend.routes.conversations import message_storage

logger = logging.getLogger("trace.synthesis.pipeline")


def _is_entity_in_text(entity: str, text: str) -> bool:
    if not entity or not text:
        return False
    e_str = entity.strip().lower()
    t_str = text.strip().lower()

    if e_str in t_str:
        return True

    e_clean = re.sub(r"[^\w\s]", "", e_str).strip()
    t_clean = re.sub(r"[^\w\s]", "", t_str).strip()
    if e_clean and len(e_clean) >= 2 and e_clean in t_clean:
        return True

    # Numeric/currency check (e.g. 50,000 vs $50,000 USD)
    nums_e = re.findall(r"\d+", e_str)
    if nums_e:
        num_str = "".join(nums_e)
        if len(num_str) >= 4 and num_str in re.sub(r"[^\d]", "", t_str):
            return True

    return False


def filter_answer_relevant_hops(
    answer_text: str,
    query: str,
    graph_hops: Optional[List[Any]],
    graph_entities: Optional[List[str]],
) -> Tuple[List[Any], List[str]]:
    """
    Strictly filters graph hops and entities to include ONLY those that are actually
    present and referenced in the synthesized answer.
    Both source and target must be substantiated in the answer/query context.
    Deduplicates parallel multi-edges between the same entity pair to keep only the primary relation.
    """
    if not graph_hops:
        return [], []

    comb_text = f"{query} \n {answer_text}"
    ans_text = answer_text

    # 1. Filter hops: BOTH from_node and to_node must be explicitly present, and target in answer
    filtered_hops: List[Any] = []
    seen_pairs = set()
    participating_entities = set()

    for hop in graph_hops:
        h_from = hop.get("from_node") if isinstance(hop, dict) else getattr(hop, "from_node", "")
        h_to = hop.get("to_node") if isinstance(hop, dict) else getattr(hop, "to_node", "")
        h_rel = hop.get("relation") if isinstance(hop, dict) else getattr(hop, "relation", "")

        if not h_from or not h_to or not h_rel:
            continue

        # Drop synthetic inverse mirror edges
        if str(h_rel).startswith("INVERSE_"):
            continue

        # Pair deduplication: keep only one primary edge per entity pair
        u_norm = str(h_from).lower().strip()
        v_norm = str(h_to).lower().strip()
        pair_key = (min(u_norm, v_norm), max(u_norm, v_norm))
        if pair_key in seen_pairs:
            continue

        # Strict validation: Target entity MUST be in the generated answer text,
        # and Source entity must be in the query or answer context!
        from_in_comb = _is_entity_in_text(str(h_from), comb_text)
        to_in_ans = _is_entity_in_text(str(h_to), ans_text)

        if from_in_comb and to_in_ans:
            seen_pairs.add(pair_key)
            filtered_hops.append(hop)
            participating_entities.add(str(h_from))
            participating_entities.add(str(h_to))

    # 2. Strict Entity Filtering: Only include entities that appear in the answer text and participating hops
    filtered_entities: List[str] = []
    for ent in list(graph_entities or []) + list(participating_entities):
        ent_str = str(ent).strip()
        if not ent_str or ent_str in filtered_entities:
            continue
        if _is_entity_in_text(ent_str, ans_text) and ent_str in participating_entities:
            filtered_entities.append(ent_str)

    # Ensure query seed entity is at the front if participating
    for ent in participating_entities:
        if _is_entity_in_text(ent, query) and ent not in filtered_entities:
            filtered_entities.insert(0, ent)

    return filtered_hops, filtered_entities


class SynthesisPipeline:
    """
    End-to-End Orchestrator:
    Conversation Context -> Intent Routing -> Contextualized Hybrid Retrieval ->
    Multi-Hop Knowledge Graph -> Retrieval Critic -> Reformulation Retry ->
    Cited Generation -> Claim-by-Claim Citation Verification.
    """

    def synthesize(
        self,
        conversation_id: str,
        query: str,
        top_k: int = 5,
        alpha: float = 0.5,
        use_router: bool = True,
        conversation_history: Optional[List[Dict[str, Any]]] = None,
    ) -> SynthesisResult:
        logger.info(f"Synthesizing response for conv='{conversation_id}', query='{query}'")

        # Load conversation history for contextual memory if not explicitly provided
        history = conversation_history if conversation_history is not None else message_storage.get_messages(conversation_id)

        # Step 0: Conversational Intent Intercept (Greetings, small talk, general dialogue)
        if is_conversational_query(query, conversation_id=conversation_id, conversation_history=history):
            logger.info(f"Query '{query}' classified as conversational dialog.")
            friendly_answer = generate_conversational_response(query, conversation_id, history)
            return SynthesisResult(
                query=query,
                conversation_id=conversation_id,
                answer=friendly_answer,
                confidence="high",
                critic=CriticResult(
                    confidence="high",
                    reason="Conversational greeting & assistant dialogue.",
                    missing_aspects=[],
                    should_retry=False,
                ),
                retry_info=RetryInfo(
                    retried=False,
                    original_query=query,
                    initial_confidence="high",
                ),
                citations=[],
                groundedness_score=1.0,
                chunks=[],
                graph_hops=None,
                routed_categories=["conversational"],
            )

        # Step 1: Multi-Turn Contextual Query Rewriting
        search_query = query_contextualizer.contextualize(query, history)
        logger.info(f"Search query: '{query}' -> Contextualized: '{search_query}'")

        # Step 2: Intent & Modality Routing
        router_res = query_router.route_query(search_query, conversation_id=conversation_id) if use_router else {}
        routed_categories = router_res.get("primary_categories", ["document"])

        # Step 3: Hybrid Retrieval
        retrieval_res = hybrid_retriever.retrieve(
            conversation_id=conversation_id,
            query=search_query,
            top_k=top_k,
            alpha=alpha,
            use_router=use_router,
        )

        chunks = retrieval_res.get("chunks", [])
        if chunks:
            retrieved_file_types = list(dict.fromkeys(c.get("file_type", "document") for c in chunks if c.get("file_type")))
            if retrieved_file_types:
                routed_categories = retrieved_file_types
        multihop_data = retrieval_res.get("multihop")
        graph_hops = multihop_data.get("paths", [[]])[0] if multihop_data else None
        graph_entities = multihop_data.get("detected_entities", []) if multihop_data else []
        graph_context_text = multihop_data.get("graph_context_text", "") if multihop_data else ""

        # Step 4: Critic Evaluation
        critic_res = retrieval_critic.evaluate(search_query, chunks)
        retry_info = RetryInfo(
            retried=False,
            original_query=query,
            initial_confidence=critic_res.confidence,
        )

        # Step 5: Query Reformulation & Retry (if critic confidence is low)
        if critic_res.should_retry:
            logger.info(f"Critic confidence '{critic_res.confidence}' is low. Reformulating query...")
            retry_res = query_reformulator.reformulate_and_retry(
                conversation_id=conversation_id,
                original_query=search_query,
                critic_result=critic_res,
                top_k=top_k,
                alpha=alpha,
            )
            retry_info = retry_res["retry_info"]
            new_retrieval = retry_res["retrieval"]
            new_chunks = new_retrieval.get("chunks", [])
            if new_chunks:
                chunks = new_chunks
                critic_res = retrieval_critic.evaluate(search_query, chunks)
                critic_res.should_retry = False

        # Step 6: Cited Natural Answer Generation
        answer_text = answer_generator.generate(
            query=query,
            chunks=chunks,
            graph_hops=graph_hops,
            conversation_history=history,
        )

        # Step 7: Claim-by-Claim Citation Verification
        citations, groundedness_score = citation_verifier.verify_citations(
            answer=answer_text,
            chunks=chunks,
        )

        # Compute accurate final synthesis confidence
        if groundedness_score >= 0.75 and citations:
            final_confidence = "high"
            critic_res.confidence = "high"
            if retry_info.retried:
                critic_res.reason = f"Reformulated query verified with {len(citations)} fully grounded source citations ({int(groundedness_score*100)}% grounded)."
        elif groundedness_score >= 0.40:
            final_confidence = "medium"
            critic_res.confidence = "medium"
        else:
            final_confidence = critic_res.confidence

        # Filter graph hops and entities to ONLY those actually referenced in the answer
        final_hops, final_entities = filter_answer_relevant_hops(answer_text, query, graph_hops, graph_entities)

        return SynthesisResult(
            query=query,
            conversation_id=conversation_id,
            answer=answer_text,
            confidence=final_confidence,
            critic=critic_res,
            retry_info=retry_info,
            citations=citations,
            groundedness_score=groundedness_score,
            chunks=chunks,
            graph_hops=final_hops,
            graph_entities=final_entities,
            graph_context_text=graph_context_text,
            routed_categories=routed_categories,
        )

    def synthesize_stream(
        self,
        conversation_id: str,
        query: str,
        top_k: int = 5,
        alpha: float = 0.5,
        use_router: bool = True,
        conversation_history: Optional[List[Dict[str, Any]]] = None,
    ):
        """
        Streams pipeline progress in real-time over Server-Sent Events (SSE):
        route -> retrieve -> graph -> confidence -> retry? -> answer -> verify -> done
        """
        logger.info(f"Streaming synthesis for conv='{conversation_id}', query='{query}'")

        # Load conversation history for multi-turn context if not explicitly provided
        history = conversation_history if conversation_history is not None else message_storage.get_messages(conversation_id)

        # Step 0: Conversational Intent Intercept (Pure LLM Semantic Router)
        if is_conversational_query(query, conversation_id=conversation_id, conversation_history=history):
            yield {
                "event": "route",
                "data": {
                    "stage": "route",
                    "categories": ["conversational"],
                    "intent_label": "General Conversation",
                    "explanation": "General conversation & assistant dialogue"
                }
            }
            yield {
                "event": "retrieve",
                "data": {
                    "stage": "retrieve",
                    "chunks_count": 0,
                    "explanation": "General dialogue (No file retrieval required)"
                }
            }
            yield {
                "event": "graph",
                "data": {
                    "stage": "graph",
                    "hops_count": 0,
                    "graph_hops": [],
                    "explanation": "Direct dialogue (0 graph hops)"
                }
            }
            yield {
                "event": "confidence",
                "data": {
                    "stage": "confidence",
                    "confidence": "HIGH",
                    "explanation": "General Conversational Dialogue"
                }
            }
            friendly_answer = generate_conversational_response(query, conversation_id, history)
            result = SynthesisResult(
                query=query,
                conversation_id=conversation_id,
                answer=friendly_answer,
                confidence="high",
                critic=CriticResult(confidence="high", reason="Conversational dialogue.", missing_aspects=[], should_retry=False),
                retry_info=RetryInfo(retried=False, original_query=query, initial_confidence="high"),
                citations=[],
                groundedness_score=1.0,
                chunks=[],
                graph_hops=None,
                routed_categories=["conversational"],
            )
            yield {
                "event": "answer",
                "data": {"stage": "answer", "answer": friendly_answer}
            }
            yield {
                "event": "done",
                "data": {"stage": "done", "result": result.model_dump()}
            }
            return

        # Step 1: Initial Immediate Stage 1 Activation
        yield {
            "event": "route",
            "data": {
                "stage": "route",
                "categories": ["document"],
                "intent_label": "Analyzing query...",
                "explanation": "Contextualizing query & routing intent..."
            }
        }

        # Multi-Turn Contextual Query Rewriting
        search_query = query_contextualizer.contextualize(query, history)
        logger.info(f"Stream: original='{query}' -> Contextualized='{search_query}'")

        # Step 2: Intent & Modality Routing
        router_res = query_router.route_query(search_query, conversation_id=conversation_id) if use_router else {}
        routed_cats = router_res.get("primary_categories", ["document"])
        intent_label = router_res.get("intent_label", "Document (PDF/Docx)")

        yield {
            "event": "route",
            "data": {
                "stage": "route",
                "categories": routed_cats,
                "intent_label": intent_label,
                "explanation": router_res.get("rationale", f"Searching for {intent_label}")
            }
        }

        # Step 3: Hybrid Retrieval Stage Activation
        yield {
            "event": "retrieve",
            "data": {
                "stage": "retrieve",
                "chunks_count": 0,
                "explanation": "Searching vector embeddings & keyword index..."
            }
        }

        retrieval_res = hybrid_retriever.retrieve(
            conversation_id=conversation_id,
            query=search_query,
            top_k=top_k,
            alpha=alpha,
            use_router=use_router,
        )

        chunks = retrieval_res.get("chunks", [])
        multihop_data = retrieval_res.get("multihop")
        graph_hops = multihop_data.get("paths", [[]])[0] if multihop_data else None

        # Refine Stage 1 label if retrieved chunks identify single or multi-modal sources
        if chunks:
            retrieved_file_types = list(dict.fromkeys(c.get("file_type", "document") for c in chunks if c.get("file_type")))
            retrieved_filenames = list(dict.fromkeys(c.get("filename", "") for c in chunks if c.get("filename")))

            if len(retrieved_file_types) > 1:
                routed_cats = retrieved_file_types
                refined_intent = "Multi-Modal"
                intent_label = refined_intent
                yield {
                    "event": "route",
                    "data": {
                        "stage": "route",
                        "categories": routed_cats,
                        "intent_label": refined_intent,
                        "explanation": f"Cross-modal synthesis across {len(retrieved_filenames)} files: {', '.join(retrieved_filenames[:3])}"
                    }
                }
            elif retrieved_file_types:
                top_ft = retrieved_file_types[0]
                top_fn = retrieved_filenames[0] if retrieved_filenames else ""
                TYPE_NAMES = {
                    "video": "Video Presentation",
                    "audio": "Audio Transcript",
                    "image": "Image / Diagram",
                    "document": "Document (PDF/Docx)",
                }
                t_name = TYPE_NAMES.get(top_ft, top_ft.capitalize())
                refined_intent = f"{t_name} ({top_fn})" if top_fn else t_name
                if refined_intent != intent_label:
                    intent_label = refined_intent
                    routed_cats = [top_ft]
                    yield {
                        "event": "route",
                        "data": {
                            "stage": "route",
                            "categories": [top_ft],
                            "intent_label": refined_intent,
                            "explanation": f"Retrieved source: {top_fn} ({t_name})"
                        }
                    }

        yield {
            "event": "retrieve",
            "data": {"stage": "retrieve", "chunks_count": len(chunks), "chunks": chunks}
        }

        # Step 4: Knowledge Graph Multi-Hop Stage
        hops_count = len(graph_hops) if graph_hops else 0
        yield {
            "event": "graph",
            "data": {
                "stage": "graph",
                "hops_count": hops_count,
                "graph_hops": graph_hops or [],
                "explanation": f"{hops_count} relation hops traversed" if hops_count else "Direct match (0 hops)"
            }
        }

        # Step 5: Critic Evaluation Stage
        critic_res = retrieval_critic.evaluate(search_query, chunks)
        retry_info = RetryInfo(
            retried=False,
            original_query=query,
            initial_confidence=critic_res.confidence,
        )

        yield {
            "event": "confidence",
            "data": {
                "stage": "confidence",
                "confidence": critic_res.confidence,
                "reason": critic_res.reason,
                "missing_aspects": critic_res.missing_aspects,
                "should_retry": critic_res.should_retry,
            }
        }

        # Step 6: Query Reformulation Retry (if low confidence)
        if critic_res.should_retry:
            retry_res = query_reformulator.reformulate_and_retry(
                conversation_id=conversation_id,
                original_query=search_query,
                critic_result=critic_res,
                top_k=top_k,
                alpha=alpha,
            )
            retry_info = retry_res["retry_info"]
            new_retrieval = retry_res["retrieval"]
            new_chunks = new_retrieval.get("chunks", [])
            if new_chunks:
                chunks = new_chunks
                critic_res = retrieval_critic.evaluate(search_query, chunks)
                critic_res.should_retry = False

            yield {
                "event": "retry",
                "data": {
                    "stage": "retry",
                    "retry_info": retry_info.model_dump(),
                    "new_chunks_count": len(chunks),
                }
            }

        # Step 7: Cited Natural Answer Generation (Activate Stage 5 in Pink DURING Generation)
        yield {
            "event": "answer_start",
            "data": {
                "stage": "answer",
                "status": "generating",
                "explanation": "Synthesizing answer with source citations..."
            }
        }

        answer_text = answer_generator.generate(
            query=query,
            chunks=chunks,
            graph_hops=graph_hops,
            conversation_history=history,
        )

        yield {
            "event": "answer",
            "data": {"stage": "answer", "answer": answer_text}
        }

        # Step 8: Claim-by-Claim Citation Verification
        yield {
            "event": "verify",
            "data": {
                "stage": "verify",
                "status": "verifying",
                "explanation": "Verifying citations against source text..."
            }
        }

        citations, groundedness_score = citation_verifier.verify_citations(
            answer=answer_text,
            chunks=chunks,
        )

        yield {
            "event": "verify",
            "data": {
                "stage": "verify",
                "citations": [c.model_dump() for c in citations],
                "groundedness_score": groundedness_score,
            }
        }

        graph_entities = multihop_data.get("detected_entities", []) if multihop_data else []
        graph_context_text = multihop_data.get("graph_context_text", "") if multihop_data else ""

        # Compute accurate final synthesis confidence
        if groundedness_score >= 0.75 and citations:
            final_confidence = "high"
            critic_res.confidence = "high"
            if retry_info.retried:
                critic_res.reason = f"Reformulated query verified with {len(citations)} fully grounded source citations ({int(groundedness_score*100)}% grounded)."
        elif groundedness_score >= 0.40:
            final_confidence = "medium"
            critic_res.confidence = "medium"
        else:
            final_confidence = critic_res.confidence

        # Filter graph hops and entities to ONLY those actually referenced in the answer
        final_hops, final_entities = filter_answer_relevant_hops(answer_text, query, graph_hops, graph_entities)

        final_result = SynthesisResult(
            query=query,
            conversation_id=conversation_id,
            answer=answer_text,
            confidence=final_confidence,
            critic=critic_res,
            retry_info=retry_info,
            citations=citations,
            groundedness_score=groundedness_score,
            chunks=chunks,
            graph_hops=final_hops,
            graph_entities=final_entities,
            graph_context_text=graph_context_text,
            routed_categories=routed_cats,
        )

        yield {
            "event": "done",
            "data": {"stage": "done", "result": final_result.model_dump()}
        }


synthesis_pipeline = SynthesisPipeline()
