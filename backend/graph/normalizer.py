import re
import json
import logging
from typing import Dict, List, Optional, Set, Tuple, Any
from backend.config import get_settings

logger = logging.getLogger("trace.graph.normalizer")

# Common honorifics and academic prefixes to strip for canonicalization
HONORIFICS = {
    "mr", "mrs", "ms", "miss", "dr", "prof", "professor", "advisor", "lead", "director", "dept", "department"
}

# Stop tokens to ignore during normalization
STOP_WORDS = {
    "the", "a", "an", "and", "or", "of", "in", "for", "with", "at", "by", "from", "to", "on"
}


def levenshtein_distance(s1: str, s2: str) -> int:
    """Computes standard Levenshtein edit distance between two strings."""
    if len(s1) < len(s2):
        return levenshtein_distance(s2, s1)
    if len(s2) == 0:
        return len(s1)

    previous_row = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row

    return previous_row[-1]


def normalized_similarity(s1: str, s2: str) -> float:
    """Returns normalized string similarity ratio between 0.0 and 1.0."""
    n1 = s1.lower().strip()
    n2 = s2.lower().strip()
    if n1 == n2:
        return 1.0
    if not n1 or not n2:
        return 0.0

    max_len = max(len(n1), len(n2))
    dist = levenshtein_distance(n1, n2)
    return 1.0 - (dist / max_len)


def strip_honorifics(text: str) -> str:
    """Strips leading honorifics like Mr., Dr., Prof., Advisor from entity names."""
    tokens = text.strip().split()
    if len(tokens) > 1 and tokens[0].lower().rstrip(".:,") in HONORIFICS:
        return " ".join(tokens[1:])
    return text


def canonicalize_entity_id(name: str) -> str:
    """
    Generates a deterministic canonical Node ID (e.g. 'ENTITY_DAVID_VANCE', 'ENTITY_PROJECT_TITAN').
    Normalizes punctuation, whitespace, and special characters.
    """
    if not name:
        return "ENTITY_UNKNOWN"

    raw = strip_honorifics(str(name).strip())

    # Remove outer punctuation, quotes, brackets
    clean = re.sub(r"^[\s\"'‘“\(\[\{,\.:;–—\-]+|[\s\"'’”\)\]\},\.:;–—\-]+$", "", raw)

    # Normalize special characters to underscores
    clean = re.sub(r"[\s\-_/\\|:,\.]+", "_", clean)
    clean = re.sub(r"[^\w]", "", clean)
    clean = re.sub(r"_+", "_", clean).strip("_").upper()

    if not clean:
        return "ENTITY_UNKNOWN"

    # Avoid leading digits alone
    if clean.isdigit():
        return f"ENTITY_VAL_{clean}"

    return f"ENTITY_{clean}"


def clean_mention_surface(mention: str) -> str:
    """Cleans raw surface mention for display name generation."""
    if not mention:
        return ""
    text = re.sub(r"\[.*?\]", "", str(mention))
    text = re.sub(r"^[\s\"'‘“\(\[\{,\.:;–—\-]+|[\s\"'’”\)\]\},\.:;–—\-]+$", "", text).strip()
    text = re.sub(r"\s+", " ", text)
    return text


class EntityResolver:
    """
    Full-Scale Hybrid Entity Resolution & Coreference Resolution Engine.
    Combines deterministic canonical ID generation, Levenshtein distance fuzzy matching,
    and LLM normalization to unify duplicate entity mentions into single canonical nodes.
    """

    def __init__(self):
        self.settings = get_settings()

    def resolve_entity(
        self,
        mention: str,
        existing_nodes: Optional[Dict[str, Dict[str, Any]]] = None,
        entity_type: str = "CONCEPT",
    ) -> Tuple[str, str]:
        """
        Resolves an entity mention against existing graph nodes.
        Returns (canonical_node_id, canonical_display_name).
        """
        clean = clean_mention_surface(mention)
        if not clean:
            return ("ENTITY_UNKNOWN", "Unknown")

        base_id = canonicalize_entity_id(clean)

        # 1. Exact match in existing nodes
        if existing_nodes:
            if base_id in existing_nodes:
                canonical_name = existing_nodes[base_id].get("name", clean)
                return (base_id, canonical_name)

            # 2. Check surface mention or aliases in existing nodes
            clean_lower = clean.lower()
            for node_id, node_data in existing_nodes.items():
                node_name = node_data.get("name", "")
                aliases = node_data.get("aliases", [])
                
                # Exact lower match with name or any alias
                if clean_lower == node_name.lower() or any(clean_lower == a.lower() for a in aliases):
                    return (node_id, node_name)

                # 3. Levenshtein Fuzzy Matching on clean names
                sim = normalized_similarity(clean, node_name)
                if sim >= 0.88 and len(clean) >= 4 and len(node_name) >= 4:
                    logger.debug(f"Fuzzy matched '{clean}' to existing node '{node_name}' (sim: {sim:.2f}) -> {node_id}")
                    return (node_id, node_name)

                # 4. Honorific / Prefix Substring match
                # e.g. "David Vance" vs "Mr. David Vance" or "Project Titan" vs "Titan Project"
                tokens_a = set(clean_lower.split()) - HONORIFICS - STOP_WORDS
                tokens_b = set(node_name.lower().split()) - HONORIFICS - STOP_WORDS
                if tokens_a and tokens_b and tokens_a == tokens_b:
                    logger.debug(f"Token matched '{clean}' to '{node_name}' -> {node_id}")
                    return (node_id, node_name)

        return (base_id, clean)

    def resolve_triples(
        self,
        raw_triples: List[Dict[str, Any]],
        existing_nodes: Optional[Dict[str, Dict[str, Any]]] = None,
        use_llm_coref: bool = False,
    ) -> List[Dict[str, Any]]:
        """
        Processes raw extracted triples through Entity Resolution.
        Rewrites source and target with canonical IDs and rich metadata.
        """
        if not raw_triples:
            return []

        resolved_nodes_registry: Dict[str, Dict[str, Any]] = dict(existing_nodes or {})
        resolved_triples: List[Dict[str, Any]] = []

        # Optional LLM Coreference Normalization pass for rich batches
        if use_llm_coref and len(raw_triples) >= 3 and self.settings.gemini_api_key:
            raw_triples = self._llm_coreference_pass(raw_triples)

        for triple in raw_triples:
            raw_src = triple.get("source", "")
            raw_tgt = triple.get("target", "")
            raw_rel = triple.get("relation", "RELATES_TO")
            evidence = triple.get("evidence", "")

            src_type = triple.get("source_type", "CONCEPT")
            tgt_type = triple.get("target_type", "CONCEPT")

            src_id, src_name = self.resolve_entity(raw_src, resolved_nodes_registry, src_type)
            tgt_id, tgt_name = self.resolve_entity(raw_tgt, resolved_nodes_registry, tgt_type)

            # Prevent self-referential relations
            if src_id == tgt_id or src_id == "ENTITY_UNKNOWN" or tgt_id == "ENTITY_UNKNOWN":
                continue

            # Register resolved nodes for subsequent triples in this batch
            if src_id not in resolved_nodes_registry:
                resolved_nodes_registry[src_id] = {
                    "id": src_id,
                    "name": src_name,
                    "type": src_type,
                    "aliases": [raw_src, src_name] if raw_src != src_name else [src_name],
                }
            else:
                existing_aliases = resolved_nodes_registry[src_id].get("aliases", [])
                if raw_src not in existing_aliases:
                    existing_aliases.append(raw_src)
                    resolved_nodes_registry[src_id]["aliases"] = existing_aliases

            if tgt_id not in resolved_nodes_registry:
                resolved_nodes_registry[tgt_id] = {
                    "id": tgt_id,
                    "name": tgt_name,
                    "type": tgt_type,
                    "aliases": [raw_tgt, tgt_name] if raw_tgt != tgt_name else [tgt_name],
                }
            else:
                existing_aliases = resolved_nodes_registry[tgt_id].get("aliases", [])
                if raw_tgt not in existing_aliases:
                    existing_aliases.append(raw_tgt)
                    resolved_nodes_registry[tgt_id]["aliases"] = existing_aliases

            # Normalize relation string to UPPERCASE_SNAKE_CASE
            clean_rel = re.sub(r"[\s\-]+", "_", str(raw_rel).strip()).upper()
            clean_rel = re.sub(r"[^\w]", "", clean_rel)

            resolved_item = {
                "source_id": src_id,
                "source_name": src_name,
                "source_type": src_type,
                "raw_source": raw_src,
                "relation": clean_rel,
                "target_id": tgt_id,
                "target_name": tgt_name,
                "target_type": tgt_type,
                "raw_target": raw_tgt,
                "evidence": evidence,
                "start_timestamp": triple.get("start_timestamp"),
                "end_timestamp": triple.get("end_timestamp"),
                "frame_id": triple.get("frame_id"),
                "bounding_box": triple.get("bounding_box") or triple.get("bbox"),
                "spatial_location": triple.get("spatial_location") or triple.get("spatial_region"),
            }
            resolved_triples.append(resolved_item)

        return resolved_triples

    def _llm_coreference_pass(self, raw_triples: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Uses LLM to perform contextual coreference resolution on entity mentions in the batch.
        """
        try:
            from google import genai
            from google.genai import types

            mentions = set()
            for t in raw_triples:
                if t.get("source"):
                    mentions.add(t["source"])
                if t.get("target"):
                    mentions.add(t["target"])

            if len(mentions) < 3:
                return raw_triples

            prompt = f"""You are an Entity Resolution and Coreference Normalizer.
Given this list of entity mentions from a document, group all co-referent names (e.g. abbreviations, acronyms, title variants, pronouns) to their single canonical full name.

Entity Mentions:
{json.dumps(list(mentions), indent=2)}

Return ONLY a JSON mapping from each original mention to its canonical standardized name:
{{
  "original_mention": "Canonical Standardized Name"
}}"""

            client = genai.Client(api_key=self.settings.gemini_api_key)
            resp = client.models.generate_content(
                model=self.settings.gemini_model or "gemini-3.6-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.0,
                    max_output_tokens=1024,
                ),
            )
            raw = resp.text.strip() if resp.text else "{}"
            if raw.startswith("```"):
                raw = re.sub(r"^```(?:json)?\s*", "", raw)
                raw = re.sub(r"\s*```$", "", raw)
            mapping = json.loads(raw)

            if isinstance(mapping, dict):
                for t in raw_triples:
                    src = t.get("source")
                    tgt = t.get("target")
                    if src in mapping and mapping[src]:
                        t["source"] = mapping[src]
                    if tgt in mapping and mapping[tgt]:
                        t["target"] = mapping[tgt]
        except Exception as e:
            logger.debug(f"LLM coreference normalization pass skipped: {e}")

        return raw_triples


entity_resolver = EntityResolver()
