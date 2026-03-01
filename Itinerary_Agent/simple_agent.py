"""
Simple AI Agent for Flight and Hotel Search.

Takes natural language input, extracts requirements using LLM,
searches flights and hotels, then ranks and formats results.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Optional

from llm_config import LLMConfig
from tools import FlightTool, HotelTool

logger = logging.getLogger("SimpleAgent")
logging.basicConfig(level=logging.INFO)


class SimpleFlightHotelAgent:
    """
    Simple agent that takes user query and returns flight/hotel options.
    
    Flow:
    1. Parse user input using LLM to extract structured requirements
    2. Call Flight and Hotel APIs
    3. Rank and format results using LLM
    """

    def __init__(self, llm_config: Optional[LLMConfig] = None):
        """Initialize the agent with LLM and API tools."""
        self.llm_config = llm_config or LLMConfig()
        self.client = self.llm_config.get_client()
        self.flight_tool = FlightTool()
        self.hotel_tool = HotelTool()
        
        logger.info(f"SimpleAgent initialized with model: {self.llm_config.model_name}")

    def parse_user_input(self, user_query: str) -> dict[str, Any]:
        """
        Use LLM to extract structured travel requirements from natural language.
        
        Returns dict with: origin, destination, departure_date, return_date,
        adults, hotel_nights, preferences, etc.
        """
        logger.info("Parsing user input with LLM...")
        
        prompt = f"""You are a travel requirements extractor. Analyze the user's travel request and extract structured information.

User Query: "{user_query}"

Extract the following information in JSON format:
- origin: Origin city/airport name
- destination: Destination city/airport name
- departure_date: Departure date in YYYY-MM-DD format (if mentioned, otherwise use today + 7 days)
- return_date: Return date in YYYY-MM-DD format (optional)
- adults: Number of adults (default: 1)
- hotel_nights: Number of nights for hotel stay (calculate from dates or default to 3)
- hotel_star_rating: Preferred hotel star rating (1-5, optional)
- budget_preference: Budget preference (low/medium/high, optional)
- other_preferences: Any other preferences mentioned (string, optional)

Current date: {datetime.now().strftime('%Y-%m-%d')}

Return ONLY valid JSON with the extracted information. If information is missing, use reasonable defaults.

Example output:
{{
    "origin": "New York",
    "destination": "Paris",
    "departure_date": "2026-06-15",
    "return_date": "2026-06-20",
    "adults": 1,
    "hotel_nights": 5,
    "hotel_star_rating": 4,
    "budget_preference": "medium",
    "other_preferences": "prefer direct flights"
}}
"""

        try:
            response = self.client.models.generate_content(
                model=self.llm_config.model_name,
                contents=prompt,
                config=self.llm_config.get_generation_config()
            )
            
            # Extract JSON from response
            response_text = response.text.strip()
            
            # Remove markdown code blocks if present
            if response_text.startswith("```"):
                response_text = response_text.split("```")[1]
                if response_text.startswith("json"):
                    response_text = response_text[4:]
                response_text = response_text.strip()
            
            requirements = json.loads(response_text)
            logger.info(f"Extracted requirements: {requirements}")
            return requirements
            
        except Exception as e:
            logger.error(f"Error parsing user input: {e}")
            # Return default values if parsing fails
            return {
                "origin": "New York",
                "destination": "Paris",
                "departure_date": "2026-06-15",
                "adults": 1,
                "hotel_nights": 3,
                "error": str(e)
            }

    def search_flights_and_hotels(
        self, requirements: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Call Flight and Hotel APIs based on extracted requirements.
        
        Returns dict with: flights (list), hotels (list), requirements (dict)
        """
        logger.info("Searching flights and hotels...")
        
        results = {
            "flights": [],
            "hotels": [],
            "requirements": requirements,
            "errors": {}
        }
        
        # Search Flights
        try:
            logger.info(f"Searching flights: {requirements.get('origin')} -> {requirements.get('destination')}")
            
            flights = self.flight_tool.search_flights(
                origin=requirements.get("origin", "New York"),
                destination=requirements.get("destination", "Paris"),
                date=requirements.get("departure_date", "2026-06-15"),
                adults=requirements.get("adults", 1),
                max_results=10
            )
            
            results["flights"] = flights[:10]  # Limit to top 10
            logger.info(f"Found {len(results['flights'])} flights")
            
        except Exception as e:
            logger.error(f"Error searching flights: {e}")
            results["errors"]["flights"] = str(e)
        
        # Search Hotels
        try:
            destination = requirements.get("destination", "Paris")
            star_rating = requirements.get("hotel_star_rating")
            
            logger.info(f"Searching hotels in: {destination}")
            
            hotels = self.hotel_tool.search_hotels(
                destination=destination,
                star_rating_min=star_rating if star_rating else None,
                max_results=10
            )
            
            results["hotels"] = hotels[:10]  # Limit to top 10
            logger.info(f"Found {len(results['hotels'])} hotels")
            
        except Exception as e:
            logger.error(f"Error searching hotels: {e}")
            results["errors"]["hotels"] = str(e)
        
        return results

    def rank_and_format_results(
        self, search_results: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Use LLM to rank results based on user preferences and create summary.
        
        Returns dict with: 
            - ranked_flights (list)
            - ranked_hotels (list)  
            - summary (str with natural language explanation)
            - raw_results (original data)
        """
        logger.info("Ranking and formatting results with LLM...")
        
        requirements = search_results["requirements"]
        flights = search_results["flights"]
        hotels = search_results["hotels"]
        
        # Prepare simplified data for LLM
        flights_summary = []
        for i, flight in enumerate(flights[:5]):  # Top 5 for LLM
            flights_summary.append({
                "index": i,
                "airline": flight.get("airline", "Unknown"),
                "price": flight.get("price_formatted", "N/A"),
                "duration": f"{flight.get('duration_minutes', 0) // 60}h {flight.get('duration_minutes', 0) % 60}m",
                "stops": flight.get("stops", 0),
                "departure": flight.get("departure_time", ""),
                "arrival": flight.get("arrival_time", ""),
                "rating": flight.get("rating", 0),
            })
        
        hotels_summary = []
        for i, hotel in enumerate(hotels[:5]):  # Top 5 for LLM
            hotels_summary.append({
                "index": i,
                "name": hotel.get("name", "Unknown"),
                "price": hotel.get("price_per_night", {}).get("amount", "N/A"),
                "currency": hotel.get("price_per_night", {}).get("currency", "USD"),
                "star_rating": hotel.get("star_rating", 0),
                "address": hotel.get("address", ""),
            })
        
        prompt = f"""You are a travel advisor. Analyze these flight and hotel options and provide recommendations.

User Requirements:
{json.dumps(requirements, indent=2)}

Available Flights:
{json.dumps(flights_summary, indent=2)}

Available Hotels:
{json.dumps(hotels_summary, indent=2)}

Task:
1. Rank the top 3 flights based on user preferences (price, duration, ratings)
2. Rank the top 3 hotels based on user preferences (price, star rating, location)
3. Provide a clear natural language summary explaining your recommendations

Return a JSON object with this structure:
{{
    "top_flights": [0, 1, 2],  // indices of top 3 flights in order
    "top_hotels": [0, 1, 2],   // indices of top 3 hotels in order
    "summary": "Multi-paragraph natural language summary explaining the recommendations, including details about each option and why they're good choices based on the user's requirements."
}}

Be helpful and conversational in the summary. Include specific details like prices, durations, and hotel names.
"""

        try:
            response = self.client.models.generate_content(
                model=self.llm_config.model_name,
                contents=prompt,
                config=self.llm_config.get_generation_config()
            )
            
            response_text = response.text.strip()
            logger.debug(f"Raw LLM response: {response_text[:200]}")
            
            # Remove markdown code blocks if present
            if "```json" in response_text:
                # Extract JSON from markdown code block
                start = response_text.find("```json") + 7
                end = response_text.find("```", start)
                response_text = response_text[start:end].strip()
            elif response_text.startswith("```"):
                # Remove generic code blocks
                parts = response_text.split("```")
                if len(parts) >= 3:
                    response_text = parts[1]
                    if response_text.startswith("json"):
                        response_text = response_text[4:]
                response_text = response_text.strip()
            
            # Try to find JSON object in the response
            if not response_text.startswith("{"):
                # Look for the first { and last }
                start_idx = response_text.find("{")
                end_idx = response_text.rfind("}")
                if start_idx != -1 and end_idx != -1:
                    response_text = response_text[start_idx:end_idx+1]
            
            ranking = json.loads(response_text)
            
            # Build ranked results
            ranked_flights = []
            for idx in ranking.get("top_flights", [0, 1, 2]):
                if idx < len(flights):
                    ranked_flights.append(flights[idx])
            
            ranked_hotels = []
            for idx in ranking.get("top_hotels", [0, 1, 2]):
                if idx < len(hotels):
                    ranked_hotels.append(hotels[idx])
            
            return {
                "ranked_flights": ranked_flights,
                "ranked_hotels": ranked_hotels,
                "summary": ranking.get("summary", "Results ranked by relevance."),
                "raw_results": {
                    "all_flights": flights,
                    "all_hotels": hotels
                },
                "requirements": requirements
            }
            
        except Exception as e:
            logger.error(f"Error ranking results: {e}")
            # Return unranked results with simple summary
            return {
                "ranked_flights": flights[:3],
                "ranked_hotels": hotels[:3],
                "summary": f"Found {len(flights)} flights and {len(hotels)} hotels for your trip from {requirements.get('origin')} to {requirements.get('destination')}. Here are the top options.",
                "raw_results": {
                    "all_flights": flights,
                    "all_hotels": hotels
                },
                "requirements": requirements,
                "error": str(e)
            }

    def search(self, user_query: str) -> dict[str, Any]:
        """
        Main entry point: Process user query and return formatted results.
        
        Args:
            user_query: Natural language travel request
            
        Returns:
            Dictionary with ranked flights, hotels, and summary
        """
        logger.info(f"Processing query: {user_query}")
        
        try:
            # Step 1: Parse user requirements
            requirements = self.parse_user_input(user_query)
            
            # Step 2: Search flights and hotels
            search_results = self.search_flights_and_hotels(requirements)
            
            # Step 3: Rank and format results
            final_results = self.rank_and_format_results(search_results)
            
            logger.info("Search completed successfully")
            return final_results
            
        except Exception as e:
            logger.error(f"Error in search: {e}")
            return {
                "error": str(e),
                "ranked_flights": [],
                "ranked_hotels": [],
                "summary": f"An error occurred while processing your request: {str(e)}"
            }


# Convenience function for direct usage
def search_flights_and_hotels(user_query: str, llm_config: Optional[LLMConfig] = None) -> dict[str, Any]:
    """
    Quick helper function to search flights and hotels with a natural language query.
    
    Example:
        result = search_flights_and_hotels("I want to fly from NYC to Paris next week")
    """
    agent = SimpleFlightHotelAgent(llm_config=llm_config)
    return agent.search(user_query)


# Testing
if __name__ == "__main__":
    # Test with a sample query
    test_query = "I want to fly from New York to Paris on June 15, 2026 and stay for 5 days in a 4-star hotel"
    
    print("=" * 80)
    print("TESTING SIMPLE FLIGHT & HOTEL AGENT")
    print("=" * 80)
    print(f"\nQuery: {test_query}\n")
    
    agent = SimpleFlightHotelAgent()
    result = agent.search(test_query)
    
    print("\n" + "=" * 80)
    print("RESULTS")
    print("=" * 80)
    print(f"\n{result['summary']}\n")
    print(f"\nTop {len(result['ranked_flights'])} Flights:")
    for i, flight in enumerate(result['ranked_flights'], 1):
        print(f"  {i}. {flight.get('airline')} - {flight.get('price_formatted')} - {flight.get('duration_minutes')}min")
    
    print(f"\nTop {len(result['ranked_hotels'])} Hotels:")
    for i, hotel in enumerate(result['ranked_hotels'], 1):
        price = hotel.get('price_per_night', {})
        print(f"  {i}. {hotel.get('name')} - {price.get('amount')}{price.get('currency', '')} ({hotel.get('star_rating')} stars)")
