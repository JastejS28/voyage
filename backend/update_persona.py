import os
import json
from typing import Any
from langchain_openai import ChatOpenAI
from dotenv import load_dotenv
load_dotenv()
from db import get_persona, update_persona, get_completed_uploads
model = ChatOpenAI(
    api_key=os.getenv("OPENROUTER_API_KEY"),
    base_url="https://openrouter.ai/api/v1",
    model="xiaomi/mimo-v2-flash",
    temperature=0.2,
)


def _stringify_extracted_data(raw: Any) -> str:
    if raw is None:
        return ""
    if isinstance(raw, dict):
        text_value = raw.get("text")
        if isinstance(text_value, str) and text_value.strip():
            return text_value.strip()
        return json.dumps(raw, ensure_ascii=False)
    if isinstance(raw, str):
        candidate = raw.strip()
        if not candidate:
            return ""
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                txt = parsed.get("text")
                if isinstance(txt, str) and txt.strip():
                    return txt.strip()
            return json.dumps(parsed, ensure_ascii=False)
        except json.JSONDecodeError:
            return candidate
    return str(raw)


def _collect_recent_upload_inputs(chat_id: str, limit: int | None = None) -> list[dict[str, str]]:
    rows = get_completed_uploads(chat_id)
    if limit and limit > 0:
        rows = rows[-limit:]

    items: list[dict[str, str]] = []
    for row in rows:
        extracted_text = _stringify_extracted_data(row.get("extracted_data"))
        if not extracted_text:
            continue
        items.append(
            {
                "upload_id": str(row.get("upload_id") or ""),
                "file_type": str(row.get("file_type") or "unknown"),
                "file_url": str(row.get("file_url") or ""),
                "extracted_text": extracted_text,
            }
        )
    return items


def _build_persona_prompt(old_persona: str | None, uploads: list[dict[str, str]]) -> str:
    old_persona_clean = (old_persona or "").strip()
    has_old_persona = bool(old_persona_clean)
    old_persona_text = old_persona_clean or "No previous persona available in users.user_persona."

    if uploads:
        upload_lines = []
        for idx, upload in enumerate(uploads, start=1):
            upload_lines.append(
                f"### Upload {idx}\n"
                f"- upload_id: {upload['upload_id']}\n"
                f"- file_type: {upload['file_type']}\n"
                f"- file_url: {upload['file_url']}\n"
                f"- extracted_input:\n{upload['extracted_text']}"
            )
        uploads_block = "\n\n".join(upload_lines)
    else:
        uploads_block = "No completed uploads were found for this chat."

    if has_old_persona:
        prompt_intro = (
            "You are a precise user-persona writer for a travel assistant. "
            "Use the old persona and every recent upload input below to generate one updated persona in markdown.\n\n"
        )
        section_title = "## Updated Persona"
    else:
        prompt_intro = (
            "You are a precise user-persona writer for a travel assistant. "
            "There is no existing persona in the database, so bootstrap a new persona ONLY from the recent upload inputs below.\n\n"
        )
        section_title = "## New Persona"

    return (
        f"{prompt_intro}"
        "Requirements:\n"
        "1) Output MUST be valid markdown only.\n"
        "2) Include these top-level sections in this order:\n"
        "   - # User Persona\n"
        "   - ## Old Persona (verbatim summary)\n"
        "   - ## Recent Upload Inputs (explicitly list all uploads used)\n"
        f"   - {section_title}\n"
        "3) In the final persona section, include concise bullets for preferences, constraints, budget signals, destination/route hints, communication style, and confidence notes.\n"
        "4) Do not invent facts not grounded in old persona or uploads.\n"
        "5) If data is missing, explicitly mark it as unknown instead of guessing.\n\n"
        "=== OLD PERSONA ===\n"
        f"{old_persona_text}\n\n"
        "=== RECENT UPLOADS FROM CONVERSATION ===\n"
        f"{uploads_block}\n"
    )


def generate_persona_markdown(user_id: str, chat_id: str, upload_limit: int | None = None) -> dict[str, Any]:
    old_persona = get_persona(user_id)
    recent_uploads = _collect_recent_upload_inputs(chat_id=chat_id, limit=upload_limit)

    prompt = _build_persona_prompt(old_persona=old_persona, uploads=recent_uploads)
    response = model.invoke(prompt)
    persona_markdown = (getattr(response, "content", "") or "").strip()

    if isinstance(persona_markdown, list):
        persona_markdown = "\n".join(str(part) for part in persona_markdown).strip()
    if not isinstance(persona_markdown, str):
        persona_markdown = str(persona_markdown)

    if not persona_markdown:
        raise RuntimeError("Model returned empty persona markdown.")

    update_persona(user_id=user_id, persona_markdown=persona_markdown)

    return {
        "user_id": user_id,
        "chat_id": chat_id,
        "uploads_used": len(recent_uploads),
        "persona_markdown": persona_markdown,
    }