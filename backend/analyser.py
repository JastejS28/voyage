# ── Imports & shared client ──────────────────────────────────────────────────
from google import genai
from google.genai import types
import requests
import httpx
import os
import tempfile
from pathlib import Path
from dotenv import load_dotenv
from db import (
    fetch_pending_uploads,
    mark_upload_processing,
    update_upload_result,
)

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

client = genai.Client()
MODEL = "gemini-3-flash-preview"

# ── MIME-type sets ────────────────────────────────────────────────────────────
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


def _download_bytes(url: str, timeout: int = 60) -> bytes:
    """Download bytes from an HTTP(S) URL with status/timeout checks."""
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.content


def _route(file_type: str) -> str:
    """Return a simple routing key based on MIME type."""
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


# ── DB helpers are imported from db.py ───────────────────────────────────────
# fetch_pending_uploads, mark_upload_processing, update_upload_result,
# and get_structured_context are all provided by db.py.


# ── Modular handlers ──────────────────────────────────────────────────────────

def analyze_images(image_urls: list[str], prompt: str, mime_type: str = "image/jpeg") -> str:
    """
    Analyze one or more images.

    Args:
        image_urls : list of HTTP(S) URLs pointing to images.
        prompt     : instruction / question for the model.
        mime_type  : MIME type shared by all images (default "image/jpeg").

    Returns:
        Model response text.
    
    Example:
        result = analyze_images(
            ["https://example.com/a.jpg", "https://example.com/b.jpg"],
            "What is different between these two images? If they are the same, say so."
        )
    """
    parts = [prompt]
    for url in image_urls:
        img_bytes = _download_bytes(url)
        parts.append(types.Part.from_bytes(data=img_bytes, mime_type=mime_type))

    response = client.models.generate_content(
        model=MODEL,
        contents=parts,
        config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(thinking_level="low")
        ),
    )
    return response.text


def analyze_video(video_urls: list[str], prompt: str, mime_type: str = "video/mp4") -> str:
    """
    Analyze one or more videos from direct HTTP(S) URLs.

    Args:
        video_urls : list of HTTP(S) URLs pointing to video files.
        prompt     : instruction / question for the model.
        mime_type  : MIME type shared by all videos (default "video/mp4").

    Returns:
        Model response text.

    Example:
        result = analyze_video(
            ["https://storage.googleapis.com/your-bucket/video.mp4"],
            "Please summarize the video in 3 sentences."
        )
    """
    parts = []
    for url in video_urls:
        video_bytes = _download_bytes(url)
        parts.append(types.Part(inline_data=types.Blob(data=video_bytes, mime_type=mime_type)))
    parts.append(types.Part(text=prompt))

    response = client.models.generate_content(
        model=MODEL,
        contents=types.Content(parts=parts),
        config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(thinking_level="low")
        ),
    )
    return response.text


def analyze_pdf(pdf_urls: list[str], prompt: str) -> str:
    """
    Analyze one or more PDFs from HTTP(S) URLs.

    Args:
        pdf_urls : list of HTTP(S) URLs pointing to PDF documents.
        prompt   : instruction / question for the model.

    Returns:
        Model response text.

    Example:
        result = analyze_pdf(
            ["https://example.com/paper.pdf"],
            "Summarize this document."
        )
    """
    parts = []
    for url in pdf_urls:
        resp = httpx.get(url, timeout=60)
        resp.raise_for_status()
        doc_data = resp.content
        parts.append(types.Part.from_bytes(data=doc_data, mime_type="application/pdf"))
    parts.append(prompt)

    response = client.models.generate_content(
        model=MODEL,
        contents=parts,
        config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(thinking_level="low")
        ),
    )
    return response.text


def analyze_audio(audio_paths: list[str], prompt: str) -> str:
    """
    Analyze one or more audio files from local paths.

    Args:
        audio_paths : list of local file paths to audio files.
        prompt      : instruction / question for the model.

    Returns:
        Model response text.

    Example:
        result = analyze_audio(
            ["path/to/sample.mp3"],
            "Generate a transcript of the speech."
        )
    """
    uploaded = [client.files.upload(file=path) for path in audio_paths]
    response = client.models.generate_content(
        model=MODEL,
        contents=[prompt, *uploaded],
        config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(thinking_level="low")
        ),
    )
    return response.text


def analyze_audio_url(audio_urls: list[str], prompt: str, mime_type: str = "audio/mpeg") -> str:
    """
    Analyze one or more audio files from HTTP(S) URLs.

    Downloads each audio file, writes it to a temporary file, uploads it via
    the Gemini Files API, then runs inference.

    Args:
        audio_urls : list of HTTP(S) URLs pointing to audio files.
        prompt     : instruction / question for the model.
        mime_type  : MIME type shared by all audio files (default "audio/mpeg").

    Returns:
        Model response text.
    """
    uploaded_files = []
    tmp_paths = []
    try:
        for url in audio_urls:
            audio_bytes = _download_bytes(url, timeout=60)
            ext = mime_type.split("/")[-1].replace("mpeg", "mp3")
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}")
            tmp.write(audio_bytes)
            tmp.close()
            tmp_paths.append(tmp.name)
            uploaded_files.append(client.files.upload(file=tmp.name))

        response = client.models.generate_content(
            model=MODEL,
            contents=[prompt, *uploaded_files],
            config=types.GenerateContentConfig(
                thinking_config=types.ThinkingConfig(thinking_level="low")
            ),
        )
        return response.text
    finally:
        for p in tmp_paths:
            try:
                os.remove(p)
            except OSError:
                pass


# ── Public dispatcher ─────────────────────────────────────────────────────────

PROMPTS = {
    "image": (
        "Extract all text, objects, scenes, people, dates, numbers, locations, and visual details from this IMAGE. "
        "Include implied information such as categories, relationships, context, and inferred meanings. "
        "Structure the output with sections: Text Content, Objects/Entities, Locations, Dates/Times, People, Context/Implied Information. "
        "This extraction will be used for travel planning and further processing."
    ),
    "video": (
        "Extract all text, speech, scenes, people, locations, dates, numbers, activities, and temporal information from this VIDEO. "
        "Include implied information such as categories, relationships, emotional context, and inferred meanings. "
        "Structure the output with sections: Text/Captions, Speech Transcription, Scenes/Locations, People, Dates/Times, Activities, Context/Implied Information. "
        "This extraction will be used for travel planning and further processing."
    ),
    "pdf": (
        "Extract all text, numbers, dates, locations, names, categories, tables, and structured information from this PDF DOCUMENT. "
        "Include implied information such as context, relationships, and inferred meanings relevant to travel and itineraries. "
        "Structure the output with sections: Main Content, Key Information, Locations, Dates/Times, Entities/People, Numbers/Prices, Context/Implied Information. "
        "This extraction will be used for travel planning and further processing."
    ),
    "audio": (
        "Transcribe all speech from this AUDIO file completely and accurately. "
        "Extract all mentioned information including: locations, dates, times, names, numbers, prices, activities, preferences, and requirements. "
        "Include implied information such as context, relationships, categories, and inferred meanings. "
        "Structure the output with sections: Full Transcription, Extracted Entities (Locations, Dates, Names, Numbers), Preferences/Requirements, Context/Implied Information. "
        "This extraction will be used for travel planning and further processing. "
    ),
}


def process_chat_uploads(
    chat_id: str,
    prompt: str | None = None,
) -> list[dict]:
    """
    Fetch all pending uploads for *chat_id*, route each one to the correct
    analyser based on file_type, and write results back to chat_uploads.

    Returns a list of result dicts with keys:
        upload_id, file_url, file_type, route, result (str | dict)
    """
    uploads = fetch_pending_uploads(chat_id)
    results = []

    for upload in uploads:
        uid: str = str(upload["upload_id"])
        url: str = upload["file_url"]
        ftype: str = (upload["file_type"] or "").strip()
        route = _route(ftype)

        # Optimistic lock – prevent duplicate processing by concurrent workers
        if not mark_upload_processing(uid):
            continue

        # Use custom prompt for this route, or user-provided prompt, or default
        route_prompt = prompt or PROMPTS.get(route, PROMPTS["pdf"])

        try:
            if route == "image":
                text = analyze_images([url], route_prompt, mime_type=ftype or "image/jpeg")
            elif route == "video":
                text = analyze_video([url], route_prompt, mime_type=ftype or "video/mp4")
            elif route == "pdf":
                text = analyze_pdf([url], route_prompt)
            elif route == "audio":
                text = analyze_audio_url([url], route_prompt, mime_type=ftype or "audio/mpeg")
            else:
                raise ValueError(f"Unsupported file type: '{ftype}'. No analyser available.")

            extracted = {"text": text, "route": route}
            update_upload_result(uid, extracted, "completed")

        except Exception as exc:
            extracted = {"error": str(exc), "route": route}
            update_upload_result(uid, extracted, "failed")

        results.append(
            {
                "upload_id": uid,
                "file_url": url,
                "file_type": ftype,
                "route": route,
                "result": extracted,
            }
        )

    return results
