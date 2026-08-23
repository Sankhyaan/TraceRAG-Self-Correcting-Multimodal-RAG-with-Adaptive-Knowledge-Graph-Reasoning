"""
End-to-End File Manager & Storage Test for Phase 1.
Tests:
1. Multi-type file uploads (PDF, PNG, MP3, MP4, MKV)
2. Scoped listing and type filtering
3. Signed URL generation
4. Single file deletion from storage and DB
5. Clear all conversation files
"""

import sys
import io
import uuid
from pathlib import Path

# Add project root to sys.path first before local imports
BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Fix Windows console UTF-8 encoding
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


def create_sample_files():
    """Generates minimal valid dummy files for supported media types (including MKV)."""
    # 1. PDF Document
    pdf_bytes = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n115\n%%EOF"

    # 2. PNG Image (Valid 1x1 transparent PNG)
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\rIDATx\x9cc`\x00\x00\x00"
        b"\x02\x00\x01H\xaf\xa4q\x00\x00\x00\x00IEND\xaeB`\x82"
    )

    # 3. Audio (MP3 dummy buffer)
    mp3_bytes = b"ID3\x03\x00\x00\x00\x00\x00#TIT2\x00\x00\x00\x0b\x00\x00\x00Test Audio\xff\xfb\x90d\x00\x00"

    # 4. Video (MP4 dummy buffer with ftyp box)
    mp4_bytes = b"\x00\x00\x00 ftypisom\x00\x00\x02\x00isomiso2mp41\x00\x00\x00\x08free\x00\x00\x00\x10mdatTraceVideo"

    # 5. Video (MKV Matroska dummy buffer with EBML header)
    mkv_bytes = b"\x1a\x45\xdf\xa3\x93\x42\x86\x81\x01\x42\xf7\x81\x01\x42\xf2\x81\x04\x42\xf3\x81\x08\x42\x82\x88matroska"

    return [
        ("files", ("annual_report.pdf", io.BytesIO(pdf_bytes), "application/pdf")),
        ("files", ("diagram_chart.png", io.BytesIO(png_bytes), "image/png")),
        ("files", ("interview_record.mp3", io.BytesIO(mp3_bytes), "audio/mpeg")),
        ("files", ("product_demo.mp4", io.BytesIO(mp4_bytes), "video/mp4")),
        ("files", ("presentation_clip.mkv", io.BytesIO(mkv_bytes), "video/x-matroska")),
    ]


def test_file_manager_lifecycle():
    test_conv_id = f"test_conv_{uuid.uuid4().hex[:8]}"
    print("=" * 60)
    print(f"[*] Starting File Manager E2E Test (Session: {test_conv_id})")
    print("=" * 60)

    # STEP 1: Upload all 5 files including MKV
    print("\n[*] STEP 1: Uploading 5 files (PDF, PNG, MP3, MP4, MKV)...")
    sample_files = create_sample_files()
    upload_res = client.post(
        "/api/files/upload",
        data={"conversation_id": test_conv_id},
        files=sample_files,
    )
    assert upload_res.status_code == 200, f"Upload failed: {upload_res.text}"
    upload_data = upload_res.json()
    print(f"[+] Uploaded {upload_data['count']} files successfully!")
    for item in upload_data["uploaded"]:
        print(f"    - [{item['file_type'].upper()}] {item['filename']} (ID: {item['id'][:8]}...)")
    assert upload_data["count"] == 5
    assert len(upload_data["errors"]) == 0

    # STEP 2: List all files for conversation
    print("\n[*] STEP 2: Listing files for conversation...")
    list_res = client.get(f"/api/files?conversation_id={test_conv_id}")
    assert list_res.status_code == 200
    list_data = list_res.json()
    print(f"[+] Found {list_data['total']} total files:")
    print(f"    Type breakdown: {list_data['by_type']}")
    assert list_data["total"] == 5
    assert list_data["by_type"]["document"] == 1
    assert list_data["by_type"]["image"] == 1
    assert list_data["by_type"]["audio"] == 1
    assert list_data["by_type"]["video"] == 2  # MP4 and MKV

    # STEP 3: Test filtering by file_type
    print("\n[*] STEP 3: Testing file_type filter (type=video)...")
    video_filter_res = client.get(f"/api/files?conversation_id={test_conv_id}&file_type=video")
    assert video_filter_res.status_code == 200
    video_data = video_filter_res.json()
    video_names = [f["filename"] for f in video_data["files"]]
    print(f"[+] Filter returned {len(video_data['files'])} videos: {video_names}")
    assert len(video_data["files"]) == 2
    assert "presentation_clip.mkv" in video_names
    assert "product_demo.mp4" in video_names

    # STEP 4: Test Signed URL generation for MKV
    mkv_file = next(f for f in list_data["files"] if f["filename"] == "presentation_clip.mkv")
    print(f"\n[*] STEP 4: Requesting signed URL for {mkv_file['filename']}...")
    url_res = client.get(f"/api/files/{mkv_file['id']}/url")
    assert url_res.status_code == 200
    url_data = url_res.json()
    assert "signed_url" in url_data
    print(f"[+] Signed URL obtained: {url_data['signed_url'][:60]}...")

    # STEP 5: Delete single file
    delete_target = mkv_file
    print(f"\n[*] STEP 5: Deleting single file '{delete_target['filename']}'...")
    del_res = client.delete(f"/api/files/{delete_target['id']}")
    assert del_res.status_code == 200
    print(f"[+] File deleted: {del_res.json()}")

    # Verify count is now 4
    verify_res = client.get(f"/api/files?conversation_id={test_conv_id}")
    assert verify_res.json()["total"] == 4
    print(f"[+] Verified remaining count is 4")

    # STEP 6: Clear all remaining files for the conversation
    print(f"\n[*] STEP 6: Clearing all files for session {test_conv_id}...")
    clear_res = client.delete(f"/api/files/conversation/{test_conv_id}/clear")
    assert clear_res.status_code == 200
    clear_data = clear_res.json()
    print(f"[+] Cleared {clear_data['deleted_count']} files")
    assert clear_data["deleted_count"] == 4

    # Final check: total should be 0
    final_res = client.get(f"/api/files?conversation_id={test_conv_id}")
    assert final_res.json()["total"] == 0
    print(f"[+] Confirmed session is completely clean (0 files remaining)")

    print("\n" + "=" * 60)
    print("[+] PHASE 1 FILE MANAGER TEST (INCLUDING MKV) PASSED 100%!")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    test_file_manager_lifecycle()
