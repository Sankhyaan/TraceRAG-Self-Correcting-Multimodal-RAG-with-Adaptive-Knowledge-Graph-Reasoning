import os
import json
import uuid
import shutil
import logging
import threading
from datetime import datetime
from typing import Dict, Any, List, Optional
from pathlib import Path


from backend.storage import get_supabase, storage_service
from backend.ingest.manager import extraction_manager
from backend.graph.engine import graph_manager
from backend.pipeline.retriever import hybrid_retriever
from backend.pipeline.bm25_index import bm25_manager
from backend.pipeline.vector_store import vector_store

logger = logging.getLogger("trace.demo")

DEMO_CONV_ID = "conv_demo"
DEMO_TITLE = "VoltBus Engineering & Route 101 Operations"

DEMO_FILES_DIR = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "data", "demo_files"
)
GRAPHS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "data", "graphs"
)
CONVERSATIONS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "data", "conversations"
)
os.makedirs(GRAPHS_DIR, exist_ok=True)
os.makedirs(CONVERSATIONS_DIR, exist_ok=True)


CANONICAL_DEMO_FILES: List[Dict[str, Any]] = [
    {
        "id": "demo_file_pdf_1",
        "conversation_id": DEMO_CONV_ID,
        "filename": "VoltBus_Master_Operations_Engineering_Brief_Clean.pdf",
        "file_type": "document",
        "storage_path": f"{DEMO_CONV_ID}/VoltBus_Master_Operations_Engineering_Brief_Clean.pdf",
        "storage_url": "/demo_files/VoltBus_Master_Operations_Engineering_Brief_Clean.pdf",
        "file_size_bytes": 329553,
        "mime_type": "application/pdf",
        "status": "done",
        "extracted_text": "[VoltBus_Master_Operations_Engineering_Brief_Clean.pdf | Executive Summary & Program Objectives]\nVoltBus Urban Transit System (VUTS)\nMaster Operations & Engineering Brief\nLead Agency: Metro Mobility Innovation Group (MMIG)\nChief Systems Architect: Elena Rostova | Issue Date: August 21, 2026\n\nPhase II Controlled Pilot active on Route 101 connecting 12 smart stations (14.2 km corridor) with Depot-Alpha (North District) and Depot-Gamma (South District).\n\nMaintenance SOP & Thermal Thresholds:\nLevel 0: Normal (<42°C)\nLevel 1 Warning (42°C - 48°C): Ramps cooling pumps to 100%, throttles fast charging.\nLevel 2 Critical (>48°C): Terminates fast charging, reroutes to Depot-Gamma for DR-88 diagnostic battery pack check.\nLevel 3 Emergency (>55°C): Emergency HV contactor disconnect, automated fire suppression prep, passenger evacuation.",
        "uploaded_at": "2026-08-23T00:00:00Z",
    },
    {
        "id": "demo_file_img_1",
        "conversation_id": DEMO_CONV_ID,
        "filename": "voltbus_v3_schematic.png",
        "file_type": "image",
        "storage_path": f"{DEMO_CONV_ID}/voltbus_v3_schematic.png",
        "storage_url": "/demo_files/voltbus_v3_schematic.png",
        "file_size_bytes": 2175694,
        "mime_type": "image/png",
        "status": "done",
        "extracted_text": "[Visual Description - voltbus_v3_schematic.png]:\nHardware engineering blueprint and schematic wiring diagram for the VoltBus V3 12-Meter Low-Floor Electric Bus.\n- Power & Propulsion: Dual liquid-cooled Lithium Iron Phosphate (LFP2) battery packs, 600 kWh total storage, 650V nominal bus voltage, 923 Ah capacity.\n- Drivetrain: 4x 150 kW Permanent Magnet Synchronous Motors (PMSM) configured as dual-axle electronic all-wheel drive.\n- Charging Interface: 450 kW overhead pantograph ultra-fast charging receiver located on roof module B.\n- Thermal Management System (TMS): Active chiller loop with glycol-water coolant, high-capacity dual electric water pumps (P-101 and P-102), and proportional bypass valve.\n- Autonomous Compute Cluster: Perception OS 4.2 redundant dual ECUs with CAN-FD and Automotive Ethernet backbones.",
        "uploaded_at": "2026-08-23T00:00:00Z",
    },
    {
        "id": "demo_file_img_2",
        "conversation_id": DEMO_CONV_ID,
        "filename": "route101_network_map.png",
        "file_type": "image",
        "storage_path": f"{DEMO_CONV_ID}/route101_network_map.png",
        "storage_url": "/demo_files/route101_network_map.png",
        "file_size_bytes": 1586576,
        "mime_type": "image/png",
        "status": "done",
        "extracted_text": "[Visual Description - route101_network_map.png]:\nA digital infographic displaying the network map and station topography for the Route 101 Smart Transit Corridor.\n- Corridor length: 14.2 km corridor connecting Northern Districts to Downtown.\n- 12 Smart Transit Stations: 1. Maple Ave, 2. Pine Road, 3. Lakeview, 4. Central Park, 5. Museum, 6. City Plaza, 7. Oak Street (Incident Site: Level 1 Thermal Warning at 39°C heatwave), 8. Riverside, 9. Union Station, 10. Grandview, 11. Southside, 12. Metro Terminal Hub.\n- Maintenance Depots: Depot-Alpha (North District - structural & chassis) and Depot-Gamma (South District - battery & firmware).",
        "uploaded_at": "2026-08-23T00:00:00Z",
    },
    {
        "id": "demo_file_img_3",
        "conversation_id": DEMO_CONV_ID,
        "filename": "thermal_safety_flowchart.png",
        "file_type": "image",
        "storage_path": f"{DEMO_CONV_ID}/thermal_safety_flowchart.png",
        "storage_url": "/demo_files/thermal_safety_flowchart.png",
        "file_size_bytes": 1608457,
        "mime_type": "image/png",
        "status": "done",
        "extracted_text": "[Visual Description - thermal_safety_flowchart.png]:\nMulti-Tier Operational Escalation Protocol & Thermal Safety Flowchart for VoltBus V3 Fleet.\n- State 0 (<42°C): Nominal cruising and regenerative braking. Standard TMS cooling circulation.\n- State 1 (42°C - 48°C) Warning Alert: Automatic ramp of dual coolant pumps to 100% capacity; fast-charge power throttled to maximum 150 kW; telemetry event logged to Marcus Vance's dispatch console.\n- State 2 (>48°C) Critical Fault: Immediate charge cessation; bus held at station until pack temperature drops <44°C; automatic maintenance reroute to Depot-Gamma for David Miller's DR-88 diagnostic cell imbalance check.\n- State 3 (>55°C) Emergency: Pyro-fuse isolation, HV battery contactor trip, automated aerosol fire suppression arming, passenger emergency evacuation protocol.",
        "uploaded_at": "2026-08-23T00:00:00Z",
    },
    {
        "id": "demo_file_aud_1",
        "conversation_id": DEMO_CONV_ID,
        "filename": "voltbus_route101_debrief.mp3",
        "file_type": "audio",
        "storage_path": f"{DEMO_CONV_ID}/voltbus_route101_debrief.mp3",
        "storage_url": "/demo_files/voltbus_route101_debrief.mp3",
        "file_size_bytes": 6433131,
        "mime_type": "audio/mpeg",
        "status": "done",
        "extracted_text": "[Audio Transcript - voltbus_route101_debrief.mp3 (Language: en, Duration: 267s)]:\n[00:00 - 00:04] Elena Rostova: Good morning, everyone. This is Elena Rostova, Chief Systems Architect.\n[00:04 - 00:13] Today is August 21st, 2026, and we are kicking off our monthly engineering review for phase two operations on Route 101.\n[00:13 - 00:20] On the line, we have Marcus Vance from Operations at the Metro Terminal Hub and David Miller, lead technician down at Depot Gamma.\n[00:20 - 00:24] Elena: Marcus, let's start with high-level throughput.\n[00:24 - 00:34] Marcus Vance: Thanks, Elena. Route 101 has had a solid month overall. We cleared approximately 48,000 passenger rides across our 12 smart stations.\n[00:34 - 00:41] The 14.2 km corridor is holding an average end-to-end travel time of about 24 minutes.\n[00:41 - 00:52] Over at the Metro Terminal Hub, our 450 kilowatt-pantograph charger is averaging 6 to 8 minutes per rapid top-up, keeping our turnaround times tight.\n[00:52 - 01:03] Elena: Now let's dig into the primary incident from last month's log: the thermal event on July 12 involving VoltBus Unit No. 09.\n[01:03 - 01:17] Marcus: Ambient ground temp reached 39 degrees Celsius at Stop 7, Oak Street. Unit No. 09 had just logged back to back 450 kilowatt rapid charges within a 45-minute window.\n[01:17 - 01:43] Marcus: As it arrived at Stop 7, the internal sensor suite flagged an LFP2 battery pack temperature crossing 48 degrees Celsius, triggering a level 1 warning state in Perception OS 4.2.\n[01:43 - 02:15] David Miller: The cooling pumps immediately ramped to 100%, and the pack cooled down within 14 minutes without taking the bus out of passenger service. We also performed the DR-88 battery check at Depot-Gamma and confirmed cell resistance balance was within 1.2% nominal.\n[02:15 - 02:40] Elena: Follow-up action: we have enacted a hard operational rule restricting Stop 7 layovers to a single 450 kW charge when ambient temperatures exceed 35°C.",
        "uploaded_at": "2026-08-23T00:00:00Z",
    },
]


def get_demo_files() -> List[Dict[str, Any]]:
    """Returns canonical demo file records."""
    return [dict(f) for f in CANONICAL_DEMO_FILES]


def get_demo_file_by_id(file_id: str) -> Optional[Dict[str, Any]]:
    """Finds a canonical demo file by ID or filename substring."""
    for f in CANONICAL_DEMO_FILES:
        if f["id"] == file_id or f["filename"] == file_id:
            return dict(f)
    return None


def get_demo_conversation() -> Dict[str, Any]:
    """Returns the canonical demo conversation item."""
    file_count = len(CANONICAL_DEMO_FILES)
    message_count = 2
    try:
        supabase = get_supabase()
        f_res = supabase.table("files").select("id").eq("conversation_id", DEMO_CONV_ID).execute()
        if f_res.data and len(f_res.data) > 0:
            file_count = len(f_res.data)
    except Exception:
        pass

    try:
        supabase = get_supabase()
        m_res = supabase.table("messages").select("id").eq("conversation_id", DEMO_CONV_ID).execute()
        if m_res.data and len(m_res.data) > 0:
            message_count = len(m_res.data)
    except Exception:
        pass

    return {
        "id": DEMO_CONV_ID,
        "title": DEMO_TITLE,
        "file_count": file_count,
        "message_count": message_count,
        "created_at": "2026-08-23T00:00:00Z",
        "updated_at": datetime.utcnow().isoformat(),
        "is_demo": True,
    }


def seed_demo_workspace() -> Dict[str, Any]:
    """
    Ingests and indexes all 5 VoltBus demo files into conv_demo if not already present.
    Also builds the canonical knowledge graph and sample grounded Q&A messages.
    """
    supabase = get_supabase()
    now_iso = datetime.utcnow().isoformat()

    # 1. Ensure conversation record exists
    try:
        supabase.table("conversations").upsert({
            "id": DEMO_CONV_ID,
            "title": DEMO_TITLE,
            "user_id": None,
            "created_at": now_iso,
            "updated_at": now_iso,
        }).execute()
    except Exception as e:
        logger.warning(f"Notice upserting demo conversation: {e}")

    # 2. Check existing files for conv_demo
    existing_files: Dict[str, Dict[str, Any]] = {}
    try:
        f_res = supabase.table("files").select("*").eq("conversation_id", DEMO_CONV_ID).execute()
        for f in f_res.data or []:
            existing_files[f["filename"]] = f
    except Exception as e:
        logger.warning(f"Notice checking existing demo files: {e}")

    # 3. Process each demo file from data/demo_files/
    if os.path.exists(DEMO_FILES_DIR):
        for fname in sorted(os.listdir(DEMO_FILES_DIR)):
            fpath = os.path.join(DEMO_FILES_DIR, fname)
            if not os.path.isfile(fpath):
                continue

            # If already in DB with status done, verify and ensure storage object exists
            if fname in existing_files and existing_files[fname].get("status") == "done":
                storage_path = existing_files[fname].get("storage_path")
                if storage_path:
                    try:
                        with open(fpath, "rb") as f:
                            file_bytes = f.read()
                        ext = Path(fname).suffix.lower()
                        mime = "application/octet-stream"
                        if ext == ".pdf":
                            mime = "application/pdf"
                        elif ext in (".png", ".webp"):
                            mime = f"image/{ext[1:]}"
                        elif ext in (".jpg", ".jpeg"):
                            mime = "image/jpeg"
                        elif ext == ".mp3":
                            mime = "audio/mpeg"
                        elif ext == ".mp4":
                            mime = "video/mp4"
                        supabase.storage.from_(storage_service.bucket).upload(
                            storage_path,
                            file_bytes,
                            {"content-type": mime, "upsert": "true"},
                        )
                    except Exception as e:
                        logger.debug(f"Storage ensure notice for '{fname}': {e}")
                logger.info(f"Demo file '{fname}' verified in database and storage.")
                continue

            try:
                with open(fpath, "rb") as f:
                    file_bytes = f.read()

                # Determine mime type
                ext = Path(fname).suffix.lower()
                mime = "application/octet-stream"
                if ext == ".pdf":
                    mime = "application/pdf"
                elif ext in (".png", ".webp"):
                    mime = f"image/{ext[1:]}"
                elif ext in (".jpg", ".jpeg"):
                    mime = "image/jpeg"
                elif ext == ".mp3":
                    mime = "audio/mpeg"
                elif ext == ".mp4":
                    mime = "video/mp4"

                # Upload to storage
                record = storage_service.upload_file(
                    conversation_id=DEMO_CONV_ID,
                    filename=fname,
                    file_bytes=file_bytes,
                    content_type=mime,
                    user_id=None,
                )
                file_id = record["id"]
                file_type = record["file_type"]

                # Extract and index
                extracted_text = extraction_manager.process_file(
                    file_id=file_id,
                    filename=fname,
                    file_type=file_type,
                    file_bytes=file_bytes,
                    mime_type=mime,
                    conversation_id=DEMO_CONV_ID,
                )

                # Extract knowledge graph entities & relationships
                if extracted_text:
                    try:
                        graph_manager.index_file_text(
                            conversation_id=DEMO_CONV_ID,
                            file_id=file_id,
                            filename=fname,
                            file_type=file_type,
                            text=extracted_text,
                        )
                    except Exception as e:
                        logger.warning(f"Notice building demo graph for '{fname}': {e}")
            except Exception as err:
                logger.error(f"Error seeding demo file '{fname}': {err}")



    # 4. Ensure demo messages exist
    seed_demo_messages()

    return get_demo_conversation()


def seed_demo_messages():
    """Seeds rich sample Q&A pairs for the VoltBus demo workspace."""
    supabase = get_supabase()
    msgs_path = os.path.join(CONVERSATIONS_DIR, f"{DEMO_CONV_ID}_messages.json")
    seeded_json_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "demo_messages_seeded.json")

    sample_msgs = []
    if os.path.exists(seeded_json_path):
        try:
            with open(seeded_json_path, "r", encoding="utf-8") as f:
                sample_msgs = json.load(f)
        except Exception as e:
            logger.warning(f"Failed to read {seeded_json_path}: {e}")

    if not sample_msgs:
        # Fallback default interaction
        sample_msgs = [
            {
                "id": "msg_demo_1",
                "conversation_id": DEMO_CONV_ID,
                "role": "user",
                "content": "What hardware components and thermal thresholds govern the VoltBus V3 battery system, and what occurred during the July 12 incident at Stop 7?",
                "created_at": "2026-08-23T00:01:00Z",
            }
        ]

    # Save to Supabase
    for m in sample_msgs:
        try:
            supabase.table("messages").upsert(m).execute()
        except Exception:
            pass

    # Save to local mirror
    try:
        with open(msgs_path, "w", encoding="utf-8") as f:
            json.dump(sample_msgs, f, indent=2)
    except Exception as e:
        logger.warning(f"Notice writing local demo messages: {e}")



def clone_demo_workspace(user_id: str, new_conv_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Clones the canonical demo workspace into an authenticated user's private workspace.
    This copies files, messages, graph JSON, and indexes chunks for the new conversation.
    """
    supabase = get_supabase()
    target_conv_id = new_conv_id or f"conv_{uuid.uuid4().hex[:8]}"
    now_iso = datetime.utcnow().isoformat()

    logger.info(f"Cloning demo workspace for user_id='{user_id}' -> conv_id='{target_conv_id}'")

    # 1. Ensure demo workspace is seeded
    seed_demo_workspace()

    # 2. Insert new conversation owned by user_id
    supabase.table("conversations").upsert({
        "id": target_conv_id,
        "title": DEMO_TITLE,
        "user_id": user_id,
        "created_at": now_iso,
        "updated_at": now_iso,
    }).execute()

    # 3. Clone files
    file_count = 0
    file_id_map: Dict[str, str] = {}
    filename_map: Dict[str, str] = {}
    try:
        f_res = supabase.table("files").select("*").eq("conversation_id", DEMO_CONV_ID).execute()
        for f_row in f_res.data or []:
            old_file_id = f_row.get("id")
            new_file_id = str(uuid.uuid4())
            if old_file_id:
                file_id_map[old_file_id] = new_file_id
            if f_row.get("filename"):
                filename_map[f_row["filename"]] = new_file_id

            new_f = dict(f_row)
            new_f["id"] = new_file_id
            new_f["conversation_id"] = target_conv_id
            new_f["user_id"] = user_id
            new_f["uploaded_at"] = now_iso

            supabase.table("files").insert(new_f).execute()
            file_count += 1

            # Index chunks for new conversation in BM25 & Qdrant asynchronously
            ext_text = f_row.get("extracted_text")
            if ext_text:
                def _bg_index(fid=new_file_id, cid=target_conv_id, fn=f_row.get("filename", "file"), ft=f_row.get("file_type", "document"), txt=ext_text):
                    try:
                        hybrid_retriever.index_file(
                            file_id=fid,
                            conversation_id=cid,
                            filename=fn,
                            file_type=ft,
                            extracted_text=txt,
                        )
                    except Exception as e:
                        logger.warning(f"Notice indexing cloned file: {e}")

                threading.Thread(target=_bg_index, daemon=True).start()
    except Exception as err:
        logger.error(f"Error cloning demo files: {err}")


    # 4. Clone messages
    message_count = 0
    try:
        m_res = supabase.table("messages").select("*").eq("conversation_id", DEMO_CONV_ID).execute()
        cloned_msgs = []
        for m_row in m_res.data or []:
            new_msg_id = f"msg_{uuid.uuid4().hex[:10]}"
            new_m = dict(m_row)
            new_m["id"] = new_msg_id
            new_m["conversation_id"] = target_conv_id
            new_m["user_id"] = user_id

            supabase.table("messages").insert(new_m).execute()
            cloned_msgs.append(new_m)
            message_count += 1

        # Write local mirror for cloned messages
        loc_path = os.path.join(CONVERSATIONS_DIR, f"{target_conv_id}_messages.json")
        with open(loc_path, "w", encoding="utf-8") as f:
            json.dump(cloned_msgs, f, indent=2)
    except Exception as err:
        logger.error(f"Error cloning demo messages: {err}")

    # 5. Clone Knowledge Graph JSON with mapped file IDs
    try:
        src_graph = os.path.join(GRAPHS_DIR, f"{DEMO_CONV_ID}.json")
        dst_graph = os.path.join(GRAPHS_DIR, f"{target_conv_id}.json")
        if os.path.exists(src_graph):
            with open(src_graph, "r", encoding="utf-8") as f:
                g_data = json.load(f)
            g_data["conversation_id"] = target_conv_id

            # Remap all node file_ids and edge file_ids
            for node in g_data.get("nodes", []):
                old_fids = node.get("file_ids", [])
                node["file_ids"] = [file_id_map.get(fid, fid) for fid in old_fids]
            for edge in g_data.get("edges", []):
                old_fid = edge.get("file_id")
                if old_fid in file_id_map:
                    edge["file_id"] = file_id_map[old_fid]
                elif edge.get("filename") in filename_map:
                    edge["file_id"] = filename_map[edge.get("filename")]

            with open(dst_graph, "w", encoding="utf-8") as f:
                json.dump(g_data, f, indent=2)
        else:
            logger.info(f"Source demo graph not found on disk at {src_graph}")
    except Exception as err:
        logger.error(f"Error cloning demo graph: {err}")



    return {
        "id": target_conv_id,
        "title": DEMO_TITLE,
        "file_count": file_count,
        "message_count": message_count,
        "created_at": now_iso,
        "updated_at": now_iso,
        "is_demo": False,
    }
