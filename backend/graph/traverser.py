import re
import json
import logging
from typing import List, Dict, Any, Optional, Tuple

from backend.config import get_settings
from backend.graph.models import MultiHopResult, GraphPathHop
from backend.graph.engine import graph_manager, ConversationGraph

logger = logging.getLogger("trace.graph.traverser")


class MultiHopTraverser:
    """
    Pure LLM Semantic Graph Entity Resolver & Multi-Hop Traverser.
    Resolves the exact target knowledge graph entities matching user queries
    and traverses context-grounded relationship hops with strict file isolation.
    """

    def __init__(self):
        self.settings = get_settings()

    def resolve_entities_with_llm(
        self,
        query: str,
        cg: ConversationGraph,
        target_filename: Optional[str] = None,
    ) -> List[str]:
        """
        Uses Gemini to semantically resolve and match the exact entity nodes
        present in the conversation graph for the user's specific query and target context.
        """
        if not self.settings.gemini_api_key or cg.graph.number_of_nodes() == 0:
            return []

        # Collect all nodes grouped by filename
        nodes_by_file: Dict[str, List[str]] = {}
        for u, v, d in cg.graph.edges(data=True):
            fn = d.get("filename", "Unknown")
            u_name = cg.graph.nodes[u].get("name", u) if cg.graph.has_node(u) else u
            v_name = cg.graph.nodes[v].get("name", v) if cg.graph.has_node(v) else v
            if fn not in nodes_by_file:
                nodes_by_file[fn] = []
            if u_name not in nodes_by_file[fn]:
                nodes_by_file[fn].append(u_name)
            if v_name not in nodes_by_file[fn]:
                nodes_by_file[fn].append(v_name)

        if target_filename and target_filename in nodes_by_file:
            # Strictly scope entity resolution to the target document
            target_nodes = nodes_by_file[target_filename]
            nodes_context = f"Entities from Target Document '{target_filename}':\n{', '.join(target_nodes)}"
        elif not nodes_by_file:
            all_nodes = [cg.graph.nodes[n].get("name", n) for n in cg.graph.nodes()]
            nodes_context = f"All Graph Entities: {', '.join(all_nodes)}"
        else:
            lines = []
            for fn, n_list in nodes_by_file.items():
                sorted_nodes = sorted(
                    n_list,
                    key=lambda x: (
                        not (x.startswith("Minor") or x.startswith("Department") or len(x) > 3),
                        x,
                    ),
                )
                lines.append(f"[{fn}]: {', '.join(sorted_nodes)}")
            nodes_context = "\n\n".join(lines)

        prompt = f"""You are the Semantic Knowledge Graph Entity Resolver for TraceRAG.
Your task is to identify the EXACT node name(s) in the conversation graph that directly correspond to the user's question, taking into account the target file context.

User Query: "{query}"
Target Context File: {target_filename or 'Any relevant session file'}

Graph Entities:
{nodes_context}

Rules:
1. If Target Context File is specified, you MUST ONLY select entities belonging to that target file. NEVER pick entities from unrelated files or videos.
2. If the user asks about a document topic (e.g. Thunderstorm, Minor in Dance, SQL), select the matching entity nodes from that specific document.
3. If no entity in the graph belongs to the requested document or answers the question, return an empty array [].
4. Return ONLY a valid JSON array of exact matching entity strings present in the graph.

JSON Array:"""

        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=self.settings.gemini_api_key)
            resp = client.models.generate_content(
                model=self.settings.gemini_model or "gemini-3.5-flash-lite",
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.0,
                ),
            )
            raw = resp.text.strip() if resp.text else "[]"
            if raw.startswith("```"):
                raw = re.sub(r"^```(?:json)?\s*", "", raw)
                raw = re.sub(r"\s*```$", "", raw)
            parsed = json.loads(raw)
            raw_candidates = []
            if isinstance(parsed, list):
                raw_candidates = [str(n).strip() for n in parsed]
            elif isinstance(parsed, dict) and "resolved_nodes" in parsed:
                raw_candidates = [str(n).strip() for n in parsed["resolved_nodes"]]

            valid_nodes = []
            for cand in raw_candidates:
                matched = cg._find_matching_node(cand)
                if matched and matched not in valid_nodes:
                    valid_nodes.append(matched)

            return valid_nodes
        except Exception as e:
            logger.warning(f"Notice during LLM semantic entity resolution: {e}")

        return []

    def traverse(
        self,
        conversation_id: str,
        query: str,
        entity_a: Optional[str] = None,
        entity_b: Optional[str] = None,
        target_filename: Optional[str] = None,
    ) -> MultiHopResult:
        """
        Performs context-aware multi-hop graph pathfinding and entity neighborhood extraction.
        """
        cg: ConversationGraph = graph_manager.get_graph(conversation_id)

        detected_entities: List[str] = []
        hops: List[GraphPathHop] = []

        if entity_a and entity_b:
            start_matched = cg._find_matching_node(entity_a.strip())
            end_matched = cg._find_matching_node(entity_b.strip())
            if start_matched and end_matched:
                start_name = cg.graph.nodes[start_matched].get("name", start_matched)
                end_name = cg.graph.nodes[end_matched].get("name", end_matched)
                detected_entities = [start_name, end_name]
                hops = cg.find_shortest_path(start_matched, end_matched) or []
        else:
            # 1. Pure LLM Semantic Graph Entity Resolution
            matched_node_ids = self.resolve_entities_with_llm(query, cg, target_filename=target_filename)
            detected_entities = [cg.graph.nodes[n].get("name", n) for n in matched_node_ids if cg.graph.has_node(n)]

            seen_hop_keys = set()

            # 2. Find paths between pairs of detected entities
            if len(matched_node_ids) >= 2:
                for i in range(len(matched_node_ids) - 1):
                    p_hops = cg.find_shortest_path(matched_node_ids[i], matched_node_ids[i + 1]) or []
                    for h in p_hops:
                        k = (h.from_node, h.relation, h.to_node)
                        if k not in seen_hop_keys:
                            seen_hop_keys.add(k)
                            hops.append(h)

            # 3. 2-hop & 3-hop Breadth-First Search (BFS) starting from seeds
            if matched_node_ids:
                bfs_hops = cg.bfs_traversal(
                    seed_entities=matched_node_ids,
                    max_depth=3,
                    max_edges=20,
                    target_filename=target_filename,
                )
                for h in bfs_hops:
                    k = (h.from_node, h.relation, h.to_node)
                    if k not in seen_hop_keys:
                        seen_hop_keys.add(k)
                        hops.append(h)

        if not hops:
            if detected_entities:
                return MultiHopResult(
                    is_multihop=True,
                    query=query,
                    detected_entities=detected_entities,
                    paths=[],
                    graph_context_text=f"Detected Entities: {', '.join(detected_entities)}",
                )
            return MultiHopResult(
                is_multihop=False,
                query=query,
                detected_entities=[],
                paths=[],
                graph_context_text="",
            )

        # Build human-readable multi-hop / graph relation narrative with rich multi-modal metadata
        evidence_lines = [f"### 🕸️ Knowledge Graph Relations ({len(hops)} relation hop{'s' if len(hops) > 1 else ''}):"]
        for idx, hop in enumerate(hops[:15]):
            loc_parts = []
            if hop.amount:
                curr_sym = "$" if hop.currency in ("USD", None) else f"{hop.currency} "
                loc_parts.append(f"💰 {curr_sym}{hop.amount:,.0f} {hop.currency or 'USD'}")
            if hop.page_number:
                loc_parts.append(f"📄 Page {hop.page_number}")
            if hop.start_timestamp and hop.end_timestamp:
                loc_parts.append(f"⏱️ {hop.start_timestamp} - {hop.end_timestamp}")
            elif hop.timestamp:
                loc_parts.append(f"⏱️ {hop.timestamp}")
            if hop.frame_id:
                loc_parts.append(f"🎬 {hop.frame_id}")
            if hop.spatial_location:
                loc_parts.append(f"📍 {hop.spatial_location}")
            if hop.bounding_box:
                loc_parts.append(f"📐 bbox: {hop.bounding_box}")

            loc_str = " | ".join(loc_parts)
            source_tag = f"[{hop.filename}{' | ' + loc_str if loc_str else ''}]"

            evidence_lines.append(
                f"  • Rel {idx + 1}: **{hop.from_node}** ({hop.from_type}) ➔ **{hop.relation}** ➔ **{hop.to_node}** ({hop.to_type})\n"
                f"    - Source: {source_tag}\n"
                f"    - Evidence: \"{hop.evidence}\""
            )

        context_text = "\n".join(evidence_lines)

        return MultiHopResult(
            is_multihop=True,
            query=query,
            detected_entities=detected_entities,
            paths=[hops],
            graph_context_text=context_text,
        )


multi_hop_traverser = MultiHopTraverser()
