import logging
import uuid
from typing import List, Optional, Dict, Any
from qdrant_client import QdrantClient
from qdrant_client.http import models as rest
from qdrant_client.http.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue, MatchAny
from backend.config import get_settings
from backend.pipeline.chunker import DocumentChunk

logger = logging.getLogger("trace.vector_store")
settings = get_settings()


class VectorStore:
    """Manages dense vector storage and semantic search in Qdrant Cloud."""

    def __init__(self, collection_name: str = "trace_chunks", vector_size: int = 384):
        self.collection_name = collection_name
        self.vector_size = vector_size
        self._client: Optional[QdrantClient] = None

    @property
    def client(self) -> QdrantClient:
        """Initializes and returns the Qdrant client."""
        if self._client is None:
            if not settings.qdrant_url:
                raise ValueError("QDRANT_URL is not configured in .env")
            self._client = QdrantClient(
                url=settings.qdrant_url,
                api_key=settings.qdrant_api_key,
                timeout=20,
            )
            self.ensure_collection()
        return self._client

    def ensure_collection(self):
        """Ensures the collection exists with cosine distance and correct dimensions."""
        try:
            collections = self.client.get_collections().collections
            exists = any(c.name == self.collection_name for c in collections)

            if not exists:
                logger.info(f"Creating Qdrant collection '{self.collection_name}' (dim={self.vector_size})...")
                self.client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=VectorParams(size=self.vector_size, distance=Distance.COSINE),
                )
                # Create payload indexes for fast filtering
                self.client.create_payload_index(
                    collection_name=self.collection_name,
                    field_name="conversation_id",
                    field_schema=rest.PayloadSchemaType.KEYWORD,
                )
                self.client.create_payload_index(
                    collection_name=self.collection_name,
                    field_name="file_id",
                    field_schema=rest.PayloadSchemaType.KEYWORD,
                )
                self.client.create_payload_index(
                    collection_name=self.collection_name,
                    field_name="file_type",
                    field_schema=rest.PayloadSchemaType.KEYWORD,
                )
        except Exception as e:
            logger.warning(f"Qdrant collection setup notice: {str(e)}")

    def upsert_chunks(self, chunks: List[DocumentChunk], vectors: List[List[float]]) -> int:
        """Upserts a batch of document chunks and their embedding vectors into Qdrant."""
        if not chunks or not vectors or len(chunks) != len(vectors):
            return 0

        self.ensure_collection()
        points: List[PointStruct] = []

        for chunk, vector in zip(chunks, vectors):
            # Generate deterministic UUID for each chunk point
            point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, chunk.id))

            payload = {
                "chunk_id": chunk.id,
                "file_id": chunk.file_id,
                "conversation_id": chunk.conversation_id,
                "filename": chunk.filename,
                "file_type": chunk.file_type,
                "chunk_index": chunk.chunk_index,
                "text": chunk.text,
                "timestamp": chunk.timestamp,
                "page_number": chunk.page_number,
                "metadata": chunk.metadata,
            }

            points.append(PointStruct(id=point_id, vector=vector, payload=payload))

        self.client.upsert(collection_name=self.collection_name, points=points)
        logger.info(f"Upserted {len(points)} chunks into Qdrant collection '{self.collection_name}'.")
        return len(points)

    def search(
        self,
        query_vector: List[float],
        conversation_id: str,
        file_types: Optional[List[str]] = None,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """
        Searches Qdrant for semantic matches scoped to conversation_id and optional file_types.
        """
        self.ensure_collection()

        must_conditions = [
            FieldCondition(key="conversation_id", match=MatchValue(value=conversation_id))
        ]

        if file_types:
            must_conditions.append(
                FieldCondition(key="file_type", match=MatchAny(any=file_types))
            )

        query_filter = Filter(must=must_conditions)

        # Execute query using query_points or search
        try:
            results = self.client.search(
                collection_name=self.collection_name,
                query_vector=query_vector,
                query_filter=query_filter,
                limit=limit,
                with_payload=True,
            )
        except Exception:
            # Fallback to query_points for qdrant-client >= 1.10
            query_res = self.client.query_points(
                collection_name=self.collection_name,
                query=query_vector,
                query_filter=query_filter,
                limit=limit,
                with_payload=True,
            )
            results = query_res.points

        hits = []
        for r in results:
            payload = r.payload or {}
            hits.append({
                "chunk_id": payload.get("chunk_id", str(r.id)),
                "file_id": payload.get("file_id"),
                "conversation_id": payload.get("conversation_id"),
                "filename": payload.get("filename"),
                "file_type": payload.get("file_type"),
                "chunk_index": payload.get("chunk_index", 0),
                "text": payload.get("text", ""),
                "timestamp": payload.get("timestamp"),
                "page_number": payload.get("page_number"),
                "score": float(r.score),
                "metadata": payload.get("metadata", {}),
            })

        return hits

    def delete_file_chunks(self, file_id: str):
        """Deletes all vector points associated with a specific file_id."""
        try:
            self.client.delete(
                collection_name=self.collection_name,
                points_selector=models_points_selector(file_id=file_id),
            )
        except Exception as e:
            logger.warning(f"Notice deleting Qdrant points for file '{file_id}': {str(e)}")

    def delete_conversation_chunks(self, conversation_id: str):
        """Deletes all vector points associated with a conversation_id."""
        try:
            self.client.delete(
                collection_name=self.collection_name,
                points_selector=rest.FilterSelector(
                    filter=Filter(must=[FieldCondition(key="conversation_id", match=MatchValue(value=conversation_id))])
                ),
            )
        except Exception as e:
            logger.warning(f"Notice deleting Qdrant points for conv '{conversation_id}': {str(e)}")


def models_points_selector(file_id: str) -> rest.FilterSelector:
    return rest.FilterSelector(
        filter=Filter(must=[FieldCondition(key="file_id", match=MatchValue(value=file_id))])
    )


vector_store = VectorStore()
