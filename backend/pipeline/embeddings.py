import logging
from typing import List

logger = logging.getLogger("trace.embeddings")


class EmbeddingEngine:
    """Computes dense 384-dimensional semantic embeddings using Sentence-Transformers."""

    def __init__(self, model_name: str = "sentence-transformers/all-MiniLM-L6-v2"):
        self.model_name = model_name
        self._model = None

    @property
    def model(self):
        """Lazy load SentenceTransformer model on first invocation."""
        if self._model is None:
            logger.info(f"Loading SentenceTransformer model '{self.model_name}' on CPU...")
            from sentence_transformers import SentenceTransformer
            self._model = SentenceTransformer(self.model_name, device="cpu")
        return self._model

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """Generates normalized vector embeddings for a list of document chunks."""
        if not texts:
            return []
        embeddings = self.model.encode(
            texts,
            normalize_embeddings=True,
            show_progress_bar=False,
            convert_to_numpy=True,
        )
        return embeddings.tolist()

    def embed_query(self, query: str) -> List[float]:
        """Generates normalized vector embedding for a search query."""
        if not query:
            return [0.0] * 384
        embedding = self.model.encode(
            query,
            normalize_embeddings=True,
            show_progress_bar=False,
            convert_to_numpy=True,
        )
        return embedding.tolist()


embedding_engine = EmbeddingEngine()
