"""
FastAPI service for the Itinerary Generation pipeline.

POST /generate  →  { core_itinerary, premium_itinerary, budget_itinerary }

Deployed on Google Cloud Run via:
    uvicorn api:app --host 0.0.0.0 --port $PORT
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from orchestrator import run_itinerary_generation
from llm_config import LLMConfig
from simple_agent import SimpleFlightHotelAgent

# ── logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)-20s | %(levelname)-7s | %(message)s",
)
logger = logging.getLogger("ItineraryAPI")

# ── app ──────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Voyage Itinerary Agent",
    description="Generates Core, Premium & Budget travel itineraries from a structured requirement.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── request / response models ───────────────────────────────────────────────

class GenerateRequest(BaseModel):
    """The structured requirement produced by the Requirement Extraction Agent."""
    structured_requirement: dict[str, Any] = Field(
        ...,
        description="Full structured travel requirement (TRAVEL_REQUIREMENT_SCHEMA)",
    )
    parallel: bool = Field(
        default=True,
        description="Run the 3 agents in parallel (faster) or sequentially",
    )


class GenerateResponse(BaseModel):
    core_itinerary: dict[str, Any]
    premium_itinerary: dict[str, Any]
    budget_itinerary: dict[str, Any]
    errors: list[str] = []
    elapsed_seconds: float = 0.0


class FlightHotelSearchRequest(BaseModel):
    """Request model for simple flight and hotel search."""
    query: str = Field(
        ...,
        description="Natural language travel query (e.g., 'I want to fly from NYC to Paris next week')",
        example="I want to fly from New York to Paris on June 15, 2026 and stay for 5 days in a 4-star hotel"
    )


# ── routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/generate", response_model=GenerateResponse)
def generate_itineraries(req: GenerateRequest):
    """
    Main endpoint: accepts a structured requirement, runs the full
    fetch → core/premium/budget pipeline, returns all three itineraries.
    """
    logger.info("POST /generate  destinations=%s", req.structured_requirement.get("route_plan", {}).get("destinations"))
    t0 = time.time()

    try:
        result = run_itinerary_generation(
            structured_requirement=req.structured_requirement,
            parallel=req.parallel,
        )
    except Exception as exc:
        logger.error("Pipeline crashed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))

    elapsed = round(time.time() - t0, 2)
    logger.info("POST /generate  done in %.1fs  errors=%d", elapsed, len(result.get("errors", [])))

    return GenerateResponse(
        core_itinerary=result.get("core_itinerary", {}),
        premium_itinerary=result.get("premium_itinerary", {}),
        budget_itinerary=result.get("budget_itinerary", {}),
        errors=result.get("errors", []),
        elapsed_seconds=elapsed,
    )


@app.post("/search-flights-hotels")
def search_flights_hotels_endpoint(req: FlightHotelSearchRequest):
    """
    Simple endpoint: Search for flights and hotels based on natural language query.
    
    Uses AI to parse the query, search APIs, and return ranked recommendations
    with a natural language summary.
    
    Example request:
    {
        "query": "I want to fly from New York to Paris on June 15, 2026 and stay for 5 days in a 4-star hotel"
    }
    
    Returns:
    {
        "ranked_flights": [...],
        "ranked_hotels": [...],
        "summary": "Natural language summary of recommendations",
        "raw_results": {...},
        "requirements": {...}
    }
    """
    logger.info("POST /search-flights-hotels  query=%s", req.query[:100])
    t0 = time.time()
    
    try:
        agent = SimpleFlightHotelAgent()
        result = agent.search(req.query)
        
        elapsed = round(time.time() - t0, 2)
        logger.info(
            "Search completed in %.1fs: %d flights, %d hotels",
            elapsed,
            len(result.get('ranked_flights', [])),
            len(result.get('ranked_hotels', []))
        )
        
        return result
        
    except Exception as exc:
        logger.error("Search failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Search failed: {str(exc)}"
        )


# ── local dev ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8080"))
    uvicorn.run("api:app", host="0.0.0.0", port=port, reload=True)
