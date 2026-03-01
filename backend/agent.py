import os
import json
import re
import logging
from typing import Dict, Any
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from langchain.agents import create_agent
from langchain.tools import tool, ToolRuntime

from langchain.agents.middleware import (
    SummarizationMiddleware,
    ToolRetryMiddleware,
    ToolCallLimitMiddleware,
    ModelRetryMiddleware,
)

from langchain.messages import HumanMessage

from langchain_openai import ChatOpenAI
from os import getenv
from dotenv import load_dotenv
from db import update_chat_structured_requirement, get_structured_context

from langgraph.checkpoint.memory import InMemorySaver

load_dotenv()

# ─────────────────────────────────────────────────────────────────────────────
# LOGGING SETUP
# ─────────────────────────────────────────────────────────────────────────────

LOG_DIR = Path(__file__).parent / "logs"
LOG_DIR.mkdir(exist_ok=True)

TIMESTAMP = datetime.now().strftime("%Y%m%d_%H%M%S")
LOG_FILE = LOG_DIR / f"agent_{TIMESTAMP}.log"

logger = logging.getLogger("TravelAgent")
logger.setLevel(logging.DEBUG)

file_handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
file_handler.setLevel(logging.DEBUG)

console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)

formatter = logging.Formatter(
    "%(asctime)s | %(name)s | %(levelname)-8s | %(funcName)s:%(lineno)d | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

file_handler.setFormatter(formatter)
console_handler.setFormatter(formatter)

logger.addHandler(file_handler)
logger.addHandler(console_handler)

logger.info("=" * 80)
logger.info(f"Travel Agent Session Started | Log: {LOG_FILE}")
logger.info("=" * 80)

model = ChatOpenAI(
    api_key=getenv("OPENROUTER_API_KEY"),
    base_url="https://openrouter.ai/api/v1",
    model="xiaomi/mimo-v2-flash",
    temperature=0.2,
)
logger.info(f"Model: xiaomi/mimo-v2-flash (via OpenRouter)")

_SESSION_STORE: dict[str, "SessionMemory"] = {}
_IN_MEMORY_CHECKPOINTER = InMemorySaver()


@dataclass
class AgentContext:
    user_id: str
    chat_id: str


@dataclass
class SessionMemory:
    chat_id: str
    user_id: str = "unknown"
    user_text_history: list[str] = field(default_factory=list)
    latest_context: dict[str, Any] = field(default_factory=dict)
    structured_requirement_history: list[dict[str, Any]] = field(default_factory=list)


TRAVEL_REQUIREMENT_SCHEMA: Dict[str, Any] = {
    "trip_overview": {
        "summary": "string",
        "trip_type": "leisure|business|family|honeymoon|adventure|pilgrimage|other",
        "confidence": "high|medium|low",
    },
    "travelers": {
        "count": "integer|null",
        "adults": "integer|null",
        "children": "integer|null",
        "infants": "integer|null",
        "special_needs": ["string"],
    },
    "route_plan": {
        "origin": "string|null",
        "destinations": ["string"],
        "multi_city": "boolean",
        "flexible_destinations": ["string"],
    },
    "dates": {
        "start_date": "YYYY-MM-DD|null",
        "end_date": "YYYY-MM-DD|null",
        "duration_nights": "integer|null",
        "date_flexibility": "none|low|medium|high",
        "blackout_dates": ["YYYY-MM-DD"],
    },
    "budget": {
        "currency": "string|null",
        "max_total": "number|null",
        "budget_per_person": "number|null",
        "budget_notes": "string|null",
    },
    "transport_preferences": {
        "flight_class": "economy|premium_economy|business|first|unknown",
        "preferred_airlines": ["string"],
        "avoid_airlines": ["string"],
        "stops_preference": "nonstop|1-stop|any|unknown",
        "departure_time_pref": "morning|afternoon|evening|night|any",
    },
    "stay_preferences": {
        "property_types": ["hotel|hostel|resort|apartment|villa|homestay|other"],
        "star_rating_min": "integer|null",
        "room_count": "integer|null",
        "bed_type_pref": "string|null",
        "amenities_required": ["string"],
        "amenities_optional": ["string"],
        "location_preference": "string|null",
    },
    "activities": {
        "must_do": ["string"],
        "nice_to_have": ["string"],
        "avoid": ["string"],
        "pace": "relaxed|balanced|packed|unknown",
    },
    "food_preferences": {
        "dietary_restrictions": ["string"],
        "cuisine_preferences": ["string"],
    },
    "documents_and_constraints": {
        "visa_needed": "boolean|null",
        "passport_validity_notes": "string|null",
        "hard_constraints": ["string"],
        "soft_constraints": ["string"],
    },
    "extracted_facts": [
        {
            "fact": "string",
            "source_type": "text|image|audio|pdf|video",
            "confidence": "high|medium|low",
        }
    ],
    "implied_inferences": [
        {
            "inference": "string",
            "reason": "string",
            "confidence": "high|medium|low",
        }
    ],
}


def _schema_json() -> str:
    return json.dumps(TRAVEL_REQUIREMENT_SCHEMA, ensure_ascii=False, indent=2)


SYSTEM_PROMPT = (
    "You are a Travel Requirement Extraction Agent. "
    "You will receive a merged context JSON from /context/{chat_id} with keys like text, image, audio, pdf, video. "
    "Treat this JSON as conversation memory and planning context. "
    "Extract all explicit facts and implied signals useful for trip planning. "
    "Never add greeting text or explanations outside JSON. "
    "Always produce valid JSON exactly in the schema and key structure below. "
    "If a field is unknown, use null, empty list, or 'unknown' as appropriate. "
    "Schema:\n" + _schema_json()
)


def _serialize_context_for_prompt(context_json: dict) -> str:
    """Serialize context JSON to a compact but readable string for direct prompting."""
    return json.dumps(context_json, ensure_ascii=False, indent=2)


def _extract_agent_text(result: Any) -> str:
    """Best-effort extraction of final assistant text from create_agent() output."""
    if isinstance(result, dict):
        messages = result.get("messages")
        if isinstance(messages, list) and messages:
            last_message = messages[-1]
            content = getattr(last_message, "content", None)
            if isinstance(content, list):
                text_parts: list[str] = []
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "text":
                        text_parts.append(str(part.get("text", "")))
                    else:
                        text_parts.append(str(part))
                return "\n".join(p for p in text_parts if p).strip()
            if content is not None:
                return str(content).strip()
    return str(result).strip()


def _parse_structured_requirement(result: Any) -> dict | None:
    """Parse final agent response into a structured requirement JSON object."""
    text = _extract_agent_text(result)
    if not text:
        return None

    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{[\s\S]*\}", cleaned)
    if not match:
        return None

    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def hydrate_session_memory(session: SessionMemory, new_user_text: str) -> dict:
    logger.info(f"Hydrating session memory for chat_id={session.chat_id}, user_id={session.user_id}")
    logger.debug(f"New user text: {new_user_text}")
    
    session.user_text_history.append(new_user_text)
    merged_user_text = "\n".join(session.user_text_history).strip()
    
    logger.info(f"User text history now has {len(session.user_text_history)} turns")
    logger.debug(f"Merged history: {merged_user_text[:200]}...")
    
    try:
        session.latest_context = get_structured_context(
            chat_id=session.chat_id,
            user_text=merged_user_text,
        )
    except Exception as e:
        logger.error(f"Failed to build context directly from DB: {e}", exc_info=True)
        raise

    if not session.latest_context:
        logger.warning("Context API returned empty JSON")
        raise ValueError(
            "Context API returned empty JSON. Ensure completed extractions exist for this chat_id "
            "or provide richer user_text before invoking the agent."
        )

    if set(session.latest_context.keys()) == {"text"} and not session.latest_context.get("text", "").strip():
        logger.warning("Context JSON has only empty text field")
        raise ValueError("Context JSON has only empty text. Agent extraction would be low quality.")

    logger.info(f"Session memory hydrated successfully. Context keys: {list(session.latest_context.keys())}")
    return session.latest_context


@tool
def list_context_buckets(runtime: ToolRuntime[AgentContext]) -> str:
    """Return a comma-separated list of available keys in context_json state."""
    context_json = runtime.state.get("context_json", {}) or {}
    logger.info(f"Tool call: list_context_buckets | Available: {list(context_json.keys())}")
    
    if not context_json:
        logger.warning("list_context_buckets: No context available")
        return "No context available."
    
    result = ", ".join(sorted(context_json.keys()))
    logger.debug(f"list_context_buckets result: {result}")
    return result


@tool
def get_context_bucket(bucket: str, runtime: ToolRuntime[AgentContext]) -> str:
    """Return one context_json bucket value as a string by key name."""
    logger.info(f"Tool call: get_context_bucket | bucket={bucket}")
    
    context_json = runtime.state.get("context_json", {}) or {}
    value = context_json.get(bucket)
    
    if value is None:
        result = f"Bucket '{bucket}' not present."
        logger.warning(f"get_context_bucket: {result}")
        return result
    
    if isinstance(value, (dict, list)):
        result = json.dumps(value, ensure_ascii=False)
    else:
        result = str(value)
    
    logger.debug(f"get_context_bucket({bucket}): {result[:200]}...")
    return result


@tool
def save_structured_requirement(requirement_json: dict, runtime: ToolRuntime[AgentContext]) -> str:
    """Validate and persist structured requirement JSON to public.chats.structured_requirement."""
    logger.info(f"Tool call: save_structured_requirement")
    logger.debug(f"Requirement JSON: {json.dumps(requirement_json, ensure_ascii=False)[:500]}...")
    
    if not isinstance(requirement_json, dict):
        logger.error(f"save_structured_requirement: Invalid type {type(requirement_json)}")
        return "Rejected: requirement_json must be a JSON object."

    chat_id = None
    try:
        context_obj = getattr(runtime, "context", None)
        if context_obj is not None:
            chat_id = getattr(context_obj, "chat_id", None)
    except Exception:
        chat_id = None

    if not chat_id:
        logger.error("save_structured_requirement: Missing chat_id in runtime context")
        return "Rejected: chat_id missing in runtime context; cannot persist structured requirement."

    try:
        update_chat_structured_requirement(chat_id, requirement_json)
        logger.info(f"Requirement persisted to chats.structured_requirement for chat_id={chat_id}")
    except Exception as exc:
        logger.error(f"save_structured_requirement: DB persist failed: {exc}", exc_info=True)
        return f"Rejected: failed to persist structured requirement: {exc}"

    logger.info(f"Requirement accepted. Keys: {list(requirement_json.keys())}")
    return "Structured requirement saved to database."


def build_agent(checkpointer=None):
    tools = [
        list_context_buckets,
        get_context_bucket,
        save_structured_requirement,
    ]

    agent_kwargs = {
        "model": model,
        "tools": tools,
        "system_prompt": SYSTEM_PROMPT,
        "middleware": [
            SummarizationMiddleware(
                model=model,
                 trigger=("tokens", 100000),
            ),
            ToolRetryMiddleware(
                max_retries=2,
                backoff_factor=2.0,
                tools=["save_structured_requirement"],
            ),
            ToolCallLimitMiddleware(
                thread_limit=20,
                run_limit=10,
            ),
            ModelRetryMiddleware(
                max_retries=2,
                backoff_factor=2.0,
            ),
        ],
    }
    
    if checkpointer:
        agent_kwargs["checkpointer"] = checkpointer
        logger.info("Agent built with persistent checkpointer")
    else:
        logger.info("Agent built without persistence (stateless)")
    
    return create_agent(**agent_kwargs)


def run_context_to_agent_test(
    chat_id: str,
    user_text: str,
    user_id: str = "debug_user",
) -> dict:
    logger.info(f"Starting context-to-agent test | chat_id={chat_id}, user_id={user_id}")
    logger.info(f"User input: {user_text}")
    
    try:
        session = SessionMemory(chat_id=chat_id, user_id=user_id)
        logger.debug(f"Session created: {session}")
        
        context_json = hydrate_session_memory(session, user_text)
        
        agent = build_agent()
        ctx = AgentContext(user_id=user_id, chat_id=chat_id)
        logger.info(f"Agent built and context initialized")

        context_payload = _serialize_context_for_prompt(context_json)
        instruction = (
            "Use the CONTEXT_JSON below as source of truth and return ONLY the final schema JSON. "
            "Do not call any tool unless absolutely necessary.\n\n"
            f"CONTEXT_JSON:\n{context_payload}"
        )

        logger.info("Invoking agent with instruction...")
        logger.debug(f"Instruction: {instruction[:300]}...")
        
        result = agent.invoke(
            {
                "messages": [HumanMessage(instruction)],
                "context_json": context_json,
            },
            context=ctx,
        )
        
        logger.info("Agent invocation completed successfully")
        logger.debug(f"Result keys: {list(result.keys()) if isinstance(result, dict) else type(result)}")
        return result
        
    except Exception as e:
        logger.error(f"Test execution failed: {e}", exc_info=True)
        raise


def run_multi_turn_context_test(
    chat_id: str,
    user_turns: list[str],
    user_id: str = "debug_user",
) -> list[dict]:
    """
    Multi-turn test runner.

    Keeps user text history in-memory so original user intent is never lost.
    On each turn:
      1) append current user message to memory
      2) call POST /context/{chat_id} with merged user text
      3) invoke agent using latest context_json
    """
    logger.info(f"Starting multi-turn context test | chat_id={chat_id}, user_id={user_id}, turns={len(user_turns)}")
    
    session = SessionMemory(chat_id=chat_id, user_id=user_id)
    agent = build_agent()
    ctx = AgentContext(user_id=user_id, chat_id=chat_id)

    outputs: list[dict] = []
    for turn_idx, turn_text in enumerate(user_turns, start=1):
        logger.info(f"Turn {turn_idx}/{len(user_turns)} | Input: {turn_text[:100]}...")
        
        try:
            context_json = hydrate_session_memory(
                session=session,
                new_user_text=turn_text,
            )

            context_payload = _serialize_context_for_prompt(context_json)
            instruction = (
                "Use the CONTEXT_JSON below as source of truth and return ONLY the final schema JSON. "
                "Do not call any tool unless absolutely necessary.\n\n"
                f"CONTEXT_JSON:\n{context_payload}"
            )

            logger.debug(f"Turn {turn_idx}: Invoking agent...")
            result = agent.invoke(
                {
                    "messages": [HumanMessage(instruction)],
                    "context_json": context_json,
                    "user_turn": turn_text,
                },
                context=ctx,
            )
            
            logger.info(f"Turn {turn_idx}: Agent response received")
            outputs.append(result)
            
        except Exception as e:
            logger.error(f"Turn {turn_idx} failed: {e}", exc_info=True)
            raise

    logger.info(f"Multi-turn test completed successfully. Processed {len(outputs)} turns")
    return outputs


def get_in_memory_checkpointer():
    """
    Return the shared in-memory checkpointer.
    Conversation state is intentionally process-local.
    """
    logger.info("Using in-memory checkpointer")
    return _IN_MEMORY_CHECKPOINTER


def run_persistent_chat(
    chat_id: str,
    user_message: str,
    user_id: str = "user",
) -> dict:
    """
    Run a single chat turn with in-memory conversation memory.
    Conversation turns are kept in process memory only.
    The latest extracted requirement is persisted to chats.structured_requirement.
    
    Returns:
        dict with agent output and messages
    """
    logger.info(f"Starting persistent chat | chat_id={chat_id}, user_id={user_id}")
    logger.info(f"User message: {user_message}")
    
    try:
        # In-memory per-chat turn history (not stored in database)
        session = _SESSION_STORE.get(chat_id)
        if session is None:
            session = SessionMemory(chat_id=chat_id, user_id=user_id)
            _SESSION_STORE[chat_id] = session
            logger.info(f"Created new in-memory session for chat_id={chat_id}")
        else:
            session.user_id = user_id
            logger.info(f"Reusing in-memory session for chat_id={chat_id}; turns={len(session.user_text_history)}")

        # Shared in-memory checkpointer for within-process memory
        checkpointer = get_in_memory_checkpointer()
        agent = build_agent(checkpointer=checkpointer)

        logger.info("Building context directly from DB for enrichment")
        context_json = hydrate_session_memory(
            session=session,
            new_user_text=user_message,
        )
        
        # Build instruction with context
        context_payload = _serialize_context_for_prompt(context_json)
        instruction = (
            "Use the CONTEXT_JSON below as source of truth. "
            "Create the final extraction in strict schema JSON, call save_structured_requirement exactly once with that JSON, "
            "and then return the same JSON as your final answer.\n\n"
            f"CONTEXT_JSON:\n{context_payload}"
        )
        
        # Invoke agent with in-process thread memory keyed by chat_id
        config = {"configurable": {"thread_id": chat_id}}
        
        logger.info(f"Invoking persistent agent with thread_id={chat_id}")
        agent_context = AgentContext(user_id=user_id, chat_id=chat_id)
        result = agent.invoke(
            {
                "messages": [HumanMessage(instruction)],
                "context_json": context_json,
            },
            context=agent_context,
            config=config,
        )

        structured_requirement = _parse_structured_requirement(result)
        if structured_requirement:
            update_chat_structured_requirement(chat_id, structured_requirement)
            session.structured_requirement_history.append(structured_requirement)
            logger.info("Updated chats.structured_requirement for this turn")
        else:
            logger.warning("Could not parse structured requirement JSON from agent response; DB column not updated")
        
        logger.info("Persistent chat completed successfully")
        logger.debug(f"Result type: {type(result)}")
        return {
            "chat_id": chat_id,
            "user_id": user_id,
            "user_message": user_message,
            "agent_response": result,
            "structured_requirement": structured_requirement,
        }
        
    except Exception as e:
        logger.error(f"Persistent chat failed: {e}", exc_info=True)
        raise


if __name__ == "__main__":
    test_chat_id = os.getenv("TEST_CHAT_ID", "11bbe8d7-ef69-469b-bc9f-52cb7f5ecf9a")
    test_user_text = os.getenv("TEST_USER_TEXT", "Try to fill in the details and budget is 5 lakh inr")

    logger.info(f"Main execution started")
    logger.info(f"TEST_CHAT_ID: {test_chat_id}")
    logger.info(f"TEST_USER_TEXT: {test_user_text}")

    if not test_chat_id:
        logger.error("TEST_CHAT_ID not set in environment")
        raise RuntimeError("Set TEST_CHAT_ID in environment before running agent.py")

    try:
        output = run_context_to_agent_test(
            chat_id=test_chat_id,
            user_text=test_user_text,
        )
        
        logger.info("Successfully generated agent output")
        logger.debug(f"Output type: {type(output)}")
        
        output_json = json.dumps(output, ensure_ascii=False, indent=2, default=str)
        print(output_json)
        
        logger.info(f"Output written to console and log file: {LOG_FILE}")
        
    except Exception as e:
        logger.critical(f"Main execution failed: {e}", exc_info=True)
        raise
    finally:
        logger.info("=" * 80)
        logger.info("Travel Agent Session Ended")
        logger.info("=" * 80)