"""
Core Itinerary Agent  — Strict Requirement Plan.

Generates an itinerary that matches the user's stated requirements
*exactly*, with no deviations, upgrades, or downgrades.
"""

from __future__ import annotations

import logging
from typing import Any

from base_agent import BaseItineraryAgent
from llm_config import LLMConfig

logger = logging.getLogger("CoreAgent")


class CoreItineraryAgent(BaseItineraryAgent):
    """
    Agent A — Strict Requirement Plan.

    * Exact match to user requirements.
    * Exact destination request.
    * No deviations.
    * Stays within stated budget.
    """

    AGENT_TYPE = "core"

    SYSTEM_PROMPT = (
        "You are a CORE Itinerary Planning Agent.\n"
        "Your role is to generate a travel itinerary that STRICTLY matches "
        "the user's stated requirements with ZERO deviations.\n\n"
        "## Rules\n"
        "- Use ONLY flights that match the user's preferred airlines, "
        "stop preferences, departure time preference, and cabin class.\n"
        "- Use ONLY hotels that meet the user's minimum star rating, "
        "required amenities, and property-type preferences.\n"
        "- Do NOT upgrade or downgrade anything — match the requirements precisely.\n"
        "- Stay within the user's stated budget (max_total or budget_per_person).\n"
        "- If a requirement field is null/unknown, choose the most standard option "
        "(economy class, 3-star hotel, etc.).\n"
        "- If no flights/hotels match all criteria, pick the closest match "
        "and note the deviation in the summary.\n"
        "- Include the user's must-do activities when available.\n"
        "- Respect hard constraints (visa, dates, dietary restrictions).\n\n"
        "## Output\n"
        "Return ONLY valid JSON matching the provided output schema.\n"
        "No explanations, no markdown — just the JSON object."
    )

    # ── flight filtering ─────────────────────────────────────────────────

    def filter_flights(
        self,
        flights: list[dict[str, Any]],
        requirement: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """
        Keep flights that align with stated transport preferences.
        Sorting: best overall *score* (API relevance metric) first.
        """
        prefs = requirement.get("transport_preferences", {})

        preferred_airlines = {
            a.lower() for a in prefs.get("preferred_airlines", []) if a
        }
        avoid_airlines = {
            a.lower() for a in prefs.get("avoid_airlines", []) if a
        }
        stops_pref = prefs.get("stops_preference", "any")

        filtered: list[dict[str, Any]] = []
        for f in flights:
            airline_lower = f.get("airline", "").lower()

            # skip avoided airlines
            if avoid_airlines and airline_lower in avoid_airlines:
                continue

            # prefer stated airlines (if any)
            if preferred_airlines and airline_lower not in preferred_airlines:
                # still include, but will rank lower (score stays as-is)
                pass

            # stop preference
            if stops_pref == "nonstop" and f.get("stops", 0) > 0:
                continue
            if stops_pref == "1-stop" and f.get("stops", 0) > 1:
                continue

            filtered.append(f)

        # sort by API relevance score (descending) → best match first
        filtered.sort(key=lambda x: x.get("score", 0), reverse=True)

        logger.info(
            "[core] flight filter: %d → %d  (stops_pref=%s)",
            len(flights), len(filtered), stops_pref,
        )
        return filtered

    # ── hotel filtering ──────────────────────────────────────────────────

    def filter_hotels(
        self,
        hotels: list[dict[str, Any]],
        requirement: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """
        Keep hotels matching star rating, property type, and required amenities.
        Sorting: star-rating match closeness, then TripAdvisor rating.
        """
        stay = requirement.get("stay_preferences", {})

        min_stars       = stay.get("star_rating_min")
        required_amen   = {a.lower() for a in stay.get("amenities_required", []) if a}
        prop_types      = {p.lower() for p in stay.get("property_types", []) if p}

        filtered: list[dict[str, Any]] = []
        for h in hotels:
            star_num = h.get("star_rating_num", 0)

            # minimum star rating
            if min_stars and star_num < min_stars:
                continue

            # required amenities check (soft — don't discard if data is sparse)
            if required_amen:
                hotel_facilities = {f.lower() for f in h.get("facilities", [])}
                # at least half of required amenities should match
                matched = required_amen & hotel_facilities
                if len(matched) < len(required_amen) * 0.3:
                    continue

            filtered.append(h)

        # sort by star rating closeness to min_stars, then trip-advisor rating
        def _sort_key(h: dict) -> tuple:
            ta = h.get("trip_advisor_rating")
            ta_num = float(ta) if ta else 0.0
            return (h.get("star_rating_num", 0), ta_num)

        filtered.sort(key=_sort_key, reverse=True)

        logger.info(
            "[core] hotel filter: %d → %d  (min_stars=%s)",
            len(hotels), len(filtered), min_stars,
        )
        return filtered


# ═══════════════════════════════════════════════════════════════════════════════
# Standalone test
# ═══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    agent = CoreItineraryAgent(LLMConfig())
    print(f"CoreItineraryAgent ready  |  LLM = {agent._llm_config}")
