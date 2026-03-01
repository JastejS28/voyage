"""
Base class for all Itinerary Agents (Core, Premium, Budget).

Uses the **google-genai** SDK for LLM calls.

Subclasses override:
    AGENT_TYPE      – "core" | "premium" | "budget"
    SYSTEM_PROMPT   – role-specific instructions
    filter_flights  – agent-specific flight ranking / filtering
    filter_hotels   – agent-specific hotel ranking / filtering
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any

from google import genai
from google.genai import types

from llm_config import LLMConfig
from schemas import get_output_schema_str

logger = logging.getLogger("BaseItineraryAgent")


class BaseItineraryAgent:
    """
    Template for an itinerary-generation agent.

    Workflow executed by ``generate()``:
        1. filter_flights   → apply agent-specific ranking / filtering
        2. filter_hotels    → apply agent-specific ranking / filtering
        3. build_prompt     → assemble the LLM prompt with data + schema
        4. call LLM  (Google GenAI)
        5. parse_output     → extract strict JSON from LLM response
    """

    AGENT_TYPE: str    = "base"
    SYSTEM_PROMPT: str = "You are a travel itinerary generation agent."

    # How many items to feed the LLM (avoids token overflow)
    MAX_FLIGHTS_IN_PROMPT: int = 15
    MAX_HOTELS_IN_PROMPT:  int = 15

    # ──────────────────────────────────────────────────────────────────────
    def __init__(self, llm_config: LLMConfig | None = None):
        self._llm_config = llm_config or LLMConfig()
        self._client: genai.Client | None = None   # lazy

    @property
    def client(self) -> genai.Client:
        """Lazy GenAI client — only instantiated when actually needed."""
        if self._client is None:
            self._client = self._llm_config.get_client()
        return self._client

    # ── override points ──────────────────────────────────────────────────

    def filter_flights(
        self,
        flights: list[dict[str, Any]],
        requirement: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Return flights filtered / sorted by agent strategy.  Override me."""
        return flights

    def filter_hotels(
        self,
        hotels: list[dict[str, Any]],
        requirement: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Return hotels filtered / sorted by agent strategy.  Override me."""
        return hotels

    # ── prompt builder ───────────────────────────────────────────────────

    def build_prompt(
        self,
        requirement: dict[str, Any],
        flights: list[dict[str, Any]],
        hotels: list[dict[str, Any]],
        web_data: dict[str, Any],
    ) -> str:
        """Assemble the user-message prompt sent alongside SYSTEM_PROMPT."""

        # Compact JSON helper (avoids flooding tokens)
        def _compact(obj: Any, limit: int | None = None) -> str:
            data = obj[:limit] if limit and isinstance(obj, list) else obj
            return json.dumps(data, indent=2, ensure_ascii=False, default=str)

        # ── date context ─────────────────────────────────────────────
        dates = requirement.get("dates", {})
        start = dates.get("start_date", "TBD")
        end   = dates.get("end_date", "TBD")
        nights = dates.get("duration_nights", "TBD")

        route = requirement.get("route_plan", {})
        origin = route.get("origin", "TBD")
        destinations = route.get("destinations", [])

        budget = requirement.get("budget", {})
        currency = budget.get("currency", "USD") or "USD"

        prompt = f"""## TASK
Create a **{self.AGENT_TYPE.upper()}** day-by-day travel itinerary.

## TRIP SUMMARY
- Origin: {origin}
- Destinations: {', '.join(destinations) if destinations else 'TBD'}
- Dates: {start} → {end}  ({nights} nights)
- Currency: {currency}

## STRUCTURED REQUIREMENTS
{_compact(requirement)}

## AVAILABLE FLIGHTS  ({len(flights)} options, showing top {self.MAX_FLIGHTS_IN_PROMPT})
{_compact(flights, self.MAX_FLIGHTS_IN_PROMPT)}

## AVAILABLE HOTELS  ({len(hotels)} options, showing top {self.MAX_HOTELS_IN_PROMPT})
{_compact(hotels, self.MAX_HOTELS_IN_PROMPT)}

## ACTIVITIES & ATTRACTIONS (from web search)
{_compact(web_data)}

## REQUIRED OUTPUT SCHEMA
{get_output_schema_str()}

## RULES
1. Set ``plan_type`` to ``"{self.AGENT_TYPE}"``.
2. Select specific flights from the AVAILABLE FLIGHTS list for travel days.
3. Select a specific hotel from the AVAILABLE HOTELS list for each destination city.
4. Plan activities for each day using the web-search data and your knowledge.
5. Suggest meals for each day.
6. Calculate ``total_estimated_cost`` by summing flight prices + hotel nights + activity costs + meal costs.
7. Fill every ``metadata`` field (1-10 scoring).
8. Use ``{currency}`` for ALL cost fields.
9. Return ONLY valid JSON matching the output schema — no markdown, no explanation.
"""
        return prompt

    # ── JSON parser ──────────────────────────────────────────────────────

    def parse_output(self, response: Any) -> dict[str, Any]:
        """
        Best-effort extraction of JSON from LLM response.
        Accepts a google.genai response object or raw string.
        Returns a structured dict or a fallback error payload.
        """
        # handle google genai response object
        if hasattr(response, "text"):
            text = response.text or ""
        elif hasattr(response, "content"):
            text = response.content or ""
        else:
            text = str(response)

        cleaned = text.strip()

        # strip markdown code fences
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```\s*$", "", cleaned)
        cleaned = cleaned.strip()

        # attempt 1: direct parse
        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

        # attempt 2: find balanced JSON object using brace counting
        start_idx = cleaned.find("{")
        if start_idx != -1:
            depth = 0
            in_string = False
            escape_next = False
            for i in range(start_idx, len(cleaned)):
                ch = cleaned[i]
                if escape_next:
                    escape_next = False
                    continue
                if ch == "\\":
                    escape_next = True
                    continue
                if ch == '"' and not escape_next:
                    in_string = not in_string
                    continue
                if in_string:
                    continue
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        candidate = cleaned[start_idx : i + 1]
                        try:
                            parsed = json.loads(candidate)
                            if isinstance(parsed, dict):
                                return parsed
                        except json.JSONDecodeError:
                            pass
                        break

        # fallback
        logger.error("Failed to parse LLM output for %s agent (%d chars)", self.AGENT_TYPE, len(text))
        logger.debug("Raw LLM output (first 500 chars): %s", text[:500])
        return {
            "plan_type": self.AGENT_TYPE,
            "error": "Failed to parse LLM output into valid JSON",
            "raw_output": text[:2000],
        }

    # ── main entry point ─────────────────────────────────────────────────

    def generate(
        self,
        requirement: dict[str, Any],
        flights: list[dict[str, Any]],
        hotels: list[dict[str, Any]],
        web_data: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Full pipeline:  filter → prompt → LLM → parse → return JSON.
        """
        logger.info("[%s] Starting itinerary generation", self.AGENT_TYPE)

        filtered_flights = self.filter_flights(flights, requirement)
        filtered_hotels  = self.filter_hotels(hotels, requirement)

        logger.info(
            "[%s] Filtered  flights=%d → %d   hotels=%d → %d",
            self.AGENT_TYPE,
            len(flights), len(filtered_flights),
            len(hotels),  len(filtered_hotels),
        )

        prompt = self.build_prompt(
            requirement, filtered_flights, filtered_hotels, web_data,
        )

        config = self._llm_config.get_generation_config(
            system_instruction=self.SYSTEM_PROMPT,
        )

        logger.info("[%s] Calling GenAI (%s) …", self.AGENT_TYPE, self._llm_config.model_name)
        response = self.client.models.generate_content(
            model=self._llm_config.model_name,
            contents=prompt,
            config=config,
        )
        resp_text = response.text or ""
        logger.info("[%s] GenAI responded (%d chars)", self.AGENT_TYPE, len(resp_text))

        # ── persist raw output for offline debugging ──────────────
        out_dir = Path(__file__).parent / "agent_outputs"
        out_dir.mkdir(exist_ok=True)
        out_path = out_dir / f"{self.AGENT_TYPE}_raw.txt"
        out_path.write_text(resp_text, encoding="utf-8")
        logger.info("[%s] Raw output saved → %s", self.AGENT_TYPE, out_path)

        result = self.parse_output(response)
        logger.info(
            "[%s] Generation %s",
            self.AGENT_TYPE,
            "succeeded" if "error" not in result else "FAILED (parse error)",
        )
        return result
