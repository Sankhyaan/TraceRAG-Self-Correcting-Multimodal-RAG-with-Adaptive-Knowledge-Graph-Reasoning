import os
import tempfile
from pathlib import Path
from typing import Optional, List, Tuple


def format_timestamp(seconds: float) -> str:
    """Formats float seconds to MM:SS or HH:MM:SS string."""
    mins, secs = divmod(int(seconds), 60)
    hours, mins = divmod(mins, 60)
    if hours > 0:
        return f"{hours:02d}:{mins:02d}:{secs:02d}"
    return f"{mins:02d}:{secs:02d}"


class AudioExtractor:
    """Transcribes audio files into timestamped text segments using Faster-Whisper."""

    def __init__(self):
        self._model = None

    @property
    def model(self):
        """Lazy loads Faster-Whisper model on first transcription request."""
        if self._model is None:
            try:
                from faster_whisper import WhisperModel

                # Use 'base' model on CPU with int8 quantization for speed & low memory footprint
                self._model = WhisperModel("base", device="cpu", compute_type="int8")
            except Exception as e:
                raise RuntimeError(f"Failed to initialize Faster-Whisper: {str(e)}")
        return self._model

    def extract(self, filename: str, audio_bytes: bytes) -> str:
        """
        Transcribes audio bytes and returns timestamp-annotated transcript segments.
        """
        ext = Path(filename).suffix.lower() or ".mp3"

        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        try:
            segments, info = self.model.transcribe(
                tmp_path,
                beam_size=5,
                language=None,  # Auto-detect language
                vad_filter=True,  # Voice activity detection to filter silence
            )

            lines = []
            for segment in segments:
                start_str = format_timestamp(segment.start)
                end_str = format_timestamp(segment.end)
                text = segment.text.strip()
                if text:
                    lines.append(f"[{start_str} - {end_str}] {text}")

            if not lines:
                return f"[Audio Transcript - {filename}]:\n(No audible speech detected in audio file)"

            header = f"[Audio Transcript - {filename} (Language: {info.language}, Duration: {int(info.duration)}s)]:\n"
            return header + "\n".join(lines)
        except Exception as e:
            raise RuntimeError(f"Audio transcription failed for '{filename}': {str(e)}")
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass


audio_extractor = AudioExtractor()
