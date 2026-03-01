# ── db.py — shared DB helpers & context assembly ─────────────────────────────
"""
Centralises all Supabase/Postgres queries for the chat_uploads table.

Key public function
───────────────────
get_structured_context(chat_id, user_text)
    Reads every *completed* extraction for a chat from chat_uploads,
    groups them by media type, merges the user's raw text message, and
    returns a single dict ready to be passed into the agent. If
    public.chats.structured_requirement already exists for this chat,
    it is added to context under key "structured_requirement":

        {
            "text":  "<user's raw message>",          # always present
            "image": ["extracted text …", …],         # only if rows exist
            "video": ["extracted text …", …],
            "audio": ["transcript …", …],
            "pdf":   ["document summary …", …],
            "structured_requirement": {...},           # optional from chats table
        }

The user's typed text is injected directly — it never touches the DB.
All multimodal content comes from chat_uploads.extracted_data (JSONB).
"""

import os
import json
from pathlib import Path
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

# ── MIME → route mapping ──────────────────────────────────────────────────────
_IMAGE_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "image/bmp", "image/tiff", "image/svg+xml",
}
_VIDEO_TYPES = {
    "video/mp4", "video/mpeg", "video/webm",
    "video/quicktime", "video/x-msvideo", "video/x-matroska",
}
_AUDIO_TYPES = {
    "audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg",
    "audio/flac", "audio/aac", "audio/x-wav",
}
_PDF_TYPES = {"application/pdf"}


def _route(file_type: str) -> str:
    ft = (file_type or "").lower().split(";")[0].strip()
    if ft in _IMAGE_TYPES or ft.startswith("image/"):
        return "image"
    if ft in _VIDEO_TYPES or ft.startswith("video/"):
        return "video"
    if ft in _AUDIO_TYPES or ft.startswith("audio/"):
        return "audio"
    if ft in _PDF_TYPES:
        return "pdf"
    return "unknown"


# ── Connection ────────────────────────────────────────────────────────────────

def get_db_conn():
    """Open and return a psycopg2 connection using DATABASE_URL from .env."""
    db_url = (os.getenv("DATABASE_URL") or "").strip().strip('"').strip("'")
    if db_url.startswith("DATABASE_URL="):
        db_url = db_url.split("=", 1)[1].strip()

    # Recover from malformed env strings like: "'postgresql://..." or extra wrappers
    db_url = db_url.replace("\ufeff", "").strip()
    if "postgresql://" in db_url and not db_url.startswith("postgresql://"):
        db_url = db_url[db_url.index("postgresql://") :]
    elif "postgres://" in db_url and not db_url.startswith("postgres://"):
        db_url = db_url[db_url.index("postgres://") :]

    db_url = db_url.strip().strip('"').strip("'").rstrip(";")

    if db_url.startswith("postgres://"):
        db_url = "postgresql://" + db_url[len("postgres://"):]

    if not db_url:
        raise RuntimeError(
            "DATABASE_URL is not set. Add it to your .env file.\n"
            "Format: postgresql://postgres:<password>@<host>:5432/postgres"
        )
    return psycopg2.connect(db_url)


def get_db_health() -> dict:
    """Return basic connectivity and server metadata for diagnostics."""
    with get_db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    current_database() AS database_name,
                    current_user       AS current_user,
                    version()          AS server_version,
                    now()              AS server_time
                """
            )
            row = cur.fetchone()
            return dict(row) if row else {}


def get_public_schema_snapshot() -> dict:
    """Return tables and columns from the public schema."""
    with get_db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_type = 'BASE TABLE'
                ORDER BY table_name
                """
            )
            tables = [r["table_name"] for r in cur.fetchall()]

            cur.execute(
                """
                SELECT
                    table_name,
                    column_name,
                    data_type,
                    is_nullable,
                    column_default
                FROM information_schema.columns
                WHERE table_schema = 'public'
                ORDER BY table_name, ordinal_position
                """
            )
            columns = [dict(r) for r in cur.fetchall()]

    grouped: dict[str, list[dict]] = {t: [] for t in tables}
    for col in columns:
        grouped.setdefault(col["table_name"], []).append(
            {
                "column_name": col["column_name"],
                "data_type": col["data_type"],
                "is_nullable": col["is_nullable"],
                "column_default": col["column_default"],
            }
        )

    return {"schema": "public", "tables": grouped}


# ── Read helpers ──────────────────────────────────────────────────────────────

def get_completed_uploads(chat_id: str) -> list[dict]:
    """
    Return every row in chat_uploads where extraction_status = 'completed'
    for the given chat_id, oldest-first.

    Each dict has: upload_id, file_url, file_type, extracted_data, extracted_at
    """
    with get_db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    upload_id,
                    file_url,
                    file_type,
                    extracted_data,
                    extracted_at
                FROM public.chat_uploads
                WHERE chat_id           = %s
                  AND extraction_status  = 'completed'
                ORDER BY extracted_at ASC NULLS LAST
                """,
                (chat_id,),
            )
            return [dict(r) for r in cur.fetchall()]


def get_all_uploads(chat_id: str) -> list[dict]:
    """
    Return every row in chat_uploads for chat_id (any status).
    Useful for status checks / dashboards.
    """
    with get_db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    upload_id,
                    file_url,
                    file_type,
                    extraction_status,
                    extracted_data,
                    uploaded_at,
                    extracted_at
                FROM public.chat_uploads
                WHERE chat_id = %s
                ORDER BY uploaded_at ASC
                """,
                (chat_id,),
            )
            return [dict(r) for r in cur.fetchall()]


def get_chat_structured_requirement(chat_id: str) -> dict | None:
    """Return chats.structured_requirement for chat_id, or None."""
    with get_db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT structured_requirement
                FROM public.chats
                WHERE chat_id = %s
                """,
                (chat_id,),
            )
            row = cur.fetchone()

    if not row:
        return None

    value = row.get("structured_requirement")
    if value is None:
        return None

    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return None

    return value if isinstance(value, dict) else None


def update_chat_structured_requirement(chat_id: str, structured_requirement: dict) -> None:
    """Persist the latest extracted structured requirement into public.chats."""
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public.chats
                SET structured_requirement = %s,
                    updated_at = %s
                WHERE chat_id = %s
                """,
                (
                    json.dumps(structured_requirement),
                    datetime.now(timezone.utc),
                    chat_id,
                ),
            )
            if cur.rowcount == 0:
                raise RuntimeError(f"No chat found for chat_id '{chat_id}' while updating structured_requirement.")
        conn.commit()


# ── Core: build agent context ─────────────────────────────────────────────────

def get_structured_context(chat_id: str, user_text: str) -> dict:
    """
    Assemble the full multimodal context for the agent.

    Flow:
      1. Fetch every completed extraction from chat_uploads for this chat_id.
      2. Group the extracted text by media route (image / video / audio / pdf).
      3. Inject the user's raw typed message under the "text" key — this
         never comes from the DB; it is added directly from the request.

    Returns:
        {
            "text":  "I want to go to Bali …",            # always present
            "image": ["flight ticket shows …", "…"],      # ≥1 completed image
            "pdf":   ["itinerary says …"],                 # ≥1 completed pdf
            "audio": ["transcript: prefer beach …"],       # ≥1 completed audio
            "video": ["video overview of resort …"],       # ≥1 completed video
            "structured_requirement": {...},                # optional (from chats table)
        }

    Only media keys with at least one result are included.

    Example:
        ctx = get_structured_context(
            chat_id  = "abc-123",
            user_text= "Plan a 5-day Bali trip for 2 people, budget ₹1.5L.",
        )
        # → pass ctx to agent as extracted_sources or context payload
    """
    rows = get_completed_uploads(chat_id)

    buckets: dict[str, list[str]] = {}
    for row in rows:
        route = _route(row.get("file_type") or "")
        if route == "unknown":
            continue

        raw = row.get("extracted_data") or {}
        # psycopg2 returns JSONB as a dict already, but guard for str just in case
        if isinstance(raw, str):
            raw = json.loads(raw)

        extracted_text: str = raw.get("text", "").strip()
        if not extracted_text:
            continue

        buckets.setdefault(route, []).append(extracted_text)

    # user's typed text is merged directly — never stored in DB
    context: dict = {"text": user_text}

    existing_requirement = get_chat_structured_requirement(chat_id)
    if existing_requirement:
        context["structured_requirement"] = existing_requirement

    context.update(buckets)
    return context


# ── User helpers ─────────────────────────────────────────────────────────────

def get_user_by_id(user_id: str) -> dict | None:
    """Return a user row by UUID, or None if not found."""
    with get_db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT user_id, phone_number, name, email, user_persona, created_at
                FROM   public.users
                WHERE  user_id = %s
                """,
                (user_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None


def get_user_by_phone(phone_number: str) -> dict | None:
    """Return a user row by phone number, or None if not found."""
    with get_db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT user_id, phone_number, name, email, user_persona, created_at
                FROM   public.users
                WHERE  phone_number = %s
                """,
                (phone_number,),
            )
            row = cur.fetchone()
            return dict(row) if row else None


def get_persona(user_id: str) -> str | None:
    """Return users.user_persona for user_id, or None if not found/empty."""
    with get_db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT user_persona
                FROM public.users
                WHERE user_id = %s
                """,
                (user_id,),
            )
            row = cur.fetchone()

    if not row:
        return None

    value = row.get("user_persona")
    if value is None:
        return None
    return str(value).strip() or None


def update_persona(user_id: str, persona_markdown: str) -> None:
    """Persist a generated markdown persona into users.user_persona."""
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public.users
                SET user_persona = %s
                WHERE user_id = %s
                """,
                (persona_markdown, user_id),
            )
            if cur.rowcount == 0:
                raise RuntimeError(f"No user found for user_id '{user_id}' while updating persona.")
        conn.commit()


def get_chat_by_id(chat_id: str) -> dict | None:
    """Return a chat row by chat_id, or None if not found."""
    with get_db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT chat_id, user_id, status, created_at, updated_at
                FROM public.chats
                WHERE chat_id = %s
                """,
                (chat_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None


def create_chat(user_id: str) -> dict:
    """
    Insert a new row into public.chats for *user_id*.

    The database assigns chat_id (gen_random_uuid()) and sets:
      - chat_data        = '{}'
      - status           = 'chat_started'   (enum default)
      - created_at / updated_at = CURRENT_TIMESTAMP

    Returns the newly created row as a dict.
    """
    with get_db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO public.chats (user_id, chat_data)
                VALUES (%s, '{}'::jsonb)
                RETURNING
                    chat_id,
                    user_id,
                    status,
                    created_at,
                    updated_at
                """,
                (user_id,),
            )
            row = cur.fetchone()
        conn.commit()
    return dict(row)


# ── Write helpers (also imported by analyser.py) ──────────────────────────────

def insert_chat_upload(chat_id: str, file_url: str, file_type: str) -> dict:
    """
    Create a new row in public.chat_uploads after a file has been uploaded
    to object storage. Sets extraction_status to 'pending' (schema default).

    Returns the newly created row as a dict with:
        upload_id, chat_id, file_url, file_type, extraction_status, uploaded_at
    """
    with get_db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO public.chat_uploads (chat_id, file_url, file_type)
                VALUES (%s, %s, %s)
                RETURNING
                    upload_id,
                    chat_id,
                    file_url,
                    file_type,
                    extraction_status,
                    uploaded_at
                """,
                (chat_id, file_url, file_type),
            )
            row = cur.fetchone()
        conn.commit()
    return dict(row)


def fetch_pending_uploads(chat_id: str) -> list[dict]:
    """Return pending rows so the extractor knows what to process."""
    with get_db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT upload_id, file_url, file_type
                FROM public.chat_uploads
                WHERE chat_id = %s AND extraction_status = 'pending'
                ORDER BY uploaded_at
                """,
                (chat_id,),
            )
            return [dict(r) for r in cur.fetchall()]


def mark_upload_processing(upload_id: str) -> bool:
    """Optimistic lock: flip status to 'processing' before extraction starts.

    Returns True only if a row was transitioned from pending -> processing.
    """
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public.chat_uploads
                SET extraction_status = 'processing'
                WHERE upload_id = %s AND extraction_status = 'pending'
                """,
                (upload_id,),
            )
            locked = cur.rowcount > 0
        conn.commit()
    return locked


def update_upload_result(
    upload_id: str,
    extracted_data: dict,
    status: str = "completed",
) -> None:
    """Write extracted_data (JSONB) and final status back to chat_uploads."""
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public.chat_uploads
                SET extracted_data    = %s,
                    extraction_status = %s,
                    extracted_at      = %s
                WHERE upload_id = %s
                """,
                (
                    json.dumps(extracted_data),
                    status,
                    datetime.now(timezone.utc),
                    upload_id,
                ),
            )
            if cur.rowcount == 0:
                raise RuntimeError(f"No upload found for upload_id '{upload_id}' while writing extraction result.")
        conn.commit()


