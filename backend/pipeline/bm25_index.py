import re
import logging
from typing import List, Dict, Tuple, Optional, Any
from rank_bm25 import BM25Plus
from backend.pipeline.chunker import DocumentChunk

logger = logging.getLogger("trace.bm25")

ORDINAL_MAP = {
    "1st": "first", "first": "1st",
    "2nd": "second", "second": "2nd",
    "3rd": "third", "third": "3rd",
    "4th": "fourth", "fourth": "4th",
    "5th": "fifth", "fifth": "5th",
    "6th": "sixth", "sixth": "6th",
    "7th": "seventh", "seventh": "7th",
    "8th": "eighth", "eighth": "8th",
    "9th": "ninth", "ninth": "9th",
    "10th": "tenth", "tenth": "10th",
}

# Comprehensive stopword set including conversational filler, query adverbs, and generic nouns
STOPWORDS = {
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't",
    "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
    "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't",
    "down", "during", "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't", "have",
    "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself", "him",
    "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't",
    "it", "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my", "myself", "no", "nor",
    "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out",
    "over", "own", "same", "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so",
    "some", "such", "than", "that", "that's", "the", "their", "theirs", "them", "themselves", "then",
    "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've", "this", "those",
    "through", "to", "too", "under", "until", "up", "very", "was", "wasn't", "we", "we'd", "we'll",
    "we're", "we've", "were", "weren't", "what", "what's", "when", "when's", "where", "where's", "which",
    "while", "who", "who's", "whom", "why", "why's", "with", "won't", "would", "wouldn't", "you",
    "you'd", "you'll", "you're", "you've", "your", "yours", "yourself", "yourselves",
    # Conversational adverbs, filler, and query metadata words
    "actually", "instead", "later", "earlier", "rather", "repeating", "repeat", "repeated",
    "explain", "explained", "explaining", "reference", "referenced", "referencing", "show", "tell",
    "give", "find", "mentions", "stated", "talks", "talking", "etc", "also", "well", "really",
    "simply", "basically", "exactly", "like", "just", "query", "document", "doc", "docs", "file",
    "files", "information", "detail", "details", "mention", "mentioned", "contain", "contains",
    "say", "says", "said", "ask", "asked", "please", "help",
}


def stem(word: str) -> str:
    """Lightweight morphological stemmer for English plurals and standard suffixes."""
    w = word.lower()
    if len(w) <= 3:
        return w
    if w.endswith("ies") and len(w) > 4:
        return w[:-3] + "y"
    if w.endswith("es") and len(w) > 3 and not w.endswith(("ses", "zes", "ches", "shes")):
        return w[:-1]
    if w.endswith("s") and not w.endswith("ss") and len(w) > 3:
        return w[:-1]
    if w.endswith("ing") and len(w) > 4:
        return w[:-3]
    if w.endswith("ed") and len(w) > 4:
        return w[:-2]
    return w


def tokenize(text: str, remove_stopwords: bool = False, apply_stem: bool = True) -> List[str]:
    """
    Generalized lexical tokenizer with word boundary splitting on slashes/symbols,
    stemming, ordinal mapping, and acronym preservation.
    """
    # Split on all non-alphanumeric characters (including / and .)
    raw_tokens = re.findall(r"\b[a-zA-Z0-9_]+\b", text.lower())
    expanded_tokens: List[str] = []

    for tok in raw_tokens:
        clean_tok = tok.strip("-_.")
        if not clean_tok or len(clean_tok) < 2:
            continue

        if remove_stopwords and clean_tok in STOPWORDS:
            continue

        expanded_tokens.append(clean_tok)

        # Morphological stem
        if apply_stem:
            stemmed = stem(clean_tok)
            if stemmed != clean_tok:
                expanded_tokens.append(stemmed)

        # Ordinal mapping
        if clean_tok in ORDINAL_MAP:
            expanded_tokens.append(ORDINAL_MAP[clean_tok])

    return expanded_tokens


class ConversationBM25:
    """Manages BM25Plus index for a single conversation."""

    def __init__(self, conversation_id: str):
        self.conversation_id = conversation_id
        self.chunks: List[DocumentChunk] = []
        self.tokenized_corpus: List[List[str]] = []
        self.bm25: Optional[BM25Plus] = None

    def add_chunks(self, chunks: List[DocumentChunk]):
        existing_ids = {c.id for c in self.chunks}
        new_chunks = [c for c in chunks if c.id not in existing_ids]

        if not new_chunks:
            return

        self.chunks.extend(new_chunks)
        self._rebuild()

    def remove_file(self, file_id: str):
        self.chunks = [c for c in self.chunks if c.file_id != file_id]
        self._rebuild()

    def clear(self):
        self.chunks = []
        self.tokenized_corpus = []
        self.bm25 = None

    def _rebuild(self):
        if not self.chunks:
            self.tokenized_corpus = []
            self.bm25 = None
            return

        self.tokenized_corpus = [tokenize(c.text, remove_stopwords=False) for c in self.chunks]
        self.bm25 = BM25Plus(self.tokenized_corpus)

    def search(
        self,
        query: str,
        file_types: Optional[List[str]] = None,
        top_k: int = 10,
    ) -> List[Tuple[DocumentChunk, float]]:
        if not self.bm25 or not self.chunks:
            return []

        # Tokenize query with stopwords stripped so filler words are not queried
        tokenized_query = tokenize(query, remove_stopwords=True)
        if not tokenized_query:
            # Fallback if all query words were in stopwords
            tokenized_query = tokenize(query, remove_stopwords=False)
            if not tokenized_query:
                return []

        raw_scores = self.bm25.get_scores(tokenized_query)
        max_score = max(raw_scores) if len(raw_scores) > 0 else 0.0

        if max_score <= 0.0:
            return []

        scored_chunks: List[Tuple[DocumentChunk, float]] = []

        for chunk, score in zip(self.chunks, raw_scores):
            if score <= 0.0:
                continue

            if file_types and chunk.file_type not in file_types:
                continue

            normalized_score = score / max_score
            scored_chunks.append((chunk, normalized_score))

        scored_chunks.sort(key=lambda x: x[1], reverse=True)
        return scored_chunks[:top_k]

    def get_idf(self, word: str) -> float:
        """Returns the statistical IDF (Inverse Document Frequency) of a term in this corpus."""
        if not self.bm25 or not hasattr(self.bm25, "idf"):
            return 1.0
        return max(0.05, float(self.bm25.idf.get(word, 1.0)))


class BM25IndexManager:
    """Registry maintaining per-conversation BM25Plus indices."""

    def __init__(self):
        self._indices: Dict[str, ConversationBM25] = {}

    def get_index(self, conversation_id: str) -> ConversationBM25:
        if conversation_id not in self._indices:
            self._indices[conversation_id] = ConversationBM25(conversation_id)
        return self._indices[conversation_id]

    def get_idf(self, conversation_id: str, word: str) -> float:
        """Retrieves the corpus IDF for a specific token in a conversation."""
        if conversation_id in self._indices:
            return self._indices[conversation_id].get_idf(word)
        return 1.0

    def add_chunks(self, conversation_id: str, chunks: List[DocumentChunk]):
        index = self.get_index(conversation_id)
        index.add_chunks(chunks)

    def remove_file(self, conversation_id: str, file_id: str):
        if conversation_id in self._indices:
            self._indices[conversation_id].remove_file(file_id)

    def clear_conversation(self, conversation_id: str):
        if conversation_id in self._indices:
            self._indices[conversation_id].clear()
            del self._indices[conversation_id]

    def search(
        self,
        conversation_id: str,
        query: str,
        file_types: Optional[List[str]] = None,
        top_k: int = 10,
    ) -> List[Tuple[DocumentChunk, float]]:
        index = self.get_index(conversation_id)
        return index.search(query=query, file_types=file_types, top_k=top_k)


bm25_manager = BM25IndexManager()
