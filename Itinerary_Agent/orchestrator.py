"""
Itinerary Orchestrator  — LangGraph StateGraph.

Flow
────
    START
      │
      ▼
  ┌──────────────┐
  │ fetch_data   │   calls FlightTool, HotelTool, WebSearchTool
  └──────┬───────┘
         │  (conditional fan-out)
    ┌────┼────┐
    ▼    ▼    ▼
  core prem budget   ← three agents run in parallel
    │    │    │
    └────┼────┘
         ▼
  ┌──────────────┐
  │ collect      │   assembles final payload
  └──────┬───────┘
         ▼
        END

Entry points
────────────
    build_graph()                 → compiled LangGraph
    run_itinerary_generation()    → one-shot convenience function
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from langgraph.graph import StateGraph, START, END

from llm_config import LLMConfig
from schemas import ItineraryState
from tools import FlightTool, HotelTool, WebSearchTool
from Core_Agent import CoreItineraryAgent
from Premium_Agent import PremiumItineraryAgent
from Budget_Agent import BudgetItineraryAgent

logger = logging.getLogger("Orchestrator")

# ═══════════════════════════════════════════════════════════════════════════════
#  Helpers
# ═══════════════════════════════════════════════════════════════════════════════

def _safe_int(val: Any, default: int = 1) -> int:
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _parse_date(val: Any, default_offset_days: int = 7) -> str:
    """Return a YYYY-MM-DD string.  Falls back to *today + offset*."""
    if isinstance(val, str) and val.strip():
        try:
            datetime.strptime(val.strip(), "%Y-%m-%d")
            return val.strip()
        except ValueError:
            pass
    return (datetime.now() + timedelta(days=default_offset_days)).strftime("%Y-%m-%d")


def _distribute_dates(
    start: str,
    end: str,
    num_destinations: int,
) -> list[tuple[str, str]]:
    """
    Split the trip window into roughly equal segments per destination.
    Returns list of (arrive_date, depart_date) tuples.
    """
    start_dt = datetime.strptime(start, "%Y-%m-%d")
    end_dt   = datetime.strptime(end,   "%Y-%m-%d")
    total_nights = max((end_dt - start_dt).days, 1)

    if num_destinations <= 0:
        return []

    nights_each = max(total_nights // num_destinations, 1)
    segments: list[tuple[str, str]] = []
    cursor = start_dt

    for i in range(num_destinations):
        seg_start = cursor
        if i == num_destinations - 1:
            seg_end = end_dt              # last destination takes the remainder
        else:
            seg_end = cursor + timedelta(days=nights_each)
        segments.append((
            seg_start.strftime("%Y-%m-%d"),
            seg_end.strftime("%Y-%m-%d"),
        ))
        cursor = seg_end

    return segments


# ═══════════════════════════════════════════════════════════════════════════════
#  Graph Nodes
# ═══════════════════════════════════════════════════════════════════════════════

def fetch_data(state: ItineraryState) -> dict[str, Any]:
    """
    Node 1 — fetch flights, hotels and web-search data for all legs / cities.
    Runs the three *tools* (not agents).
    """
    req = state["structured_requirement"]
    errors: list[str] = []

    route  = req.get("route_plan", {})
    origin       = route.get("origin", "")
    destinations = route.get("destinations", [])
    multi_city   = route.get("multi_city", False)

    dates   = req.get("dates", {})
    start   = _parse_date(dates.get("start_date"), default_offset_days=7)
    end     = _parse_date(dates.get("end_date"),   default_offset_days=14)

    travelers = req.get("travelers", {})
    adults    = _safe_int(travelers.get("adults"), 1) or 1

    transport = req.get("transport_preferences", {})
    cabin     = transport.get("flight_class", "economy") or "economy"

    # ── date segments per destination ────────────────────────────────────
    segments = _distribute_dates(start, end, len(destinations))

    # ── tools ────────────────────────────────────────────────────────────
    flight_tool = FlightTool()
    hotel_tool  = HotelTool()
    web_tool    = WebSearchTool()

    all_flights: list[dict[str, Any]] = []
    all_hotels:  list[dict[str, Any]] = []
    all_web:     dict[str, Any]       = {}

    # -- flights ----------------------------------------------------------
    # leg 0: origin → first destination
    prev = origin
    for idx, dest in enumerate(destinations):
        dep_date = segments[idx][0] if idx < len(segments) else start
        try:
            if prev:
                logger.info("Searching flights  %s → %s  on %s", prev, dest, dep_date)
                leg_flights = flight_tool.search_flights(
                    origin=prev,
                    destination=dest,
                    date=dep_date,
                    adults=adults,
                    cabin_class=cabin,
                )
                all_flights.extend(leg_flights)
            else:
                errors.append(f"No origin for leg to {dest}")
        except Exception as exc:
            logger.error("Flight search failed (%s→%s): %s", prev, dest, exc)
            errors.append(f"Flight search {prev}→{dest} failed: {exc}")
        prev = dest

    # return leg: last destination → origin
    if destinations and origin:
        ret_date = end
        try:
            logger.info("Searching return flights  %s → %s  on %s", destinations[-1], origin, ret_date)
            ret_flights = flight_tool.search_flights(
                origin=destinations[-1],
                destination=origin,
                date=ret_date,
                adults=adults,
                cabin_class=cabin,
            )
            all_flights.extend(ret_flights)
        except Exception as exc:
            logger.error("Return flight search failed: %s", exc)
            errors.append(f"Return flight search failed: {exc}")

    # -- hotels -----------------------------------------------------------
    for dest in destinations:
        try:
            country = req.get("documents_and_constraints", {}).get("passport_validity_notes") or None
            logger.info("Searching hotels in %s", dest)
            hotels = hotel_tool.search_hotels(
                destination=dest,
                star_rating_min=req.get("stay_preferences", {}).get("star_rating_min"),
            )
            all_hotels.extend(hotels)
        except Exception as exc:
            logger.error("Hotel search failed (%s): %s", dest, exc)
            errors.append(f"Hotel search {dest} failed: {exc}")

    # -- web search -------------------------------------------------------
    for dest in destinations:
        try:
            logger.info("Web search for activities in %s", dest)
            web = web_tool.search(destination=dest)
            all_web[dest] = web
        except Exception as exc:
            logger.error("Web search failed (%s): %s", dest, exc)
            errors.append(f"Web search {dest} failed: {exc}")

    logger.info(
        "fetch_data done  flights=%d  hotels=%d  web_dests=%d  errors=%d",
        len(all_flights), len(all_hotels), len(all_web), len(errors),
    )

    return {
        "flight_data":     all_flights,
        "hotel_data":      all_hotels,
        "web_search_data": all_web,
        "errors":          errors,
    }


# ── agent node factory ───────────────────────────────────────────────────────

def _make_agent_node(
    agent_cls: type,
    output_key: str,
    llm_config: LLMConfig | None = None,
):
    """
    Return a node function that runs the given agent and writes to *output_key*.
    """
    agent = agent_cls(llm_config or LLMConfig())

    def _node(state: ItineraryState) -> dict[str, Any]:
        logger.info("▶ Running %s agent …", agent.AGENT_TYPE)
        try:
            itinerary = agent.generate(
                requirement=state["structured_requirement"],
                flights=state.get("flight_data", []),
                hotels=state.get("hotel_data", []),
                web_data=state.get("web_search_data", {}),
            )
            return {output_key: itinerary}
        except Exception as exc:
            logger.error("%s agent failed: %s", agent.AGENT_TYPE, exc, exc_info=True)
            return {
                output_key: {
                    "plan_type": agent.AGENT_TYPE,
                    "error": str(exc),
                },
                "errors": [f"{agent.AGENT_TYPE} agent failed: {exc}"],
            }

    _node.__name__ = f"generate_{agent.AGENT_TYPE}"
    return _node


def collect_results(state: ItineraryState) -> dict[str, Any]:
    """
    Node — post-processing after all agents finish.
    Currently a pass-through; extend for scoring / comparison later.
    """
    logger.info(
        "collect_results  core=%s  premium=%s  budget=%s",
        "ok" if "error" not in state.get("core_itinerary", {})    else "err",
        "ok" if "error" not in state.get("premium_itinerary", {}) else "err",
        "ok" if "error" not in state.get("budget_itinerary", {})  else "err",
    )
    return {}        # nothing new to write — state already has everything


# ═══════════════════════════════════════════════════════════════════════════════
#  Graph Builder
# ═══════════════════════════════════════════════════════════════════════════════

def build_graph(
    llm_config: LLMConfig | None = None,
    *,
    parallel: bool = True,
) -> Any:
    """
    Compile and return the LangGraph orchestrator.

    Parameters
    ----------
    llm_config : LLMConfig, optional
        Shared LLM configuration for all three agents.
    parallel : bool
        If True, use conditional fan-out so agents run in parallel.
        If False, agents run sequentially (core → premium → budget).
    """
    cfg = llm_config or LLMConfig()

    gen_core    = _make_agent_node(CoreItineraryAgent,    "core_itinerary",    cfg)
    gen_premium = _make_agent_node(PremiumItineraryAgent, "premium_itinerary", cfg)
    gen_budget  = _make_agent_node(BudgetItineraryAgent,  "budget_itinerary",  cfg)

    builder = StateGraph(ItineraryState)

    # ── nodes ────────────────────────────────────────────────────────────
    builder.add_node("fetch_data",       fetch_data)
    builder.add_node("generate_core",    gen_core)
    builder.add_node("generate_premium", gen_premium)
    builder.add_node("generate_budget",  gen_budget)
    builder.add_node("collect_results",  collect_results)

    # ── edges ────────────────────────────────────────────────────────────
    builder.add_edge(START, "fetch_data")

    if parallel:
        # Fan-out: conditional edge returning a list → parallel execution
        builder.add_conditional_edges(
            "fetch_data",
            lambda _state: ["generate_core", "generate_premium", "generate_budget"],
        )
        # Fan-in: all three converge at collect_results
        builder.add_edge("generate_core",    "collect_results")
        builder.add_edge("generate_premium", "collect_results")
        builder.add_edge("generate_budget",  "collect_results")
    else:
        # Sequential fallback
        builder.add_edge("fetch_data",       "generate_core")
        builder.add_edge("generate_core",    "generate_premium")
        builder.add_edge("generate_premium", "generate_budget")
        builder.add_edge("generate_budget",  "collect_results")

    builder.add_edge("collect_results", END)

    logger.info("Graph compiled  mode=%s", "parallel" if parallel else "sequential")
    return builder.compile()


# ═══════════════════════════════════════════════════════════════════════════════
#  Convenience Runner
# ═══════════════════════════════════════════════════════════════════════════════

def run_itinerary_generation(
    structured_requirement: dict[str, Any],
    llm_config: LLMConfig | None = None,
    *,
    parallel: bool = True,
) -> dict[str, Any]:
    """
    One-shot: build graph → invoke → return final state.

    Parameters
    ----------
    structured_requirement : dict
        Output of the Requirement Extraction Agent (TRAVEL_REQUIREMENT_SCHEMA).
    llm_config : LLMConfig, optional
        Shared LLM config.
    parallel : bool
        Run the three agents in parallel (default) or sequentially.

    Returns
    -------
    dict with keys:
        core_itinerary, premium_itinerary, budget_itinerary,
        flight_data, hotel_data, web_search_data, errors
    """
    graph = build_graph(llm_config, parallel=parallel)

    initial_state: ItineraryState = {
        "structured_requirement": structured_requirement,
        "flight_data":      [],
        "hotel_data":       [],
        "web_search_data":  {},
        "core_itinerary":    {},
        "premium_itinerary": {},
        "budget_itinerary":  {},
        "errors":            [],
    }

    logger.info("═" * 60)
    logger.info("Starting itinerary generation pipeline")
    logger.info("═" * 60)

    result = graph.invoke(initial_state)

    logger.info("═" * 60)
    logger.info("Pipeline complete  errors=%d", len(result.get("errors", [])))
    logger.info("═" * 60)

    return result


# ═══════════════════════════════════════════════════════════════════════════════
#  CLI / Test
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import json
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(name)-20s | %(levelname)-7s | %(message)s",
    )

    # ── sample structured requirement (matches mock data reasonably) ─────
    sample_requirement: dict[str, Any] = {
        "trip_overview": {
            "summary": "Week-long trip from New Orleans to Paris",
            "trip_type": "leisure",
            "confidence": "high",
        },
        "travelers": {
            "count": 2,
            "adults": 2,
            "children": 0,
            "infants": 0,
            "special_needs": [],
        },
        "route_plan": {
            "origin": "New Orleans",
            "destinations": ["Paris"],
            "multi_city": False,
            "flexible_destinations": [],
        },
        "dates": {
            "start_date": "2026-03-15",
            "end_date": "2026-03-22",
            "duration_nights": 7,
            "date_flexibility": "low",
            "blackout_dates": [],
        },
        "budget": {
            "currency": "USD",
            "max_total": 8000,
            "budget_per_person": 4000,
            "budget_notes": "Flexible on hotel cost if quality is high",
        },
        "transport_preferences": {
            "flight_class": "economy",
            "preferred_airlines": [],
            "avoid_airlines": [],
            "stops_preference": "any",
            "departure_time_pref": "any",
        },
        "stay_preferences": {
            "property_types": ["hotel"],
            "star_rating_min": 3,
            "room_count": 1,
            "bed_type_pref": None,
            "amenities_required": ["Free WiFi"],
            "amenities_optional": ["Swimming pool", "Gym"],
            "location_preference": "city center",
        },
        "activities": {
            "must_do": ["Eiffel Tower visit", "Louvre Museum"],
            "nice_to_have": ["Seine River cruise"],
            "avoid": [],
            "pace": "balanced",
        },
        "food_preferences": {
            "dietary_restrictions": [],
            "cuisine_preferences": ["French", "Italian"],
        },
        "documents_and_constraints": {
            "visa_needed": None,
            "passport_validity_notes": None,
            "hard_constraints": [],
            "soft_constraints": [],
        },
        "extracted_facts": [],
        "implied_inferences": [],
    }

    logger.info("Sample requirement loaded — running pipeline …")
    result = run_itinerary_generation(sample_requirement, parallel=False)

    # ── display results ──
    for key in ("core_itinerary", "premium_itinerary", "budget_itinerary"):
        itin = result.get(key, {})
        print(f"\n{'═' * 60}")
        print(f"  {key.upper()}")
        print(f"{'═' * 60}")
        print(json.dumps(itin, indent=2, ensure_ascii=False, default=str)[:3000])

    if result.get("errors"):
        print(f"\n⚠  Errors: {result['errors']}")
