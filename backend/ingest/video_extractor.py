import os
import io
import tempfile
from pathlib import Path
from typing import List, Tuple, Dict, Any
from PIL import Image
from backend.ingest.audio_extractor import audio_extractor, format_timestamp
from backend.ingest.vision_client import vision_client


class VideoExtractor:
    """
    Extracts multimodal content from video files:
    1. Transcribes spoken audio with timestamps using Whisper.
    2. Samples keyframes at regular intervals (10-15s) and generates Vision LLM captions.
    3. Merges audio transcripts and visual captions in chronological order.
    """

    def extract(
        self,
        filename: str,
        video_bytes: bytes,
        sample_interval_sec: float = 12.0,
        max_keyframes: int = 6,
    ) -> str:
        ext = Path(filename).suffix.lower() or ".mp4"

        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(video_bytes)
            tmp_path = tmp.name

        try:
            timeline_items: List[Tuple[float, str]] = []

            # 1. Extract Spoken Audio Transcript with Whisper
            audio_items = self._transcribe_video_audio(tmp_path, filename)
            timeline_items.extend(audio_items)

            # 2. Extract Keyframes & Vision Captions
            frame_items = self._sample_and_caption_frames(
                tmp_path,
                filename,
                sample_interval_sec=sample_interval_sec,
                max_keyframes=max_keyframes,
            )
            timeline_items.extend(frame_items)

            # 3. Sort merged timeline by timestamp (seconds)
            timeline_items.sort(key=lambda item: item[0])

            if not timeline_items:
                return f"[Video Summary - {filename}]:\n(No extractable audio or visual content found in video)"

            header = f"[Video Multimodal Extraction - {filename}]:\n"
            content = "\n".join(item[1] for item in timeline_items)
            return header + content

        finally:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass

    def _transcribe_video_audio(self, video_path: str, filename: str) -> List[Tuple[float, str]]:
        """Transcribes the audio track of the video file using Faster-Whisper."""
        items: List[Tuple[float, str]] = []
        try:
            segments, info = audio_extractor.model.transcribe(
                video_path,
                beam_size=5,
                vad_filter=True,
            )

            for segment in segments:
                start_str = format_timestamp(segment.start)
                end_str = format_timestamp(segment.end)
                text = segment.text.strip()
                if text:
                    formatted = f"[{start_str} - {end_str} (Speech)]: {text}"
                    items.append((segment.start, formatted))
        except Exception as e:
            # Video might be silent (e.g. screen recording with no audio track)
            print(f"[VideoExtractor] Notice during audio extraction for '{filename}': {str(e)}")

        return items

    def _sample_and_caption_frames(
        self,
        video_path: str,
        filename: str,
        sample_interval_sec: float = 12.0,
        max_keyframes: int = 6,
    ) -> List[Tuple[float, str]]:
        """Samples frames at regular intervals and captions them with the Vision LLM."""
        items: List[Tuple[float, str]] = []

        try:
            import av

            container = av.open(video_path)
            video_stream = next((s for s in container.streams if s.type == "video"), None)
            if not video_stream:
                return items

            # Determine duration
            duration = float(video_stream.duration * video_stream.time_base) if video_stream.duration else 0.0
            if duration <= 0:
                duration = 60.0  # fallback estimation

            # Calculate target timestamps to sample
            target_timestamps = []
            current = 2.0  # Start 2 seconds in
            while current < duration and len(target_timestamps) < max_keyframes:
                target_timestamps.append(current)
                current += sample_interval_sec

            if not target_timestamps:
                target_timestamps = [0.5]

            # Sample frames using PyAV
            for target_sec in target_timestamps:
                try:
                    # Seek close to target timestamp
                    container.seek(int(target_sec / video_stream.time_base), stream=video_stream)
                    for frame in container.decode(video_stream):
                        img = frame.to_image()
                        buf = io.BytesIO()
                        img.save(buf, format="JPEG", quality=85)
                        img_bytes = buf.getvalue()

                        time_str = format_timestamp(target_sec)
                        prompt = (
                            f"Describe what is happening on screen in this keyframe at timestamp {time_str} from video '{filename}'. "
                            "Highlight key text, slides, actions, charts, people, or objects."
                        )

                        caption = vision_client.describe_image(
                            image_bytes=img_bytes,
                            mime_type="image/jpeg",
                            prompt=prompt,
                        )

                        formatted = f"[{time_str} (On-Screen Visual)]: {caption.strip()}"
                        items.append((target_sec, formatted))
                        break  # Only need 1 frame per seek
                except Exception as frame_err:
                    print(f"[VideoExtractor] Notice sampling frame at {target_sec}s: {str(frame_err)}")

            container.close()
        except Exception as e:
            print(f"[VideoExtractor] PyAV keyframe extraction notice: {str(e)}")

        return items


video_extractor = VideoExtractor()
