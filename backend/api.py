from fastapi import FastAPI, HTTPException, UploadFile, File, BackgroundTasks
from pydantic import BaseModel
import boto3
import os
import uuid
import logging
from dotenv import load_dotenv
from botocore.exceptions import NoCredentialsError, ClientError
from pathlib import Path
from analyser import process_chat_uploads
from app import (
    cancel_trip,
    disrupt_random_booking,
    get_booking_pricing,
    get_cancellation_details,
    initialize_cancellation_schema,
    process_refund,
    seed_booking_pricing,
    sync_booking_status,
)
from db import (
    get_structured_context,
    get_all_uploads,
    get_chat_structured_requirement,
    get_db_health,
    get_public_schema_snapshot,
    get_user_by_id,
    get_user_by_phone,
    get_chat_by_id,
    create_chat,
    insert_chat_upload,
)
from agent import run_persistent_chat
from update_persona import generate_persona_markdown

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load .env from the directory where this script is located
env_path = Path(__file__).parent / ".env"
loaded = load_dotenv(dotenv_path=env_path, verbose=True)
logger.info(f".env path: {env_path}")
logger.info(f".env exists: {env_path.exists()}")
logger.info(f"load_dotenv() result: {loaded}")

app = FastAPI()

# Create S3-compatible client. If access keys are not provided in env vars,
# boto3 will use its normal credential resolution chain (env, shared creds, IAM).
logger.info("Initializing S3 client...")
s3 = boto3.client(
    "s3",
    endpoint_url=os.getenv("S3_API"),
    aws_access_key_id=os.getenv("CLOUDFARE_ACCESS"),
    aws_secret_access_key=os.getenv("CLOUDFARE_SECRET_ACCESS"),
    region_name=os.getenv("S3_REGION", "")
)
logger.info("S3 client initialized successfully")

BUCKET = os.getenv("BUCKET_NAME")
PUBLIC_URL = os.getenv("PUBLIC_URL")
logger.info(f"S3 Bucket: {BUCKET}, Public URL configured: {PUBLIC_URL is not None}")


def _refresh_persona_background(user_id: str, chat_id: str) -> None:
    """Generate and persist user persona markdown without blocking chat response."""
    try:
        result = generate_persona_markdown(user_id=user_id, chat_id=chat_id)
        logger.info(
            "Persona updated in background for user_id=%s chat_id=%s uploads_used=%s",
            user_id,
            chat_id,
            result.get("uploads_used", 0),
        )
    except Exception as exc:
        logger.error(
            "Background persona update failed for user_id=%s chat_id=%s: %s",
            user_id,
            chat_id,
            exc,
            exc_info=True,
        )


# ── Chat creation ────────────────────────────────────────────────────────────

class CreateChatRequest(BaseModel):
    """Supply exactly one of user_id (UUID) or phone_number."""
    user_id: str | None = None
    phone_number: str | None = None


@app.post("/chats", status_code=201)
def create_chat_route(body: CreateChatRequest):
    """
    Create a new chat session.

    Pass **either** `user_id` (UUID) **or** `phone_number` — the user is
    looked up in `public.users`, then a fresh row is inserted into
    `public.chats` with status `chat_started`.

    Returns the new chat's `chat_id`, `user_id`, `status`, and timestamps.
    """
    logger.debug(f"POST /chats - user_id: {body.user_id}, phone_number: {body.phone_number}")
    
    if not body.user_id and not body.phone_number:
        logger.warning("create_chat_route: Neither user_id nor phone_number provided")
        raise HTTPException(
            status_code=422,
            detail="Provide either 'user_id' or 'phone_number'.",
        )

    if body.user_id and body.phone_number:
        logger.warning("create_chat_route: Both user_id and phone_number provided")
        raise HTTPException(
            status_code=422,
            detail="Provide only one of 'user_id' or 'phone_number', not both.",
        )

    try:
        if body.user_id:
            logger.info(f"Looking up user by user_id: {body.user_id}")
            user = get_user_by_id(body.user_id)
            if not user:
                logger.warning(f"No user found with user_id: {body.user_id}")
                raise HTTPException(
                    status_code=404,
                    detail=f"No user found with user_id '{body.user_id}'.",
                )
        else:
            logger.info(f"Looking up user by phone_number: {body.phone_number}")
            user = get_user_by_phone(body.phone_number)  # type: ignore[arg-type]
            if not user:
                logger.warning(f"No user found with phone_number: {body.phone_number}")
                raise HTTPException(
                    status_code=404,
                    detail=f"No user found with phone_number '{body.phone_number}'.",
                )

        logger.info(f"Creating chat for user_id: {user['user_id']}")
        chat = create_chat(user["user_id"])
        logger.info(f"Chat created successfully - chat_id: {chat['chat_id']}")
    except HTTPException:
        raise
    except RuntimeError as exc:
        logger.error(f"RuntimeError creating chat: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        logger.error(f"Database error creating chat: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}")

    return {
        "chat_id":    str(chat["chat_id"]),
        "user_id":    str(chat["user_id"]),
        "status":     chat["status"],
        "created_at": chat["created_at"].isoformat() if chat["created_at"] else None,
        "updated_at": chat["updated_at"].isoformat() if chat["updated_at"] else None,
    }


# ── S3 upload URL ─────────────────────────────────────────────────────────────

class UploadRequest(BaseModel):
    chat_id: str          # which chat this file belongs to
    filename: str
    contentType: str      # MIME type, e.g. "application/pdf", "image/jpeg"


@app.post("/generate-upload-url", status_code=201)
def generate_upload_url(req: UploadRequest):
    """
    Generate a presigned PUT URL for uploading a file to object storage,
    then immediately register the file in `chat_uploads` with
    extraction_status = 'pending' so it can be picked up by /process-uploads.

    Returns:
        uploadUrl  – PUT this URL directly from the client (expires in 60 s)
        fileUrl    – permanent public URL stored in the DB
        upload_id  – UUID of the new chat_uploads row
    """
    logger.debug(f"POST /generate-upload-url - chat_id: {req.chat_id}, filename: {req.filename}, contentType: {req.contentType}")
    
    if not BUCKET or not PUBLIC_URL:
        logger.error("Bucket or PUBLIC_URL not configured")
        raise HTTPException(
            status_code=500,
            detail=(
                "Bucket or PUBLIC_URL not configured. Set BUCKET_NAME and PUBLIC_URL "
                "environment variables before calling this endpoint."
            ),
        )

    chat = get_chat_by_id(req.chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail=f"No chat found with chat_id '{req.chat_id}'.")

    unique_filename = f"{uuid.uuid4()}-{req.filename}"
    logger.info(f"Generated unique filename: {unique_filename}")

    try:
        logger.debug(f"Generating presigned URL for {unique_filename}")
        presigned_url = s3.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": BUCKET,
                "Key": unique_filename,
                "ContentType": req.contentType,
            },
            ExpiresIn=60,
        )
        logger.info(f"Presigned URL generated successfully")
    except NoCredentialsError:
        logger.error("Unable to locate S3 credentials")
        raise HTTPException(
            status_code=500,
            detail=(
                "Unable to locate credentials for S3/Cloudflare R2. "
                "Provide CLOUDFARE_ACCESS / CLOUDFARE_SECRET_ACCESS in your .env."
            ),
        )
    except ClientError as e:
        logger.error(f"S3 client error: {e}")
        raise HTTPException(status_code=500, detail=f"S3 client error: {e}")

    file_url = f"{PUBLIC_URL}/{unique_filename}"

    # Register in chat_uploads so /process-uploads can find it
    try:
        logger.info(f"Registering upload in database - chat_id: {req.chat_id}, file_url: {file_url}")
        upload_row = insert_chat_upload(
            chat_id=req.chat_id,
            file_url=file_url,
            file_type=req.contentType,
        )
        logger.info(f"Upload registered - upload_id: {upload_row['upload_id']}")
    except RuntimeError as exc:
        logger.error(f"RuntimeError registering upload: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        logger.error(f"DB error registering upload: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"DB error registering upload: {exc}")

    return {
        "uploadUrl":         presigned_url,
        "fileUrl":           file_url,
        "upload_id":         str(upload_row["upload_id"]),
        "chat_id":           str(upload_row["chat_id"]),
        "extraction_status": upload_row["extraction_status"],
    }


# ─── Direct file upload (debug route, for testing only) ─────────────────────

@app.post("/upload-file/{chat_id}", status_code=201)
async def upload_file_direct(chat_id: str, file: UploadFile = File(...)):
    """
    Upload a file directly to object storage and register it in chat_uploads.

    This endpoint is useful for debugging — it skips the presigned URL step
    and uploads the file directly from the request payload.

    Args:
        chat_id: UUID of the chat this file belongs to
        file:    multipart file upload

    Returns:
        upload_id, fileUrl, extraction_status, and extracted_at
    """
    logger.debug(f"POST /upload-file/{chat_id} - filename: {file.filename}, content_type: {file.content_type}")
    
    if not BUCKET or not PUBLIC_URL:
        logger.error("Bucket or PUBLIC_URL not configured for direct upload")
        raise HTTPException(
            status_code=500,
            detail="Bucket or PUBLIC_URL not configured.",
        )

    chat = get_chat_by_id(chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail=f"No chat found with chat_id '{chat_id}'.")

    if not file.filename:
        logger.warning("Direct upload: File has no name")
        raise HTTPException(status_code=422, detail="File has no name.")

    if not file.content_type:
        logger.warning("Direct upload: File has no content type")
        raise HTTPException(status_code=422, detail="File has no content type.")

    unique_filename = f"{uuid.uuid4()}-{file.filename}"
    logger.info(f"Starting direct file upload - chat_id: {chat_id}, unique_filename: {unique_filename}")

    try:
        # Read file bytes
        logger.debug(f"Reading file bytes for {file.filename}")
        file_bytes = await file.read()
        logger.info(f"File read successfully - size: {len(file_bytes)} bytes")

        # Upload to S3
        logger.debug(f"Uploading to S3 - Bucket: {BUCKET}, Key: {unique_filename}")
        s3.put_object(
            Bucket=BUCKET,
            Key=unique_filename,
            Body=file_bytes,
            ContentType=file.content_type,
        )
        logger.info(f"File uploaded to S3 successfully")

        file_url = f"{PUBLIC_URL}/{unique_filename}"

        # Register in chat_uploads
        logger.info(f"Registering uploaded file in database - chat_id: {chat_id}")
        upload_row = insert_chat_upload(
            chat_id=chat_id,
            file_url=file_url,
            file_type=file.content_type,
        )
        logger.info(f"Upload registered - upload_id: {upload_row['upload_id']}, status: {upload_row['extraction_status']}")

    except ClientError as e:
        logger.error(f"S3 error during direct upload: {e}")
        raise HTTPException(status_code=500, detail=f"S3 error: {e}")
    except RuntimeError as exc:
        logger.error(f"RuntimeError during direct upload: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        logger.error(f"Upload error: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Upload error: {exc}")

    return {
        "upload_id":         str(upload_row["upload_id"]),
        "chat_id":           str(upload_row["chat_id"]),
        "fileUrl":           file_url,
        "file_type":         file.content_type,
        "extraction_status": upload_row["extraction_status"],
        "uploaded_at":       upload_row["uploaded_at"].isoformat() if upload_row["uploaded_at"] else None,
    }


@app.get("/debug-credentials")
def debug_credentials():
    """Return env and boto3 credential presence for debugging only.

    Do NOT deploy this endpoint to production.
    """
    logger.debug("GET /debug-credentials - checking credentials")
    
    def mask(val: str | None) -> str | None:
        if not val:
            return None
        if len(val) <= 8:
            return val[:2] + "..."
        return val[:4] + "..." + val[-4:]

    session = boto3.Session()
    creds = session.get_credentials()
    resolved = bool(creds and creds.access_key and creds.secret_key)
    
    logger.info(f"Credentials resolved: {resolved}, Bucket configured: {BUCKET is not None}")

    return {
        "env_file_path": str(Path(__file__).parent / ".env"),
        "env_file_exists": (Path(__file__).parent / ".env").exists(),
        "BUCKET": BUCKET is not None,
        "PUBLIC_URL": PUBLIC_URL is not None,
        "PUBLIC_URL_value": PUBLIC_URL,
        "S3_API": bool(os.getenv("S3_API")),
        "CLOUDFARE_ACCESS_masked": mask(os.getenv("CLOUDFARE_ACCESS")),
        "CLOUDFARE_SECRET_ACCESS_masked": mask(os.getenv("CLOUDFARE_SECRET_ACCESS")),
        "boto3_credentials_resolved": resolved,
        "all_env_keys": list(os.environ.keys()),
    }


# ── File extraction endpoint ──────────────────────────────────────────────────

class ProcessUploadsRequest(BaseModel):
    pass


@app.post("/process-uploads/{chat_id}")
def process_uploads(chat_id: str, body: ProcessUploadsRequest = ProcessUploadsRequest()):
    """
    Fetch every pending row in chat_uploads for *chat_id*, route each file
    to the correct Gemini analyser (image / video / pdf / audio), and write
    the extracted data back to the database.

    Returns a list of per-file results with keys:
        upload_id, file_url, file_type, route, result
    """
    logger.info(f"POST /process-uploads/{chat_id}")
    
    try:
        logger.debug(f"Processing chat uploads for chat_id: {chat_id}")
        results = process_chat_uploads(chat_id)
        logger.info(f"Processing complete - {len(results)} files processed")
    except RuntimeError as exc:
        # DATABASE_URL not configured, etc.
        logger.error(f"RuntimeError during upload processing: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        logger.error(f"Extraction error: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Extraction error: {exc}")

    if not results:
        logger.info(f"No pending uploads found for chat_id: {chat_id}")
        return {"message": "No pending uploads found for this chat.", "results": []}

    return {"processed": len(results), "results": results}


# ── Context endpoint ──────────────────────────────────────────────────────────

class ContextRequest(BaseModel):
    user_text: str   # the user's typed message; merged directly into the context JSON


@app.post("/context/{chat_id}")
def build_context(chat_id: str, body: ContextRequest):
    """
    Fetch all *completed* extractions from chat_uploads for *chat_id*,
    group them by media type, and merge the user's typed text.

    Returns a structured JSON ready for the agent:
        {
          "text":  "<user message>",
          "image": ["extracted content …"],   # present only if rows exist
          "audio": ["transcript …"],
          "pdf":   ["document summary …"],
          "video": ["video description …"],
        }
    """
    logger.debug(f"POST /context/{chat_id} - user_text length: {len(body.user_text)}")
    
    try:
        logger.info(f"Building context for chat_id: {chat_id}")
        ctx = get_structured_context(chat_id, body.user_text)
        logger.debug(f"Context built successfully with keys: {list(ctx.keys())}")
    except RuntimeError as exc:
        logger.error(f"RuntimeError building context: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        logger.error(f"Context build error: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Context build error: {exc}")

    return ctx


# ── Persistent Chat endpoint ──────────────────────────────────────────────────

class ChatMessageRequest(BaseModel):
    """User message for persistent agent chat."""
    message: str


class ChatFlowRequest(BaseModel):
    """Single-call flow: optional upload processing + chat turn."""
    message: str
    process_pending_uploads: bool = True
    update_persona: bool = False


class PersonaUpdateRequest(BaseModel):
    """Optional controls for manual persona regeneration."""
    upload_limit: int | None = None


class CancelRequest(BaseModel):
    provider_booking_id: str
    cancellation_type: str
    selected_item_ids: list[str] | None = None
    selected_days: list[int] | None = None


class CancelByProviderPathRequest(BaseModel):
    cancellation_type: str
    selected_days: list[int] | None = None


class RefundRequest(BaseModel):
    cancellation_id: str


class SeedPricingRequest(BaseModel):
    overwrite: bool = False


@app.post("/chat/{chat_id}", status_code=200)
def chat_message(chat_id: str, body: ChatMessageRequest):
    """
    Send a message to the travel agent with in-memory conversation context.
    
    The agent uses:
    1. Conversation history from previous turns (stored in application memory)
    2. Latest context from /context/{chat_id} for multimodal data
    3. Your travel extraction schema to respond
    
    On each turn, the full conversation is maintained, so the agent can reference
    previous messages and build on them.
    
    Args:
        chat_id: UUID of the chat thread (conversation)
        body.message: User's message text
        user_id: Resolved from public.chats using chat_id
    
    Returns:
        Agent response with structured extraction and full message history
    """
    user_message = body.message.strip()
    if not user_message:
        raise HTTPException(status_code=422, detail="Provide non-empty 'message'.")

    logger.info(f"POST /chat/{chat_id} - message length: {len(user_message)}")
    logger.debug(f"Message content: {user_message[:100]}..." if len(user_message) > 100 else f"Message content: {user_message}")
    
    try:
        chat = get_chat_by_id(chat_id)
        if not chat:
            raise HTTPException(status_code=404, detail=f"No chat found with chat_id '{chat_id}'.")

        user_id = str(chat["user_id"])
        logger.info(f"Resolved user_id from chats table for chat_id {chat_id}")

        logger.debug(f"Running persistent chat for chat_id: {chat_id}")
        result = run_persistent_chat(
            chat_id=chat_id,
            user_message=user_message,
            user_id=user_id,
        )
        logger.info(f"Chat completed successfully for chat_id: {chat_id}")
        return result
    except HTTPException:
        raise
    except ValueError as exc:
        logger.warning(f"ValueError in chat: {exc}")
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        logger.error(f"Agent error in chat: {exc}")
        raise HTTPException(status_code=500, detail=f"Agent error: {exc}")
    except Exception as exc:
        logger.error(f"Chat error: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Chat error: {exc}")


@app.post("/chat-flow/{chat_id}", status_code=200)
def chat_flow(chat_id: str, body: ChatFlowRequest, background_tasks: BackgroundTasks):
    """
    One-call orchestration route.

    Flow:
    1) Optionally process pending uploads for this chat.
    2) Run a chat turn using the latest context and in-memory conversation state.

    Existing routes are preserved; this is an additive convenience route.
    """
    user_message = body.message.strip()
    if not user_message:
        raise HTTPException(status_code=422, detail="Provide non-empty 'message'.")

    logger.info(
        f"POST /chat-flow/{chat_id} - process_pending_uploads={body.process_pending_uploads}, "
        f"update_persona={body.update_persona}, "
        f"message length={len(user_message)}"
    )

    chat = get_chat_by_id(chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail=f"No chat found with chat_id '{chat_id}'.")

    user_id = str(chat["user_id"])
    processing_results: list[dict] = []
    failed_processing: list[dict] = []
    context_preview: dict = {}

    try:
        if body.process_pending_uploads:
            processing_results = process_chat_uploads(chat_id)

            failed_processing = [
                item for item in processing_results
                if isinstance(item.get("result"), dict) and item["result"].get("error")
            ]
            if failed_processing:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "message": "One or more uploads failed extraction; chat step was skipped.",
                        "failed_count": len(failed_processing),
                        "failed_uploads": failed_processing,
                    },
                )

        # Ensure there are no unresolved uploads before chat turn
        all_uploads = get_all_uploads(chat_id)
        unresolved = [
            u for u in all_uploads
            if (u.get("extraction_status") in {"pending", "processing"})
        ]
        if unresolved:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Uploads are still pending/processing; chat step was skipped.",
                    "unresolved_count": len(unresolved),
                },
            )

        # Pre-check context for this turn before invoking the agent
        context_preview = get_structured_context(chat_id, user_message)
        if not context_preview:
            raise HTTPException(
                status_code=422,
                detail="Context is empty; cannot proceed to chat.",
            )

        chat_result = run_persistent_chat(
            chat_id=chat_id,
            user_message=user_message,
            user_id=user_id,
        )

        # Post-check that structured requirement exists after agent turn
        persisted_requirement = get_chat_structured_requirement(chat_id)
        if not persisted_requirement:
            raise HTTPException(
                status_code=502,
                detail="Agent completed but structured_requirement was not persisted.",
            )

        if body.update_persona:
            background_tasks.add_task(_refresh_persona_background, user_id, chat_id)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        logger.error(f"chat_flow error: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Chat flow error: {exc}")

    return {
        "chat_id": chat_id,
        "processed_uploads": len(processing_results),
        "processing_results": processing_results,
        "context_keys": list(context_preview.keys()),
        "persona_update_scheduled": body.update_persona,
        "chat": chat_result,
    }


@app.post("/persona/update/{chat_id}", status_code=200)
def update_persona_route(chat_id: str, body: PersonaUpdateRequest = PersonaUpdateRequest()):
    """
    Regenerate and persist user persona markdown for a chat.

    Resolves user_id from public.chats and uses recent completed uploads + old persona.
    """
    logger.info(
        "POST /persona/update/%s - upload_limit=%s",
        chat_id,
        body.upload_limit,
    )

    chat = get_chat_by_id(chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail=f"No chat found with chat_id '{chat_id}'.")

    user_id = str(chat["user_id"])

    try:
        result = generate_persona_markdown(
            user_id=user_id,
            chat_id=chat_id,
            upload_limit=body.upload_limit,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        logger.error("Persona update route failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Persona update error: {exc}")

    return {
        "chat_id": chat_id,
        "user_id": user_id,
        "uploads_used": result.get("uploads_used", 0),
        "persona_markdown": result.get("persona_markdown", ""),
    }


@app.get("/db/health")
def db_health():
    """Database connectivity + basic server metadata."""
    try:
        health = get_db_health()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DB health error: {exc}")
    return {"ok": True, "db": health}


@app.get("/db/schema")
def db_schema():
    """Return current public schema snapshot (tables + columns)."""
    try:
        schema = get_public_schema_snapshot()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DB schema error: {exc}")
    return schema


@app.get("/uploads/{chat_id}")
def list_uploads(chat_id: str):
    """List all uploads (any status) for a chat — useful for status checking."""
    logger.debug(f"GET /uploads/{chat_id}")
    
    try:
        logger.info(f"Fetching all uploads for chat_id: {chat_id}")
        rows = get_all_uploads(chat_id)
        logger.info(f"Retrieved {len(rows)} uploads for chat_id: {chat_id}")
    except RuntimeError as exc:
        logger.error(f"RuntimeError listing uploads: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
    
    return {"chat_id": chat_id, "uploads": rows}


@app.post("/disrupt-random")
def disrupt_random_booking_endpoint():
    return disrupt_random_booking()


@app.get("/cancellation/{provider_booking_id}")
def get_cancellation_details_endpoint(provider_booking_id: str):
    return get_cancellation_details(provider_booking_id)


@app.get("/booking-pricing/{provider_booking_id}")
def get_booking_pricing_endpoint(provider_booking_id: str):
    return get_booking_pricing(provider_booking_id)


@app.post("/cancellation/cancel/{provider_booking_id}")
def cancel_trip_endpoint(provider_booking_id: str, req: CancelByProviderPathRequest):
    return cancel_trip(
        provider_booking_id,
        req.cancellation_type,
        None,
        req.selected_days,
    )


@app.post("/refund/process")
def process_refund_endpoint(req: RefundRequest):
    return process_refund(req.cancellation_id)


@app.post("/cancel")
def cancel_trip_endpoint_legacy(req: CancelRequest):
    return cancel_trip(
        req.provider_booking_id,
        req.cancellation_type,
        req.selected_item_ids,
        req.selected_days,
    )


@app.post("/process-refund/{cancellation_id}")
def process_refund_endpoint_legacy(cancellation_id: str):
    return process_refund(cancellation_id)


@app.post("/sync-booking-status")
def sync_booking_status_endpoint():
    return sync_booking_status()


@app.post("/cancellation/setup-schema")
def setup_cancellation_schema_endpoint():
    return initialize_cancellation_schema()


@app.post("/booking-pricing/seed/{provider_booking_id}")
def seed_booking_pricing_endpoint(provider_booking_id: str, body: SeedPricingRequest = SeedPricingRequest()):
    return seed_booking_pricing(provider_booking_id, overwrite=body.overwrite)