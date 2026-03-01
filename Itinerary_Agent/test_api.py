"""
Test script for the simple flight/hotel search API endpoint.
"""

import requests
import json

BASE_URL = "http://localhost:8080"

def test_health():
    """Test the health endpoint."""
    response = requests.get(f"{BASE_URL}/health")
    print("Health Check:", response.json())
    return response.status_code == 200

def test_search_flights_hotels(query: str):
    """Test the search-flights-hotels endpoint."""
    print("\n" + "="*80)
    print(f"Query: {query}")
    print("="*80)
    
    response = requests.post(
        f"{BASE_URL}/search-flights-hotels",
        json={"query": query},
        timeout=60
    )
    
    if response.status_code != 200:
        print(f"Error: {response.status_code}")
        print(response.text)
        return None
    
    result = response.json()
    
    # Display summary
    print("\n📝 SUMMARY:")
    print(result.get("summary", "No summary available"))
    
    # Display flights
    print(f"\n✈️ TOP {len(result.get('ranked_flights', []))} FLIGHTS:")
    for i, flight in enumerate(result.get("ranked_flights", []), 1):
        print(f"  {i}. {flight.get('airline')} - {flight.get('price_formatted')} - "
              f"{flight.get('duration_minutes')}min - {flight.get('stops')} stops")
    
    # Display hotels
    print(f"\n🏨 TOP {len(result.get('ranked_hotels', []))} HOTELS:")
    for i, hotel in enumerate(result.get("ranked_hotels", []), 1):
        price = hotel.get('price_per_night', {})
        print(f"  {i}. {hotel.get('name')} - {price.get('amount')}{price.get('currency', '')} - "
              f"{hotel.get('star_rating')} ({hotel.get('city', 'N/A')})")
    
    # Display requirements
    print(f"\n📋 EXTRACTED REQUIREMENTS:")
    req = result.get("requirements", {})
    print(f"  Origin: {req.get('origin')}")
    print(f"  Destination: {req.get('destination')}")
    print(f"  Departure: {req.get('departure_date')}")
    print(f"  Return: {req.get('return_date', 'N/A')}")
    print(f"  Adults: {req.get('adults')}")
    print(f"  Hotel Nights: {req.get('hotel_nights')}")
    print(f"  Hotel Stars: {req.get('hotel_star_rating', 'Any')}")
    
    return result


if __name__ == "__main__":
    print("="*80)
    print("FLIGHT & HOTEL SEARCH API TEST")
    print("="*80)
    
    # Test health
    if not test_health():
        print("❌ Server not responding!")
        exit(1)
    
    print("✅ Server is healthy\n")
    
    # Test cases
    test_queries = [
        "I want to fly from New York to Paris on June 15, 2026 and stay for 5 days in a 4-star hotel",
        "Find me a cheap flight from London to Tokyo next month with 3 nights in a budget hotel",
        "Business trip to Singapore in July, need direct flight and 5-star hotel for 2 nights",
    ]
    
    for query in test_queries:
        try:
            test_search_flights_hotels(query)
            print("\n")
        except Exception as e:
            print(f"❌ Test failed: {e}\n")
    
    print("="*80)
    print("ALL TESTS COMPLETED")
    print("="*80)
