"""
Premium Itinerary Agent  — Luxury / Upgrade Plan.

Generates the most comfortable, high-end itinerary possible.
Focuses on top-rated airlines, business/first class, 5-star hotels,
premium experiences, luxury dining, and maximum comfort.
"""

from __future__ import annotations

import logging
from typing import Any

from base_agent import BaseItineraryAgent
from llm_config import LLMConfig

logger = logging.getLogger("PremiumAgent")


class PremiumItineraryAgent(BaseItineraryAgent):
    """
    Agent B — Premium Plan.

    * Upgrade hotels (4-5 star only).
    * Add premium experiences.
    * Improve flight class (prefer business / first).
    * Increase comfort metrics.
    * Focuses on ratings, facilities, and luxury.
    """

    AGENT_TYPE = "premium"

    SYSTEM_PROMPT = (
        "You are a PREMIUM Itinerary Planning Agent.\n"
        "Your role is to create the most luxurious, comfortable travel "
        "itinerary that maximises traveller experience and comfort.\n\n"
        "## Rules\n"
        "- Choose the HIGHEST-rated airlines with the best feedback scores.\n"
        "- Prefer NONSTOP or fewest-stop flights.\n"
        "- Prefer BUSINESS or FIRST class when available.\n"
        "- Choose 4-star or 5-star hotels EXCLUSIVELY.\n"
        "- Prioritise hotels with the MOST facilities (pools, spas, "
        "room service, concierge, etc.).\n"
        "- Include premium activities: private tours, fine dining, spa, "
        "VIP experiences.\n"
        "- Budget is SECONDARY — quality and comfort are the priority.\n"
        "- Assign high comfort_score (8-10) in metadata.\n"
        "- Add luxury dining suggestions for every meal.\n"
        "- If the user stated a budget, you may exceed it for premium "
        "quality — note the reason in the summary.\n\n"
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
        Rank flights by quality:
            1. Highest rating
            2. Fewest stops
            3. Highest feedback count
            4. Best score

        No flights are removed — only re-ordered so the LLM picks the best.
        """
        prefs = requirement.get("transport_preferences", {})
        avoid = {a.lower() for a in prefs.get("avoid_airlines", []) if a}

        # remove only explicitly avoided airlines
        pool = [
            f for f in flights
            if f.get("airline", "").lower() not in avoid
        ]

        # premium sort: rating DESC → stops ASC → feedback DESC → score DESC
        pool.sort(
            key=lambda f: (
                f.get("rating", 0),
                -f.get("stops", 99),
                f.get("feedback_count", 0),
                f.get("score", 0),
            ),
            reverse=True,
        )

        logger.info(
            "[premium] flight sort: %d candidates  (top rating=%.2f)",
            len(pool),
            pool[0].get("rating", 0) if pool else 0,
        )
        return pool

    # ── hotel filtering ──────────────────────────────────────────────────

    def filter_hotels(
        self,
        hotels: list[dict[str, Any]],
        requirement: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """
        Keep only 4-5 star hotels.
        Sort by: star_rating DESC → facilities_count DESC → trip_advisor DESC.
        """
        premium_pool = [
            h for h in hotels
            if h.get("star_rating_num", 0) >= 4
        ]

        # fallback: if no 4-5 star hotels, take top-rated available
        if not premium_pool:
            premium_pool = sorted(
                hotels,
                key=lambda h: h.get("star_rating_num", 0),
                reverse=True,
            )
            logger.warning(
                "[premium] No 4-5★ hotels found — falling back to all %d hotels",
                len(premium_pool),
            )

        # luxury sort
        def _sort_key(h: dict) -> tuple:
            ta = h.get("trip_advisor_rating")
            ta_num = float(ta) if ta else 0.0
            return (
                h.get("star_rating_num", 0),
                h.get("facilities_count", 0),
                ta_num,
            )

        premium_pool.sort(key=_sort_key, reverse=True)

        logger.info(
            "[premium] hotel filter: %d → %d  (4-5★ only)",
            len(hotels), len(premium_pool),
        )
        return premium_pool


# ═══════════════════════════════════════════════════════════════════════════════
# Standalone test
# ═══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    agent = PremiumItineraryAgent(LLMConfig())
    print(f"PremiumItineraryAgent ready  |  LLM = {agent._llm_config}")
