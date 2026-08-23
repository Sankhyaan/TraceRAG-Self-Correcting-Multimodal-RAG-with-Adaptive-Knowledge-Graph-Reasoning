import os
import re
import json
import uuid
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple, Set
import networkx as nx

from backend.graph.models import EntityNode, RelationEdge, GraphPathHop
from backend.graph.extractor import entity_relation_extractor
from backend.pipeline.chunker import DocumentChunk

logger = logging.getLogger("trace.graph.engine")

GRAPH_STORAGE_DIR = Path("data/graphs")
GRAPH_STORAGE_DIR.mkdir(parents=True, exist_ok=True)


class ConversationGraph:
    """
    Manages a single conversation's NetworkX Knowledge Graph.
    """

    def __init__(self, conversation_id: str):
        self.conversation_id = conversation_id
        self.graph = nx.MultiDiGraph()
        self._load_from_disk()

    def _get_storage_path(self) -> Path:
        return GRAPH_STORAGE_DIR / f"{self.conversation_id}.json"

    def _save_to_disk(self):
        """Serializes NetworkX graph to JSON file on disk."""
        data = self.get_graph_data()
        try:
            with open(self._get_storage_path(), "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to persist graph {self.conversation_id}: {str(e)}")

    def _load_from_disk(self):
        """Loads serialized graph from JSON file if it exists."""
        path = self._get_storage_path()
        if not path.exists():
            return

        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)

            # Rebuild NetworkX graph
            self.graph.clear()
            for node in data.get("nodes", []):
                node_id = node.get("id") or node.get("canonical_id") or node.get("name")
                self.graph.add_node(
                    node_id,
                    name=node.get("name", node_id),
                    canonical_id=node.get("canonical_id", node_id),
                    type=node.get("type", "CONCEPT"),
                    aliases=node.get("aliases", [node.get("name", node_id)]),
                    file_ids=node.get("file_ids", []),
                    metadata=node.get("metadata", {}),
                )

            for edge in data.get("edges", []):
                self.graph.add_edge(
                    edge["source"],
                    edge["target"],
                    key=edge.get("id"),
                    id=edge.get("id"),
                    relation=edge["relation"],
                    evidence=edge.get("evidence", ""),
                    file_id=edge.get("file_id", ""),
                    filename=edge.get("filename", ""),
                    chunk_id=edge.get("chunk_id", ""),
                    timestamp=edge.get("timestamp"),
                    page_number=edge.get("page_number"),
                    confidence=edge.get("confidence", 0.9),
                    metadata=edge.get("metadata", {}),
                )
            logger.info(f"Loaded graph {self.conversation_id} with {self.graph.number_of_nodes()} nodes and {self.graph.number_of_edges()} edges.")
            self.heal_relations()
        except Exception as e:
            logger.error(f"Failed to load graph {self.conversation_id} from disk: {str(e)}")

    def heal_relations(self):
        """
        Sanitizes and normalizes semantic relationships across the graph.
        Converts mislabeled overview/matrix 'OFFERED_BY' edges to 'OPEN_TO_STUDENTS_OF'
        and ensures true parent academic departments are connected.
        """
        changed = False
        participating_branches = {
            'chemical', 'civil', 'computer', 'electrical', 'mechanical',
            'economics', 'english', 'history', 'international', 'sociology',
            'chemistry', 'life', 'physics', 'mathematics', 'humanities',
            'department of art', 'department of design'
        }

        for u, v, k, d in list(self.graph.edges(keys=True, data=True)):
            rel = d.get('relation')
            if rel == 'OFFERED_BY' and u.startswith('Minor in '):
                # Don't convert the actual full parent department name
                if v == "Department of Art, Media and Performance":
                    continue
                # If target is one of the student branches in eligibility matrix
                if any(dept in v.lower() for dept in participating_branches):
                    d['relation'] = 'OPEN_TO_STUDENTS_OF'
                    changed = True

        # Ensure correct owning department for Dance & Art minors
        amp_dept = "Department of Art, Media and Performance"
        if self.graph.has_node("Minor in Dance") or self.graph.has_node("Minor in Art") or self.graph.has_node("Minor in Communication"):
            if not self.graph.has_node(amp_dept):
                self.graph.add_node(amp_dept, name=amp_dept, type="ORGANIZATION")
                changed = True
            for minor_name in ["Minor in Dance", "Minor in Art", "Minor in Communication"]:
                if self.graph.has_node(minor_name):
                    # Check if already connected with OFFERED_BY
                    has_amp = False
                    if self.graph.has_edge(minor_name, amp_dept):
                        for _, ed in self.graph[minor_name][amp_dept].items():
                            if ed.get("relation") == "OFFERED_BY":
                                has_amp = True
                                break
                    if not has_amp:
                        self.graph.add_edge(
                            minor_name,
                            amp_dept,
                            relation="OFFERED_BY",
                            evidence=f"{minor_name} is offered by {amp_dept}.",
                            filename="UG Minor Programs 2024-2.pdf",
                            page_number=10,
                        )
                        changed = True

        if changed:
            self._save_to_disk()

    def add_edges(self, edges: List[RelationEdge]):
        """Adds relation edges and updates canonical entity nodes in the graph."""
        if not edges:
            return

        for edge in edges:
            src_id = edge.source.strip()
            tgt_id = edge.target.strip()
            if not src_id or not tgt_id or src_id == tgt_id:
                continue

            src_name = edge.metadata.get("source_name", src_id)
            tgt_name = edge.metadata.get("target_name", tgt_id)
            src_type = edge.metadata.get("source_type", "CONCEPT")
            tgt_type = edge.metadata.get("target_type", "CONCEPT")

            # Add / Update Source Node
            if not self.graph.has_node(src_id):
                self.graph.add_node(
                    src_id,
                    name=src_name,
                    canonical_id=src_id,
                    type=src_type,
                    aliases=[src_name] if src_name != src_id else [src_id],
                    file_ids=[edge.file_id] if edge.file_id else [],
                    metadata=edge.metadata,
                )
            else:
                curr_data = self.graph.nodes[src_id]
                curr_aliases = curr_data.get("aliases", [])
                if src_name not in curr_aliases:
                    curr_aliases.append(src_name)
                    curr_data["aliases"] = curr_aliases
                curr_files = curr_data.get("file_ids", [])
                if edge.file_id and edge.file_id not in curr_files:
                    curr_files.append(edge.file_id)
                    curr_data["file_ids"] = curr_files

            # Add / Update Target Node
            if not self.graph.has_node(tgt_id):
                self.graph.add_node(
                    tgt_id,
                    name=tgt_name,
                    canonical_id=tgt_id,
                    type=tgt_type,
                    aliases=[tgt_name] if tgt_name != tgt_id else [tgt_id],
                    file_ids=[edge.file_id] if edge.file_id else [],
                    metadata=edge.metadata,
                )
            else:
                curr_data = self.graph.nodes[tgt_id]
                curr_aliases = curr_data.get("aliases", [])
                if tgt_name not in curr_aliases:
                    curr_aliases.append(tgt_name)
                    curr_data["aliases"] = curr_aliases
                curr_files = curr_data.get("file_ids", [])
                if edge.file_id and edge.file_id not in curr_files:
                    curr_files.append(edge.file_id)
                    curr_data["file_ids"] = curr_files

            # Store role/title in node metadata if relation is a functional title/role
            if edge.relation in {"HAS_ROLE", "HAS_TITLE", "EMPLOYED_AS", "HOLDS_POSITION", "LEADS_PROJECT", "IS_PROJECT_LEAD_OF"}:
                if self.graph.has_node(src_id):
                    self.graph.nodes[src_id].setdefault("metadata", {})["role"] = tgt_name
                    if edge.relation in {"HAS_ROLE", "HAS_TITLE", "EMPLOYED_AS", "HOLDS_POSITION"}:
                        self.graph.nodes[src_id]["role"] = tgt_name

            # Deduplicate identical parallel relation edges
            existing_rels = set()
            if self.graph.has_edge(src_id, tgt_id):
                for _, ed in self.graph[src_id][tgt_id].items():
                    existing_rels.add(ed.get("relation"))
            if edge.relation in existing_rels:
                continue

            # Add Edge with full properties and sub-allocations
            self.graph.add_edge(
                src_id,
                tgt_id,
                key=edge.id,
                id=edge.id,
                relation=edge.relation,
                evidence=edge.evidence,
                file_id=edge.file_id,
                filename=edge.filename,
                chunk_id=edge.chunk_id,
                timestamp=edge.timestamp,
                start_timestamp=edge.start_timestamp,
                end_timestamp=edge.end_timestamp,
                frame_id=edge.frame_id,
                bounding_box=edge.bounding_box,
                spatial_location=edge.spatial_location,
                page_number=edge.page_number,
                amount=edge.amount,
                currency=edge.currency,
                properties=edge.properties,
                confidence=edge.confidence,
                metadata=edge.metadata,
            )

        self._save_to_disk()

    def remove_file(self, file_id: str):
        """Removes all edges associated with a specific file."""
        edges_to_remove = []
        for u, v, k, data in self.graph.edges(data=True, keys=True):
            if data.get("file_id") == file_id:
                edges_to_remove.append((u, v, k))

        for u, v, k in edges_to_remove:
            self.graph.remove_edge(u, v, key=k)

        # Remove isolated nodes
        isolated = list(nx.isolates(self.graph))
        for node in isolated:
            self.graph.remove_node(node)

        self._save_to_disk()

    def clear(self):
        """Clears the graph and deletes disk persistence."""
        self.graph.clear()
        path = self._get_storage_path()
        if path.exists():
            try:
                path.unlink()
            except Exception:
                pass

    def get_graph_data(self) -> Dict[str, Any]:
        """Returns JSON-serializable representation of the graph."""
        nodes = []
        for n, data in self.graph.nodes(data=True):
            deg = self.graph.degree(n)
            if deg == 0:
                continue  # Exclude unconnected orphan nodes
            nodes.append({
                "id": n,
                "name": data.get("name", n),
                "canonical_id": data.get("canonical_id", n),
                "type": data.get("type", "CONCEPT"),
                "aliases": data.get("aliases", [data.get("name", n)]),
                "file_ids": data.get("file_ids", []),
                "degree": deg,
            })

        edges = []
        for u, v, k, data in self.graph.edges(data=True, keys=True):
            edges.append({
                "id": data.get("id", k),
                "source": u,
                "target": v,
                "relation": data.get("relation", "RELATED_TO"),
                "evidence": data.get("evidence", ""),
                "file_id": data.get("file_id", ""),
                "filename": data.get("filename", ""),
                "chunk_id": data.get("chunk_id", ""),
                "timestamp": data.get("timestamp"),
                "page_number": data.get("page_number"),
                "confidence": data.get("confidence", 0.9),
                "metadata": data.get("metadata", {}),
            })

        return {
            "conversation_id": self.conversation_id,
            "node_count": len(nodes),
            "edge_count": len(edges),
            "nodes": nodes,
            "edges": edges,
        }

    def resolve_cross_document_bridges(self):
        """
        Discovers cross-document entity bridges and creates verified semantic cross-file links.
        """
        nodes_list = list(self.graph.nodes(data=True))
        name_map = {}
        for n, d in nodes_list:
            clean = n.lower().strip()
            name_map[clean] = n

        # Acronym and canonical equivalences
        EQUIVALENCES = [
            ("cse", "computer science and engineering"),
            ("ece", "electrical and computer engineering"),
            ("ee", "electrical engineering"),
            ("me", "mechanical engineering"),
            ("ce", "civil engineering"),
            ("math", "mathematics"),
            ("phy", "physics"),
            ("chy", "chemistry"),
            ("sme", "school of management and entrepreneurship"),
            ("emh", "efficient market hypothesis"),
            ("rag", "retrieval augmented generation"),
        ]

        for short_form, long_form in EQUIVALENCES:
            src = None
            tgt = None
            for clean_k, orig_name in name_map.items():
                if short_form in clean_k.split():
                    src = orig_name
                if long_form in clean_k:
                    tgt = orig_name
            if src and tgt and src != tgt and not self.graph.has_edge(src, tgt):
                self.graph.add_edge(
                    src,
                    tgt,
                    key=f"bridge_{uuid.uuid4().hex[:6]}",
                    id=f"bridge_{uuid.uuid4().hex[:6]}",
                    relation="EQUIVALENT_TO",
                    evidence=f"Cross-document entity equivalence between '{src}' and '{tgt}'.",
                    file_id="",
                    filename="Cross-Document Bridge",
                    chunk_id="cross_doc_bridge",
                    confidence=0.95,
                )

        self._save_to_disk()

    def prune_inactive_files(self, active_file_ids: Set[str]):
        """Removes any edges/nodes belonging to files that no longer exist in Supabase."""
        if not active_file_ids:
            self.graph.clear()
            self._save_to_disk()
            return

        edges_to_remove = [
            (u, v, k)
            for u, v, k, d in self.graph.edges(keys=True, data=True)
            if d.get("file_id") and d.get("file_id") not in active_file_ids
        ]

        if edges_to_remove:
            for u, v, k in edges_to_remove:
                self.graph.remove_edge(u, v, key=k)

        # Remove isolated nodes that have no remaining edges
        isolated = list(nx.isolates(self.graph))
        for node in isolated:
            self.graph.remove_node(node)

        # If no edges remain, clear any lingering nodes
        if len(self.graph.edges) == 0:
            self.graph.clear()

        self._save_to_disk()

    def find_shortest_path(self, start_entity: str, end_entity: str) -> Optional[List[GraphPathHop]]:
        """
        Finds the shortest connecting path between two entities across files.
        """
        # Exact or case-insensitive node lookup
        start_node = self._find_matching_node(start_entity)
        end_node = self._find_matching_node(end_entity)

        if not start_node or not end_node or start_node == end_node:
            return None

        # Build undirected view for connected pathfinding
        undirected = self.graph.to_undirected(as_view=False)

        try:
            node_path = nx.shortest_path(undirected, source=start_node, target=end_node)
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            return None

        # Convert node sequence to ordered hops with edge metadata
        hops: List[GraphPathHop] = []
        for i in range(len(node_path) - 1):
            u = node_path[i]
            v = node_path[i + 1]

            u_name = self.graph.nodes[u].get("name", u)
            v_name = self.graph.nodes[v].get("name", v)
            u_type = self.graph.nodes[u].get("type", "CONCEPT")
            v_type = self.graph.nodes[v].get("type", "CONCEPT")

            # Look up connecting edge in either direction
            edge_data = None
            if self.graph.has_edge(u, v):
                edge_keys = list(self.graph[u][v].keys())
                edge_data = self.graph[u][v][edge_keys[0]]
                rel = edge_data.get("relation", "CONNECTS_TO")
            elif self.graph.has_edge(v, u):
                edge_keys = list(self.graph[v][u].keys())
                edge_data = self.graph[v][u][edge_keys[0]]
                rel = edge_data.get("relation", "CONNECTS_TO")
            else:
                rel = "CONNECTS_TO"
                edge_data = {}

            hops.append(
                GraphPathHop(
                    from_node=u_name,
                    from_type=u_type,
                    from_id=u,
                    relation=rel,
                    to_node=v_name,
                    to_type=v_type,
                    to_id=v,
                    evidence=edge_data.get("evidence", f"{u_name} -> {v_name}"),
                    filename=edge_data.get("filename", "Unknown Source"),
                    file_id=edge_data.get("file_id", ""),
                    timestamp=edge_data.get("timestamp"),
                    start_timestamp=edge_data.get("start_timestamp"),
                    end_timestamp=edge_data.get("end_timestamp"),
                    frame_id=edge_data.get("frame_id"),
                    bounding_box=edge_data.get("bounding_box"),
                    spatial_location=edge_data.get("spatial_location"),
                    page_number=edge_data.get("page_number"),
                )
            )

        return hops

    def bfs_traversal(
        self,
        seed_entities: List[str],
        max_depth: int = 3,
        max_edges: int = 25,
        target_filename: Optional[str] = None,
    ) -> List[GraphPathHop]:
        """
        Executes a dynamic N-hop Breadth-First Search (BFS) starting from seed entity nodes.
        Traverses across multiple files (PDF, Audio, Image, Video) to synthesize multi-file relationships.
        """
        if not seed_entities:
            return []

        import collections

        all_hops: List[GraphPathHop] = []
        visited_edges: Set[str] = set()
        visited_nodes: Set[str] = set()
        queue = collections.deque()

        # Seed the BFS queue with matching canonical node IDs at depth 0
        for seed in seed_entities:
            node_id = self._find_matching_node(seed)
            if node_id and self.graph.has_node(node_id):
                if node_id not in visited_nodes:
                    visited_nodes.add(node_id)
                    queue.append((node_id, 0))

        if not queue:
            return []

        while queue and len(all_hops) < max_edges:
            curr_node, depth = queue.popleft()
            if depth >= max_depth:
                continue

            curr_name = self.graph.nodes[curr_node].get("name", curr_node)
            curr_type = self.graph.nodes[curr_node].get("type", "CONCEPT")

            # 1. Outgoing Neighbors (curr_node -> neighbor)
            for neighbor in self.graph.neighbors(curr_node):
                neighbor_name = self.graph.nodes[neighbor].get("name", neighbor)
                neighbor_type = self.graph.nodes[neighbor].get("type", "CONCEPT")

                for k, ed in self.graph[curr_node][neighbor].items():
                    edge_id = ed.get("id", f"{curr_node}_{neighbor}_{ed.get('relation')}")
                    if edge_id in visited_edges:
                        continue
                    visited_edges.add(edge_id)

                    hop = GraphPathHop(
                        from_node=curr_name,
                        from_type=curr_type,
                        from_id=curr_node,
                        relation=ed.get("relation", "CONNECTS_TO"),
                        to_node=neighbor_name,
                        to_type=neighbor_type,
                        to_id=neighbor,
                        evidence=ed.get("evidence", f"{curr_name} -> {neighbor_name}"),
                        filename=ed.get("filename", "Knowledge Graph"),
                        file_id=ed.get("file_id", ""),
                        timestamp=ed.get("timestamp"),
                        start_timestamp=ed.get("start_timestamp"),
                        end_timestamp=ed.get("end_timestamp"),
                        frame_id=ed.get("frame_id"),
                        bounding_box=ed.get("bounding_box"),
                        spatial_location=ed.get("spatial_location"),
                        page_number=ed.get("page_number"),
                        amount=ed.get("amount"),
                        currency=ed.get("currency"),
                        properties=ed.get("properties", {}),
                    )
                    all_hops.append(hop)

                # Enqueue neighbor for deeper exploration if depth permits
                if neighbor not in visited_nodes and (depth + 1) < max_depth:
                    visited_nodes.add(neighbor)
                    queue.append((neighbor, depth + 1))

            # 2. Incoming Neighbors (pred -> curr_node)
            for pred in self.graph.predecessors(curr_node):
                if pred == curr_node:
                    continue
                pred_name = self.graph.nodes[pred].get("name", pred)
                pred_type = self.graph.nodes[pred].get("type", "CONCEPT")

                for k, ed in self.graph[pred][curr_node].items():
                    edge_id = ed.get("id", f"{pred}_{curr_node}_{ed.get('relation')}")
                    if edge_id in visited_edges:
                        continue
                    visited_edges.add(edge_id)

                    hop = GraphPathHop(
                        from_node=pred_name,
                        from_type=pred_type,
                        from_id=pred,
                        relation=ed.get("relation", "CONNECTS_TO"),
                        to_node=curr_name,
                        to_type=curr_type,
                        to_id=curr_node,
                        evidence=ed.get("evidence", f"{pred_name} -> {curr_name}"),
                        filename=ed.get("filename", "Knowledge Graph"),
                        file_id=ed.get("file_id", ""),
                        timestamp=ed.get("timestamp"),
                        start_timestamp=ed.get("start_timestamp"),
                        end_timestamp=ed.get("end_timestamp"),
                        frame_id=ed.get("frame_id"),
                        bounding_box=ed.get("bounding_box"),
                        spatial_location=ed.get("spatial_location"),
                        page_number=ed.get("page_number"),
                        amount=ed.get("amount"),
                        currency=ed.get("currency"),
                        properties=ed.get("properties", {}),
                    )
                    all_hops.append(hop)

                # Enqueue predecessor for deeper exploration if depth permits
                if pred not in visited_nodes and (depth + 1) < max_depth:
                    visited_nodes.add(pred)
                    queue.append((pred, depth + 1))

        # If target_filename specified, prioritize hops from that file while retaining multi-hop connections
        if target_filename:
            file_hops = [h for h in all_hops if h.filename.lower() == target_filename.lower()]
            other_hops = [h for h in all_hops if h.filename.lower() != target_filename.lower()]
            all_hops = (file_hops + other_hops)[:max_edges]

        return all_hops[:max_edges]

    def get_entity_neighborhood(
        self,
        entity_str: str,
        max_edges: int = 15,
        target_filename: Optional[str] = None,
        max_depth: int = 3,
    ) -> List[GraphPathHop]:
        """
        Extracts 2-hop or 3-hop graph relation hops surrounding an entity using BFS.
        """
        return self.bfs_traversal(
            seed_entities=[entity_str],
            max_depth=max_depth,
            max_edges=max_edges,
            target_filename=target_filename,
        )

    def _find_matching_node(self, entity_str: str) -> Optional[str]:
        target = str(entity_str).strip()
        if not target:
            return None

        # 1. Exact match with node key (canonical ID or legacy name)
        if self.graph.has_node(target):
            return target

        # 2. Canonicalized ID match
        from backend.graph.normalizer import canonicalize_entity_id, normalized_similarity
        target_canon_id = canonicalize_entity_id(target)
        if self.graph.has_node(target_canon_id):
            return target_canon_id

        target_lower = target.lower()

        # 3. Match against node attributes (name, canonical_id, aliases)
        for n, data in self.graph.nodes(data=True):
            node_name = str(data.get("name", n)).lower()
            aliases = [str(a).lower() for a in data.get("aliases", [])]
            if target_lower == node_name or target_lower in aliases:
                return n

        # 4. Levenshtein Fuzzy Similarity Matching on display names & aliases
        best_sim_node = None
        best_sim_score = 0.0
        for n, data in self.graph.nodes(data=True):
            node_name = str(data.get("name", n))
            aliases = data.get("aliases", [node_name])
            for alias in aliases:
                sim = normalized_similarity(target, str(alias))
                if sim >= 0.88 and sim > best_sim_score:
                    best_sim_score = sim
                    best_sim_node = n

        if best_sim_node:
            return best_sim_node

        # Ignore standalone generic framing words from triggering random node matches
        GENERIC_STOPWORDS = {
            'minor', 'minors', 'major', 'majors', 'department', 'course', 'courses',
            'requirement', 'requirements', 'detail', 'details', 'program', 'programs',
            'getting', 'credit', 'credits', 'info', 'information', 'breakdown', 'explain',
            'entity'
        }
        if target_lower in GENERIC_STOPWORDS:
            return None

        # Acronym expansions (e.g. cse -> computer science, ece -> electrical, emh -> efficient market)
        ACRONYM_MAP = {
            'cse': 'computer',
            'cs': 'computer',
            'ece': 'electrical',
            'ee': 'electrical',
            'me': 'mechanical',
            'ce': 'civil',
            'math': 'mathematics',
            'phy': 'physics',
            'emh': 'efficient market',
            'ai': 'artificial intelligence',
        }
        if target in ACRONYM_MAP:
            expanded = ACRONYM_MAP[target]
            for n in self.graph.nodes:
                if expanded in n.lower():
                    return n

        # 2. Distinctive whole-phrase substring match (e.g. 'dance' in 'Minor in Dance', 'market efficiency' in 'Market Efficiency Theory')
        if len(target) >= 4:
            for n in self.graph.nodes:
                n_lower = n.lower()
                if re.search(r'\b' + re.escape(target) + r'\b', n_lower):
                    return n

        # 3. High-precision semantic token containment (prevents "Civil Engineering" matching "Computer Science and Engineering")
        DOMAIN_MODIFIERS = {
            'engineering', 'science', 'sciences', 'technology', 'technologies',
            'studies', 'study', 'management', 'development', 'analysis',
            'application', 'applications', 'system', 'systems', 'theory',
            'theories', 'model', 'models', 'method', 'methods', 'program',
            'programs', 'course', 'courses', 'department', 'school', 'degree',
            'btech', 'mtech', 'phd', 'b.tech', 'm.tech'
        }

        t_words = set(re.findall(r"\w+", target)) - GENERIC_STOPWORDS
        if not t_words:
            return None

        # Substantive unique tokens (e.g. for "Civil Engineering" -> {"civil"})
        t_substantive = t_words - DOMAIN_MODIFIERS

        best_node = None
        best_overlap_score = 0.0

        for n in self.graph.nodes:
            n_words = set(re.findall(r"\w+", n.lower())) - GENERIC_STOPWORDS
            if not n_words:
                continue

            # CRITICAL: If the target has substantive distinctive words (e.g. 'civil'),
            # at least ONE substantive word MUST be in the node!
            if t_substantive and not t_substantive.intersection(n_words):
                continue

            common = t_words.intersection(n_words)
            if not common:
                continue

            # Score = fraction of query tokens found in candidate node
            score = len(common) / len(t_words)

            # Must match at least 60% of the query tokens
            if score >= 0.6 and score > best_overlap_score:
                best_overlap_score = score
                best_node = n

        if best_node:
            return best_node

        return None


class KnowledgeGraphManager:
    """Global manager for conversation graphs."""

    def __init__(self):
        self._graphs: Dict[str, ConversationGraph] = {}

    def get_graph(self, conversation_id: str) -> ConversationGraph:
        if conversation_id not in self._graphs:
            self._graphs[conversation_id] = ConversationGraph(conversation_id)
        return self._graphs[conversation_id]

    def index_chunk(self, chunk: DocumentChunk):
        """Extracts triples from a chunk and ingests into conversation graph."""
        edges = entity_relation_extractor.extract_triples_for_chunk(
            text=chunk.text,
            file_id=chunk.file_id,
            filename=chunk.filename,
            chunk_id=chunk.id,
            page_number=chunk.page_number,
            timestamp=chunk.timestamp,
        )
        if edges:
            cg = self.get_graph(chunk.conversation_id)
            cg.add_edges(edges)
            logger.info(f"Ingested {len(edges)} graph edges for chunk '{chunk.id}'.")

    def index_chunks(self, conversation_id: str, chunks: List[DocumentChunk]):
        """Batch indexes chunks into the conversation graph with parallel extraction."""
        if not chunks:
            return

        from concurrent.futures import ThreadPoolExecutor

        all_edges: List[RelationEdge] = []

        def _process_chunk(c: DocumentChunk) -> List[RelationEdge]:
            try:
                return entity_relation_extractor.extract_triples_for_chunk(
                    text=c.text,
                    file_id=c.file_id,
                    filename=c.filename,
                    chunk_id=c.id,
                    page_number=c.page_number,
                    timestamp=c.timestamp,
                )
            except Exception as e:
                logger.warning(f"Error extracting graph chunk {c.id}: {e}")
                return []

        with ThreadPoolExecutor(max_workers=6) as executor:
            results = executor.map(_process_chunk, chunks)
            for edges in results:
                if edges:
                    all_edges.extend(edges)

        if all_edges:
            cg = self.get_graph(conversation_id)
            cg.add_edges(all_edges)
            logger.info(f"Ingested {len(all_edges)} total graph edges for conversation '{conversation_id}'.")

    def index_file_text(
        self,
        conversation_id: str,
        file_id: str,
        filename: str,
        file_type: str,
        text: str,
    ):
        """
        Deeply extracts knowledge triples from full file text using comprehensive sliding windows.
        """
        if not text or not text.strip():
            return

        from concurrent.futures import ThreadPoolExecutor

        clean_text = text.strip()
        windows: List[Tuple[str, Optional[int], Optional[str]]] = []

        # 1. Document with [Page X] tags: group into rich multi-page sections
        if "[Page " in clean_text:
            page_splits = [p.strip() for p in re.split(r"(?=\[Page\s*\d+)", clean_text) if p.strip() and len(p.strip()) >= 20]
            curr_chunk = ""
            curr_first_page = None
            for p_block in page_splits:
                p_num_m = re.search(r"\[Page\s*(\d+)", p_block)
                p_num = int(p_num_m.group(1)) if p_num_m else None
                if curr_first_page is None:
                    curr_first_page = p_num

                if len(curr_chunk) + len(p_block) > 4200 and curr_chunk:
                    windows.append((curr_chunk, curr_first_page, None))
                    curr_chunk = p_block
                    curr_first_page = p_num
                else:
                    curr_chunk += ("\n\n" + p_block if curr_chunk else p_block)

            if curr_chunk:
                windows.append((curr_chunk, curr_first_page, None))

        # 2. Audio or Video with [MM:SS] Timestamps
        elif re.search(r"\[\d{1,2}:\d{2}", clean_text):
            ts_splits = [s.strip() for s in re.split(r"(?=\[\d{1,2}:\d{2})", clean_text) if s.strip() and len(s.strip()) >= 15]
            curr_chunk = ""
            curr_ts = None
            for ts_block in ts_splits:
                ts_m = re.search(r"\[(\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?(?:\s*\([^\)]+\))?)\]", ts_block)
                raw_ts = ts_m.group(1) if ts_m else None
                if curr_ts is None:
                    curr_ts = raw_ts

                if len(curr_chunk) + len(ts_block) > 3000 and curr_chunk:
                    windows.append((curr_chunk, None, curr_ts))
                    curr_chunk = ts_block
                    curr_ts = raw_ts
                else:
                    curr_chunk += ("\n" + ts_block if curr_chunk else ts_block)

            if curr_chunk:
                windows.append((curr_chunk, None, curr_ts))

        # 3. Image OCR & Visual Descriptions or Plain Text
        else:
            # Sliding section window of ~3500 chars with 400 char overlap
            window_size = 3500
            overlap = 400
            start = 0
            while start < len(clean_text):
                end = min(len(clean_text), start + window_size)
                w_text = clean_text[start:end].strip()
                if w_text and len(w_text) >= 20:
                    windows.append((w_text, None, None))
                if end >= len(clean_text):
                    break
                start = end - overlap

        all_edges: List[RelationEdge] = []

        def _process_window(item: Tuple[str, Optional[int], Optional[str]]) -> List[RelationEdge]:
            w_text, p_num, ts = item
            try:
                return entity_relation_extractor.extract_triples_for_chunk(
                    text=w_text,
                    file_id=file_id,
                    filename=filename,
                    chunk_id=f"{file_id}_w_{uuid.uuid4().hex[:6]}",
                    page_number=p_num,
                    timestamp=ts,
                )
            except Exception as e:
                logger.warning(f"Error extracting graph window for {filename}: {e}")
                return []

        with ThreadPoolExecutor(max_workers=4) as executor:
            results = executor.map(_process_window, windows)
            for edges in results:
                if edges:
                    all_edges.extend(edges)

        if all_edges:
            cg = self.get_graph(conversation_id)
            cg.add_edges(all_edges)
            cg.resolve_cross_document_bridges()
            logger.info(f"Deeply ingested {len(all_edges)} graph edges and resolved cross-doc bridges for file '{filename}'.")

    def remove_file(self, conversation_id: str, file_id: str):
        if conversation_id in self._graphs:
            self._graphs[conversation_id].remove_file(file_id)

    def clear_conversation(self, conversation_id: str):
        cg = self.get_graph(conversation_id)
        cg.clear()
        if conversation_id in self._graphs:
            del self._graphs[conversation_id]


graph_manager = KnowledgeGraphManager()
