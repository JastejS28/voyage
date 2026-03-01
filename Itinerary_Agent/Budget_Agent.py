"""
Budget Itinerary Agent  — Cost-Optimised Plan.

Generates the most affordable itinerary while maintaining
acceptable quality.  Flights sorted by price, hotels by assigned
price tiers, and activities skew toward free / low-cost options.
"""

from __future__ import annotations

import logging
from typing import Any

from base_agent import BaseItineraryAgent
from llm_config import LLMConfig
from tools import assign_hotel_price, HOTEL_PRICE_TIERS

logger = logging.getLogger("BudgetAgent")


class BudgetItineraryAgent(BaseItineraryAgent):
    """
    Agent C — Budget Plan.

    * Sort flights by lowest price first (then good ratings).
    * Choose budget-friendly hotels (1-3 star, best value).
    * Prefer free and low-cost activities.
    * Stay within (or under) the user's stated budget.
    * Assign random prices from ``HOTEL_PRICE_TIERS`` for hotels.
    """

    AGENT_TYPE = "budget"

    SYSTEM_PROMPT = (
        "You are a BUDGET Itinerary Planning Agent.\n"
        "Your role is to create the most cost-effective travel itinerary "
        "while maintaining acceptable quality and safety.\n\n"
        "## Rules\n"
        "- Choose the CHEAPEST flights first, then consider ratings.\n"
        "- Prefer ECONOMY class.\n"
        "- Choose budget-friendly hotels (1-3 star or best value-for-money).\n"
        "- Prioritise FREE and LOW-COST activities: walking tours, "
        "free museums, public parks, markets, self-guided tours.\n"
        "- Maximise value: good ratings at low prices.\n"
        "- STAY WITHIN the user's stated budget — this is critical.\n"
        "- Suggest budget-saving tips where possible.\n"
        "- Include affordable meal suggestions (street food, local eateries).\n"
        "- Assign a low risk_score when choosing well-reviewed budget options.\n"
        "- Assign a moderate comfort_score (4-6) in metadata.\n\n"
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
        Sort flights by price ASC → rating DESC → feedback DESC.
        Remove extremely low-rated options (< 2.0) to keep quality.
        """
        prefs = requirement.get("transport_preferences", {})
        avoid = {a.lower() for a in prefs.get("avoid_airlines", []) if a}

        pool = [
            f for f in flights
            if f.get("airline", "").lower() not in avoid
        ]

        # remove very-low-rated
        pool = [f for f in pool if f.get("rating", 0) >= 2.0 or f.get("rating", 0) == 0]

        # budget sort: price ASC → rating DESC → feedback DESC
        pool.sort(
            key=lambda f: (
                f.get("price_amount", float("inf")),
                -f.get("rating", 0),
                -f.get("feedback_count", 0),
            ),
        )

        logger.info(
            "[budget] flight sort: %d candidates  (cheapest=$%.0f)",
            len(pool),
            pool[0].get("price_amount", 0) if pool else 0,
        )
        return pool

    # ── hotel filtering ──────────────────────────────────────────────────

    def filter_hotels(
        self,
        hotels: list[dict[str, Any]],
        requirement: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """
        Prefer 1-3 star hotels.  Re-assign prices from HOTEL_PRICE_TIERS
        for each hotel so the budget agent always has price data.
        Sort by price ASC → trip_advisor_rating DESC.
        """
        # re-assign prices so budget agent has deterministic pricing
        for h in hotels:
            h["price_per_night"] = assign_hotel_price(
                h.get("star_rating", "All"),
                h.get("price_per_night", {}).get("currency", "USD"),
            )

        # prefer budget tiers (1-3★), but keep everything as fallback
        budget_pool = [
            h for h in hotels
            if h.get("star_rating_num", 0) <= 3
        ]
        if not budget_pool:
            budget_pool = list(hotels)
            logger.warning(
                "[budget] No 1-3★ hotels — using all %d hotels", len(budget_pool),
            )

        # budget sort: price ASC → trip-advisor DESC
        def _sort_key(h: dict) -> tuple:
            price = h.get("price_per_night", {}).get("amount", 999)
            ta = h.get("trip_advisor_rating")
            ta_num = float(ta) if ta else 0.0
            return (price, -ta_num)

        budget_pool.sort(key=_sort_key)

        logger.info(
            "[budget] hotel filter: %d → %d  (1-3★ preferred)",
            len(hotels), len(budget_pool),
        )
        return budget_pool


# ═══════════════════════════════════════════════════════════════════════════════
# Standalone test
# ═══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    agent = BudgetItineraryAgent(LLMConfig())
    print(f"BudgetItineraryAgent ready  |  LLM = {agent._llm_config}")
    print(f"Hotel price tiers: {HOTEL_PRICE_TIERS}")
