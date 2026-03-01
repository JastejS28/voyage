"""
Tool wrappers for Itinerary Agents.

Provides:
    FlightTool    – search flights  (mock / live via FlyScraper RapidAPI)
    HotelTool     – search hotels   (mock / live via TBO Hotel API)
    WebSearchTool – web search      (Google Gemini Grounding Search)

Toggle between mock and live with env var  USE_MOCK_DATA=true|false  (default: true).
"""

from __future__ import annotations

import importlib.util
import json
import logging
import os
import random
import re
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv(dotenv_path=str(Path(__file__).resolve().parent.parent / "config.env"))

logger = logging.getLogger("ItineraryTools")

# ─── Configuration ────────────────────────────────────────────────────────────
USE_MOCK: bool = os.getenv("USE_MOCK_DATA", "true").lower() == "false"

_PROJECT_ROOT     = Path(__file__).resolve().parent.parent
_FLIGHT_RESPONSES = _PROJECT_ROOT / "TBO_API" / "Flight_API" / "flight_api_responses"
_HOTEL_RESPONSES  = _PROJECT_ROOT / "TBO_API" / "Hotel_API"  / "responses"


def _load_json(path: Path) -> dict | list:
    """Load a JSON file from disk."""
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _lazy_import(module_name: str, file_path: str):
    """Import a module from an arbitrary file path without touching sys.path."""
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    mod  = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)                   # type: ignore[union-attr]
    return mod


# ═══════════════════════════════════════════════════════════════════════════════
#  Hotel Price Assignment  (used when real prices are unavailable)
# ═══════════════════════════════════════════════════════════════════════════════

HOTEL_PRICE_TIERS: dict[str, list[int]] = {
    "OneStar":   [30,  40,  50,  60],
    "TwoStar":   [60,  75,  90,  100],
    "ThreeStar": [100, 120, 140, 160],
    "FourStar":  [160, 200, 240, 280],
    "FiveStar":  [300, 400, 500, 600],
    "All":       [80,  120, 160, 200],
}


def assign_hotel_price(star_rating: str, currency: str = "USD") -> dict[str, Any]:
    """
    Assign a random price-per-night from a configurable tier list.

    Modify ``HOTEL_PRICE_TIERS`` above to change the price ranges.
    """
    tier  = HOTEL_PRICE_TIERS.get(star_rating, HOTEL_PRICE_TIERS["All"])
    price = random.choice(tier)
    return {"amount": price, "currency": currency}


# ═══════════════════════════════════════════════════════════════════════════════
#  Flight Tool
# ═══════════════════════════════════════════════════════════════════════════════

class FlightTool:
    """Search flights via FlyScraper RapidAPI *or* local mock JSON files."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("FLIGHT_API_KEY", "")
        self._client: Any = None

    # ── lazy live client ──────────────────────────────────────────────────
    def _get_client(self):
        if self._client is None:
            mod = _lazy_import(
                "flight_api_client",
                str(_PROJECT_ROOT / "TBO_API" / "Flight_API" / "test.py"),
            )
            self._client = mod.FlyScraperAPIClient(api_key=self.api_key)
        return self._client

    # ── mock helpers ─────────────────────────────────────────────────────
    def _mock_autocomplete(self, query: str) -> list[dict]:
        data     = _load_json(_FLIGHT_RESPONSES / "autocomplete_query.json")
        results  = data.get("data", [])
        q_lower  = query.lower()
        return [
            r for r in results
            if q_lower in r.get("name", "").lower()
            or q_lower in r.get("iataCode", "").lower()
        ]

    def _mock_search_flights(self) -> list[dict]:
        """Return the fullest mock dataset available."""
        try:
            data = _load_json(_FLIGHT_RESPONSES / "search_incomplete.json")
            itins = data.get("data", {}).get("itineraries", [])
            if itins:
                return itins
        except Exception:
            pass
        data = _load_json(_FLIGHT_RESPONSES / "search_one_way.json")
        return data.get("data", {}).get("itineraries", [])

    # ── public API ───────────────────────────────────────────────────────
    def autocomplete(self, query: str) -> list[dict]:
        """Find airports / cities by name.  Returns list of entities."""
        if USE_MOCK:
            return self._mock_autocomplete(query)
        client = self._get_client()
        result = client.autocomplete(query=query)
        return result.get("data", []) if result else []

    def search_flights(
        self,
        origin: str,
        destination: str,
        date: str,
        *,
        adults: int = 1,
        cabin_class: str = "economy",
        max_results: int = 20,
    ) -> list[dict[str, Any]]:
        """
        Search one-way flights and return **normalised** flight dicts.

        Parameters
        ----------
        origin, destination : str
            City / airport name or IATA code.
        date : str
            Departure date ``YYYY-MM-DD``.
        adults : int
            Passenger count.
        cabin_class : str
            economy | premium_economy | business | first
        max_results : int
            Cap on returned flights.

        Returns
        -------
        list[dict]
            Each dict has:  id, airline, flight_number, departure_city,
            arrival_city, departure_time, arrival_time, duration_minutes,
            stops, price_amount, price_formatted, rating, feedback_count,
            fare_class, booking_link, score, is_eco_contender, carriers.
        """
        if USE_MOCK:
            raw = self._mock_search_flights()
            return self._normalize_flights(raw[:max_results])

        # ── live mode ────────────────────────────────────────────────────
        origin_hits = self.autocomplete(origin)
        dest_hits   = self.autocomplete(destination)

        origin_sky  = origin_hits[0]["iataCode"] if origin_hits else origin
        dest_sky    = dest_hits[0]["iataCode"]   if dest_hits   else destination

        client = self._get_client()
        result = client.search_one_way(
            origin_id=origin_sky,
            dest_id=dest_sky,
            date=date,
            additional_params={"adults": adults, "cabinClass": cabin_class},
        )

        raw: list[dict] = []
        if result and "data" in result:
            raw = result["data"].get("itineraries", [])
            # poll for complete results if still incomplete
            ctx = result["data"].get("context", {})
            sid = ctx.get("sessionId")
            if sid and ctx.get("status") == "incomplete":
                poll = client.search_incomplete(session_id=sid)
                if poll and "data" in poll:
                    raw = poll["data"].get("itineraries", [])

        return self._normalize_flights(raw[:max_results])

    def search_multi_city(
        self,
        flights: list[dict],
        adults: int = 1,
        cabin_class: str = "economy",
    ) -> list[dict[str, Any]]:
        """Search multi-city flights.  ``flights`` = list of leg dicts."""
        if USE_MOCK:
            data = _load_json(_FLIGHT_RESPONSES / "search_multi_city.json")
            raw  = data.get("data", {}).get("itineraries", [])
            return self._normalize_flights(raw)

        client  = self._get_client()
        payload = {
            "market": "US", "locale": "en-US", "currency": "USD",
            "adults": adults, "children": 0, "infants": 0,
            "cabinClass": cabin_class,
            "stops": [], "sort": "", "carriersIds": [],
            "flights": flights,
        }
        result = client.search_multi_city(payload=payload)
        raw    = result.get("data", {}).get("itineraries", []) if result else []
        return self._normalize_flights(raw)

    # ── normaliser ───────────────────────────────────────────────────────
    @staticmethod
    def _normalize_flights(itineraries: list[dict]) -> list[dict[str, Any]]:
        """Convert raw API itinerary objects → flat, agent-friendly dicts."""
        normalised: list[dict[str, Any]] = []
        for itin in itineraries:
            try:
                # ── price ────────────────────────────────────────────
                price_info      = itin.get("price", {})
                price_formatted = price_info.get("formatted", "N/A")
                price_raw       = price_info.get("raw", "0")
                try:
                    price_amount = int(price_raw) / 1000        # milli → dollars
                except (ValueError, TypeError):
                    price_amount = 0.0

                # ── best pricing option (agent / deep-link) ─────────
                p_opts    = itin.get("pricingOptions", [])
                best_opt  = p_opts[0] if p_opts else {}
                items     = best_opt.get("items", [])
                best_item = items[0] if items else {}
                agent_inf = best_item.get("agent", {})

                # ── legs & segments ──────────────────────────────────
                legs  = itin.get("legs", [])
                leg   = legs[0] if legs else {}
                segs  = leg.get("segments", [])
                seg0  = segs[0] if segs else {}
                mkt   = seg0.get("carriers", {}).get("marketing", {})

                # ── fare info ────────────────────────────────────────
                fares      = best_item.get("fares", [])
                fare_class = fares[0].get("bookingCode", "N/A") if fares else "N/A"

                origin = leg.get("origin", {})
                dest   = leg.get("destination", {})

                normalised.append({
                    "id":               itin.get("id", ""),
                    "airline":          mkt.get("name", agent_inf.get("name", "Unknown")),
                    "airline_iata":     mkt.get("iata", ""),
                    "flight_number":    f"{mkt.get('displayCode', '')}{seg0.get('marketingFlightNumber', '')}",
                    "departure_city":   origin.get("name", ""),
                    "departure_iata":   origin.get("iata", ""),
                    "arrival_city":     dest.get("name", ""),
                    "arrival_iata":     dest.get("iata", ""),
                    "departure_time":   leg.get("departure", ""),
                    "arrival_time":     leg.get("arrival", ""),
                    "duration_minutes": leg.get("durationInMinutes", 0),
                    "stops":            leg.get("stopCount", 0),
                    "price_amount":     price_amount,
                    "price_formatted":  price_formatted,
                    "rating":           agent_inf.get("rating", 0.0),
                    "feedback_count":   agent_inf.get("feedbackCount", 0),
                    "fare_class":       fare_class,
                    "booking_link":     best_item.get("deepLink", ""),
                    "score":            float(itin.get("score", 0.0)),
                    "is_eco_contender": itin.get("sustainabilityData", {}).get("isEcoContender", False),
                    "carriers": [
                        s.get("carriers", {}).get("marketing", {}).get("name", "")
                        for s in segs
                    ],
                })
            except Exception as exc:
                logger.warning("Failed to normalise flight itinerary: %s", exc)
        return normalised


# ═══════════════════════════════════════════════════════════════════════════════
#  Hotel Tool
# ═══════════════════════════════════════════════════════════════════════════════

_STAR_STR_TO_NUM: dict[str, int] = {
    "OneStar": 1, "TwoStar": 2, "ThreeStar": 3,
    "FourStar": 4, "FiveStar": 5, "All": 0,
}
_STAR_NUM_TO_STR: dict[int, str] = {v: k for k, v in _STAR_STR_TO_NUM.items() if v}


class HotelTool:
    """Search hotels via TBO Hotel API *or* local mock JSON files."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
    ):
        self.base_url = base_url or os.getenv(
            "HOTEL_API_BASE_URL",
            "http://api.tbotechnology.in/TBOHolidays_HotelAPI",
        )
        self.username = username or os.getenv("HOTEL_API_USERNAME", "hackathontest")
        self.password = password or os.getenv("HOTEL_API_PASSWORD", "Hac@98147521")
        self._client: Any = None

    def _get_client(self):
        if self._client is None:
            mod = _lazy_import(
                "hotel_api_client",
                str(_PROJECT_ROOT / "TBO_API" / "Hotel_API" / "test.py"),
            )
            self._client = mod.TBOHotelAPIClient(
                self.base_url, self.username, self.password,
            )
        return self._client

    # ── mock helpers ─────────────────────────────────────────────────────
    def _mock_country_list(self) -> list[dict]:
        return _load_json(_HOTEL_RESPONSES / "country_list.json").get("CountryList", [])

    def _mock_city_list(self) -> list[dict]:
        return _load_json(_HOTEL_RESPONSES / "city_list_MV.json").get("CityList", [])

    def _mock_hotel_codes(self) -> list[dict]:
        return _load_json(_HOTEL_RESPONSES / "hotel_codes_130543.json").get("Hotels", [])

    def _mock_hotel_details(self) -> list[dict]:
        return _load_json(_HOTEL_RESPONSES / "hotel_details.json").get("HotelDetails", [])

    # ── resolvers ────────────────────────────────────────────────────────
    def get_country_code(self, country_name: str) -> Optional[str]:
        """Resolve a country name → ISO-2 code."""
        if USE_MOCK:
            countries = self._mock_country_list()
        else:
            client = self._get_client()
            res    = client.get_country_list()
            countries = res.get("CountryList", []) if res else []

        key = country_name.lower()
        for c in countries:
            if key in c.get("Name", "").lower():
                return c["Code"]
        return None

    def get_city_code(
        self, country_code: str, city_name: Optional[str] = None,
    ) -> Optional[str]:
        """Resolve a city name → TBO city code within a country."""
        if USE_MOCK:
            cities = self._mock_city_list()
        else:
            client = self._get_client()
            res    = client.get_city_list(country_code=country_code)
            cities = res.get("CityList", []) if res else []

        if city_name:
            key = city_name.lower()
            for c in cities:
                if key in c.get("Name", "").lower():
                    return c["Code"]
        return cities[0]["Code"] if cities else None

    # ── main search ──────────────────────────────────────────────────────
    def search_hotels(
        self,
        destination: str,
        country: Optional[str] = None,
        star_rating_min: Optional[int] = None,
        max_results: int = 20,
    ) -> list[dict[str, Any]]:
        """
        Search hotels for a destination.

        Returns normalised hotel dicts with keys:
            hotel_code, name, star_rating, star_rating_num, trip_advisor_rating,
            address, city, country, description, facilities, attractions_nearby,
            map_location, price_per_night, check_in_time, check_out_time,
            image_url, website_url
        """
        if USE_MOCK:
            raw_hotels  = self._mock_hotel_codes()
            details_map: dict[str, dict] = {}
            for d in self._mock_hotel_details():
                details_map[str(d.get("HotelCode", ""))] = d
        else:
            # resolve country → city → hotels
            country_code = self.get_country_code(country) if country else None
            if not country_code:
                country_code = "US"  # fallback
            city_code = self.get_city_code(country_code, city_name=destination)

            client     = self._get_client()
            raw_hotels = []
            if city_code:
                res = client.get_hotel_code_list(city_code=city_code)
                raw_hotels = res.get("Hotels", []) if res else []

            # fetch details for a small batch
            details_map = {}
            if raw_hotels:
                codes = ",".join(
                    str(h.get("HotelCode", "")) for h in raw_hotels[:10]
                )
                det = client.get_hotel_details(hotel_codes=codes)
                for d in (det or {}).get("HotelDetails", []):
                    details_map[str(d.get("HotelCode", ""))] = d

        return self._normalize_hotels(
            raw_hotels[:max_results], details_map, star_rating_min,
        )

    # ── normaliser ───────────────────────────────────────────────────────
    @staticmethod
    def _normalize_hotels(
        hotels: list[dict],
        details_map: dict[str, dict],
        star_rating_min: Optional[int] = None,
    ) -> list[dict[str, Any]]:
        """Convert raw TBO hotel objects → flat, agent-friendly dicts."""
        normalised: list[dict[str, Any]] = []
        for h in hotels:
            try:
                code   = str(h.get("HotelCode", ""))
                detail = details_map.get(code, {})

                star_str = h.get("HotelRating", detail.get("HotelRating", "All"))
                if isinstance(star_str, int):
                    star_num = star_str
                    star_str = _STAR_NUM_TO_STR.get(star_str, "All")
                else:
                    star_num = _STAR_STR_TO_NUM.get(str(star_str), 0)

                if star_rating_min and star_num < star_rating_min:
                    continue

                # attractions (may be list or dict)
                attr_raw = detail.get("Attractions", h.get("Attractions", []))
                if isinstance(attr_raw, dict):
                    attractions = list(attr_raw.values())
                elif isinstance(attr_raw, list):
                    attractions = attr_raw
                else:
                    attractions = []

                facilities = detail.get(
                    "HotelFacilities", h.get("HotelFacilities", []),
                )
                if not isinstance(facilities, list):
                    facilities = []

                price = assign_hotel_price(star_str)

                normalised.append({
                    "hotel_code":          code,
                    "name":                h.get("HotelName", detail.get("HotelName", "Unknown")),
                    "star_rating":         star_str,
                    "star_rating_num":     star_num,
                    "trip_advisor_rating": h.get("TripAdvisorRating", detail.get("TripAdvisorRating")),
                    "address":             detail.get("Address", h.get("Address", "")),
                    "city":                h.get("CityName", detail.get("CityName", "")),
                    "country":             h.get("CountryName", detail.get("CountryName", "")),
                    "description":         (detail.get("Description", h.get("Description", "")) or "")[:500],
                    "facilities":          facilities,
                    "facilities_count":    len(facilities),
                    "attractions_nearby":  attractions,
                    "map_location":        h.get("Map", detail.get("Map", "")),
                    "price_per_night":     price,
                    "check_in_time":       detail.get("CheckInTime", "14:00:00"),
                    "check_out_time":      detail.get("CheckOutTime", "12:00:00"),
                    "image_url":           detail.get("Image"),
                    "website_url":         detail.get("HotelWebsiteUrl", h.get("HotelWebsiteUrl")),
                })
            except Exception as exc:
                logger.warning("Failed to normalise hotel: %s", exc)
        return normalised


# ═══════════════════════════════════════════════════════════════════════════════
#  Web Search Tool  (Google Gemini Grounding Search)
# ═══════════════════════════════════════════════════════════════════════════════

class WebSearchTool:
    """
    Web search powered by Google Gemini's grounding-with-Google-Search.

    Uses ``google.genai.Client.models.generate_content`` with
    ``types.Tool(google_search=types.GoogleSearch())``.

    The **output contract is stable**: always returns a dict with keys
        destination, activities, restaurants, travel_tips, sources, source.
    Swap internals freely without breaking callers.
    """

    _SEARCH_MODEL = "gemini-2.5-flash"

    def __init__(self, api_key: Optional[str] = None):
        self._api_key = api_key or os.getenv("GEMINI_API_KEY", "")
        self._client: genai.Client | None = None

    @property
    def client(self) -> genai.Client:
        if self._client is None:
            self._client = genai.Client(api_key=self._api_key)
        return self._client

    # ──────────────────────────────────────────────────────────────────────
    def _grounding_search(self, query: str) -> dict[str, Any]:
        """
        Low-level: call Gemini with Google Search grounding.
        Returns {text, citations, raw_response}.
        """
        grounding_tool = types.Tool(
            google_search=types.GoogleSearch()
        )
        config = types.GenerateContentConfig(
            tools=[grounding_tool],
            temperature=0.1,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        )

        response = self.client.models.generate_content(
            model=self._SEARCH_MODEL,
            contents=query,
            config=config,
        )

        text = response.text or ""
        citations: list[dict[str, str]] = []

        # extract grounding metadata if available
        try:
            candidate = response.candidates[0]
            grounding = candidate.grounding_metadata
            if grounding and grounding.grounding_chunks:
                for chunk in grounding.grounding_chunks:
                    if hasattr(chunk, "web") and chunk.web:
                        citations.append({
                            "title": getattr(chunk.web, "title", ""),
                            "uri":   getattr(chunk.web, "uri", ""),
                        })
        except (IndexError, AttributeError):
            pass

        return {"text": text, "citations": citations}

    # ──────────────────────────────────────────────────────────────────────
    def _parse_activities(self, raw_text: str) -> list[dict[str, Any]]:
        """Best-effort parsing of activities from grounding response text."""
        # Try to extract JSON arrays from the response
        try:
            match = re.search(r"\[[\s\S]*?\]", raw_text)
            if match:
                parsed = json.loads(match.group(0))
                if isinstance(parsed, list):
                    return parsed
        except (json.JSONDecodeError, AttributeError):
            pass

        # Fallback: parse line-by-line
        activities: list[dict[str, Any]] = []
        lines = raw_text.strip().split("\n")
        for line in lines:
            line = line.strip().lstrip("•-*0123456789.) ")
            if len(line) > 5 and not line.startswith("#"):
                activities.append({
                    "name": line[:100],
                    "type": "sightseeing",
                    "description": line,
                    "estimated_cost": 0,
                    "duration_hours": 2.0,
                })
        return activities[:15]  # cap

    # ──────────────────────────────────────────────────────────────────────
    def search(
        self,
        destination: str,
        query_type: str = "all",
    ) -> dict[str, Any]:
        """
        Search for destination activities, restaurants, or general info
        using Gemini grounding search.

        Parameters
        ----------
        destination : str
            City or place name.
        query_type : str
            ``"activities"`` | ``"restaurants"`` | ``"all"``

        Returns
        -------
        dict  with keys:
            destination, activities, restaurants, travel_tips, sources, source
        """
        activities:  list[dict[str, Any]] = []
        restaurants: list[dict[str, Any]] = []
        travel_tips: list[str] = []
        all_sources: list[dict[str, str]] = []

        # ── activities query ─────────────────────────────────────────
        if query_type in ("activities", "all"):
            act_query = (
                f"Top tourist activities, sightseeing, and things to do in "
                f"{destination}. For each activity list the name, type "
                f"(sightseeing/adventure/cultural/dining/relaxation/shopping), "
                f"a short description, estimated cost in USD, and duration in hours."
            )
            try:
                act_result = self._grounding_search(act_query)
                activities = self._parse_activities(act_result["text"])
                all_sources.extend(act_result["citations"])
                logger.info(
                    "WebSearch activities for %s: %d items, %d sources",
                    destination, len(activities), len(act_result["citations"]),
                )
            except Exception as exc:
                logger.error("WebSearch activities failed for %s: %s", destination, exc)

        # ── restaurants query ────────────────────────────────────────
        if query_type in ("restaurants", "all"):
            rest_query = (
                f"Best restaurants and food experiences in {destination}. "
                f"For each: name, cuisine type, price range ($/$$/$$$/$$$$), "
                f"rating out of 5."
            )
            try:
                rest_result = self._grounding_search(rest_query)
                restaurants = self._parse_activities(rest_result["text"])
                # re-label keys for restaurant context
                for r in restaurants:
                    r.setdefault("cuisine", "local")
                    r.setdefault("price_range", "$$")
                    r.setdefault("rating", 4.0)
                all_sources.extend(rest_result["citations"])
                logger.info(
                    "WebSearch restaurants for %s: %d items",
                    destination, len(restaurants),
                )
            except Exception as exc:
                logger.error("WebSearch restaurants failed for %s: %s", destination, exc)

        # ── travel tips query ────────────────────────────────────────
        if query_type == "all":
            tips_query = (
                f"Essential travel tips for visiting {destination}: "
                f"best time to visit, local currency, transport, safety, "
                f"visa requirements, cultural etiquette."
            )
            try:
                tips_result = self._grounding_search(tips_query)
                raw_tips = tips_result["text"].strip().split("\n")
                travel_tips = [
                    t.strip().lstrip("•-*0123456789.) ")
                    for t in raw_tips
                    if len(t.strip()) > 10
                ][:8]  # cap
                all_sources.extend(tips_result["citations"])
                logger.info(
                    "WebSearch tips for %s: %d tips",
                    destination, len(travel_tips),
                )
            except Exception as exc:
                logger.error("WebSearch tips failed for %s: %s", destination, exc)

        return {
            "destination": destination,
            "activities":  activities,
            "restaurants": restaurants,
            "travel_tips": travel_tips,
            "sources":     all_sources,
            "source":      "google_grounding_search",
        }
