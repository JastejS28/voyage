"""
Shared schemas, TypedDicts and output contracts for the Itinerary Agents.
"""

from __future__ import annotations

import json
import operator
from typing import Any, Annotated, TypedDict


# ═══════════════════════════════════════════════════════════════════════════════
# LangGraph State  (flows through the orchestrator)
# ═══════════════════════════════════════════════════════════════════════════════

class ItineraryState(TypedDict, total=False):
    """
    Shared state that every node in the orchestrator graph can read / update.
    Keys written by each node:

        parse_and_fetch  → flight_data, hotel_data, web_search_data
        generate_core    → core_itinerary
        generate_premium → premium_itinerary
        generate_budget  → budget_itinerary

    ``errors`` uses an *add* reducer so parallel branches append safely.
    """
    # ─── Input ───────────────────────────────────────────────────────────
    structured_requirement: dict[str, Any]

    # ─── Fetched Data (shared across all agents) ─────────────────────────
    flight_data:      list[dict[str, Any]]
    hotel_data:       list[dict[str, Any]]
    web_search_data:  dict[str, Any]

    # ─── Agent Outputs ───────────────────────────────────────────────────
    core_itinerary:    dict[str, Any]
    premium_itinerary: dict[str, Any]
    budget_itinerary:  dict[str, Any]

    # ─── Errors (reducer = list concatenation) ───────────────────────────
    errors: Annotated[list[str], operator.add]


# ═══════════════════════════════════════════════════════════════════════════════
# Itinerary Output Schema  (what each agent MUST produce)
# ═══════════════════════════════════════════════════════════════════════════════

ITINERARY_OUTPUT_SCHEMA: dict[str, Any] = {
    "plan_type": "core | premium | budget",
    "summary": "Brief human-readable description of this plan",
    "total_estimated_cost": {
        "amount": "number",
        "currency": "string (e.g. USD, INR)",
    },
    "days": [
        {
            "day": "integer (1-indexed)",
            "date": "YYYY-MM-DD",
            "city": "string",
            "flights": [
                {
                    "departure_city": "string",
                    "arrival_city": "string",
                    "departure_time": "ISO 8601 datetime",
                    "arrival_time": "ISO 8601 datetime",
                    "airline": "string",
                    "flight_number": "string",
                    "class": "economy | premium_economy | business | first",
                    "price": {
                        "amount": "number",
                        "currency": "string",
                        "formatted": "string",
                    },
                    "duration_minutes": "integer",
                    "stops": "integer",
                    "rating": "number (0-5)",
                    "feedback_count": "integer",
                    "booking_link": "string | null",
                },
            ],
            "hotel": {
                "name": "string",
                "star_rating": "string (e.g. FiveStar)",
                "trip_advisor_rating": "string | null",
                "address": "string",
                "facilities": ["string"],
                "attractions_nearby": ["string"],
                "price_per_night": {
                    "amount": "number",
                    "currency": "string",
                },
                "check_in": "HH:MM",
                "check_out": "HH:MM",
                "image_url": "string | null",
            },
            "activities": [
                {
                    "name": "string",
                    "type": "sightseeing | adventure | cultural | dining | relaxation | shopping | other",
                    "description": "string",
                    "estimated_cost": {
                        "amount": "number",
                        "currency": "string",
                    },
                    "duration_hours": "number",
                },
            ],
            "meals": [
                {
                    "type": "breakfast | lunch | dinner",
                    "suggestion": "string",
                    "cuisine": "string | null",
                    "estimated_cost": {
                        "amount": "number",
                        "currency": "string",
                    },
                },
            ],
        },
    ],
    "metadata": {
        "comfort_score": "number (1-10)",
        "risk_score": "number (1-10, lower is better)",
        "refund_score": "number (1-10)",
        "total_travel_time_hours": "number",
        "total_flights": "integer",
        "total_hotel_nights": "integer",
    },
}


def get_output_schema_str() -> str:
    """Return the output schema as a pretty-printed JSON string (for prompts)."""
    return json.dumps(ITINERARY_OUTPUT_SCHEMA, indent=2, ensure_ascii=False)
