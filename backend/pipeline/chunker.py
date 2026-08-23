import re
import uuid
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any, Tuple


@dataclass
class DocumentChunk:
    id: str
    file_id: str
    conversation_id: str
    filename: str
    file_type: str
    chunk_index: int
    text: str
    timestamp: Optional[str] = None
    page_number: Optional[int] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "file_id": self.file_id,
            "conversation_id": self.conversation_id,
            "filename": self.filename,
            "file_type": self.file_type,
            "chunk_index": self.chunk_index,
            "text": self.text,
            "timestamp": self.timestamp,
            "page_number": self.page_number,
            "metadata": self.metadata,
        }


class Chunker:
    """
    Page-aware and contextual chunker that enriches chunks with document metadata,
    page boundaries, and timestamp references.
    """

    def __init__(self, target_chunk_size: int = 1800, overlap: int = 150):
        self.target_chunk_size = target_chunk_size
        self.overlap = overlap

    def chunk_document(
        self,
        file_id: str,
        conversation_id: str,
        filename: str,
        file_type: str,
        text: str,
    ) -> List[DocumentChunk]:
        if not text or not text.strip():
            return []

        clean_text = text.strip()

        # Clean document display label (e.g. 'prospectus_b_tech_cse' -> 'B.Tech CSE Prospectus')
        doc_label = filename.replace("_", " ").replace("-", " ")

        if "[Page " in clean_text:
            return self._chunk_by_pages(file_id, conversation_id, filename, file_type, clean_text, doc_label)

        return self._chunk_by_blocks(file_id, conversation_id, filename, file_type, clean_text, doc_label)

    def _chunk_by_pages(
        self,
        file_id: str,
        conversation_id: str,
        filename: str,
        file_type: str,
        text: str,
        doc_label: str,
    ) -> List[DocumentChunk]:
        """Splits document preserving page boundaries intact with contextual headers."""
        chunks: List[DocumentChunk] = []
        page_splits = re.split(r"(?=\[Page\s*\d+)", text)
        chunk_idx = 0

        for p_block in page_splits:
            p_block = p_block.strip()
            if not p_block:
                continue

            page_num = self._extract_page_number(p_block)
            context_header = f"[{filename} | Page {page_num}]\n" if page_num else f"[{filename}]\n"

            # Clean existing redundant [Page X] tags if any
            clean_body = re.sub(r"^\[Page\s*\d+(?:\s*\(OCR\))?\]\s*", "", p_block).strip()
            full_chunk_text = context_header + clean_body

            # If page is reasonably sized (< 2400 chars), keep whole page intact!
            if len(clean_body) <= 2400:
                chunks.append(
                    DocumentChunk(
                        id=f"{file_id}_chunk_{chunk_idx}",
                        file_id=file_id,
                        conversation_id=conversation_id,
                        filename=filename,
                        file_type=file_type,
                        chunk_index=chunk_idx,
                        text=full_chunk_text,
                        page_number=page_num,
                        metadata={"source": filename, "file_type": file_type, "page": page_num, "doc_label": doc_label},
                    )
                )
                chunk_idx += 1
            else:
                # Sub-chunk very large pages by section
                sub_blocks = re.split(r"\n\s*\n", clean_body)
                curr_text = ""
                for sb in sub_blocks:
                    sb = sb.strip()
                    if not sb:
                        continue
                    if len(curr_text) + len(sb) + 2 <= self.target_chunk_size:
                        curr_text = (curr_text + "\n\n" + sb).strip() if curr_text else sb
                    else:
                        if curr_text:
                            chunks.append(
                                DocumentChunk(
                                    id=f"{file_id}_chunk_{chunk_idx}",
                                    file_id=file_id,
                                    conversation_id=conversation_id,
                                    filename=filename,
                                    file_type=file_type,
                                    chunk_index=chunk_idx,
                                    text=context_header + curr_text,
                                    page_number=page_num,
                                    metadata={"source": filename, "file_type": file_type, "page": page_num, "doc_label": doc_label},
                                )
                            )
                            chunk_idx += 1
                        curr_text = sb

                if curr_text:
                    chunks.append(
                        DocumentChunk(
                            id=f"{file_id}_chunk_{chunk_idx}",
                            file_id=file_id,
                            conversation_id=conversation_id,
                            filename=filename,
                            file_type=file_type,
                            chunk_index=chunk_idx,
                            text=context_header + curr_text,
                            page_number=page_num,
                            metadata={"source": filename, "file_type": file_type, "page": page_num, "doc_label": doc_label},
                        )
                    )
                    chunk_idx += 1

        return chunks

    def _chunk_by_blocks(
        self,
        file_id: str,
        conversation_id: str,
        filename: str,
        file_type: str,
        text: str,
        doc_label: str,
    ) -> List[DocumentChunk]:
        """Chunks general text or transcripts by paragraphs, sentences, and timestamped lines."""
        # If timestamped lines exist (e.g. [00:15 - 00:28]), split by timestamp line boundaries!
        if re.search(r"\[\d{1,2}:\d{2}", text):
            blocks = [b.strip() for b in re.split(r"(?=\[\d{1,2}:\d{2})", text) if b.strip()]
        else:
            blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]

        chunks: List[DocumentChunk] = []
        current_chunk_text = ""
        current_timestamp = None
        current_page = None
        chunk_idx = 0
        context_header = f"[{filename}]\n"

        for block in blocks:
            if not block:
                continue

            block_ts, block_page = self._detect_first_marker(block)
            if not current_timestamp and block_ts:
                current_timestamp = block_ts
            if not current_page and block_page:
                current_page = block_page

            if len(current_chunk_text) + len(block) + 2 <= self.target_chunk_size:
                current_chunk_text = (current_chunk_text + "\n" + block).strip() if current_chunk_text else block
            else:
                if current_chunk_text:
                    chunks.append(
                        DocumentChunk(
                            id=f"{file_id}_chunk_{chunk_idx}",
                            file_id=file_id,
                            conversation_id=conversation_id,
                            filename=filename,
                            file_type=file_type,
                            chunk_index=chunk_idx,
                            text=context_header + current_chunk_text,
                            timestamp=current_timestamp,
                            page_number=current_page,
                            metadata={"source": filename, "file_type": file_type, "doc_label": doc_label},
                        )
                    )
                    chunk_idx += 1
                current_chunk_text = block
                current_timestamp = block_ts
                current_page = block_page

        if current_chunk_text:
            chunks.append(
                DocumentChunk(
                    id=f"{file_id}_chunk_{chunk_idx}",
                    file_id=file_id,
                    conversation_id=conversation_id,
                    filename=filename,
                    file_type=file_type,
                    chunk_index=chunk_idx,
                    text=context_header + current_chunk_text,
                    timestamp=current_timestamp,
                    page_number=current_page,
                    metadata={"source": filename, "file_type": file_type, "doc_label": doc_label},
                )
            )

        return chunks

    def _extract_page_number(self, text: str) -> Optional[int]:
        m = re.search(r"\[Page\s*(\d+)", text, re.IGNORECASE)
        if m:
            try:
                return int(m.group(1))
            except ValueError:
                pass
        return None

    def _detect_first_marker(self, text: str) -> Tuple[Optional[str], Optional[int]]:
        timestamp = None
        page = self._extract_page_number(text)

        ts_match = re.search(r"\[(\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?)\]", text)
        if ts_match:
            timestamp = ts_match.group(1)

        return timestamp, page


chunker = Chunker()
