import os
import json
from typing import Dict, Optional

# Import the class from the file where you saved it
# Ensure your client code is saved as 'flight_client.py'
from test import FlyScraperAPIClient

def save_to_json(data: Optional[Dict], filename: str, output_dir: str):
    """
    Helper function to save dictionary data to a JSON file.
    Creates the output directory if it doesn't exist.
    """
    if not data:
        print(f"[-] Skipping {filename}: No data received or data is empty.")
        return

    # Create the directory if it does not exist
    os.makedirs(output_dir, exist_ok=True)
    
    # Construct the full file path
    filepath = os.path.join(output_dir, filename)

    # Write the JSON data to the file
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4)
        
    print(f"[+] Successfully saved: {filepath}")

def main():
    # --- Configuration ---
    API_KEY = "66aaca58f8msh86de9f20a718d06p15ec02jsnaa5ed7dc78d3"
    OUTPUT_DIR = "flight_api_responses"

    # Initialize the client
    flight_client = FlyScraperAPIClient(api_key=API_KEY)
    print(f"Starting Flight API calls. Output directory: '{OUTPUT_DIR}'\n")

    # 1. Fetch and Save Autocomplete
    print("--- Fetching Autocomplete ---")
    autocomplete_results = flight_client.autocomplete(query="new")
    save_to_json(autocomplete_results, "autocomplete.json", OUTPUT_DIR)

    # 2. Fetch and Save Search One-Way
    print("\n--- Fetching Search One-Way ---")
    one_way_results = flight_client.search_one_way(origin_id="MSYA", dest_id="PARI", date="2025-06-13")
    save_to_json(one_way_results, "search_one_way.json", OUTPUT_DIR)

    # 3. Extract Session ID and Fetch Search Incomplete
    print("\n--- Fetching Search Incomplete ---")
    session_id = None
    
    # Safely extract the session ID by chaining .get() to prevent KeyErrors
    if one_way_results:
        session_id = one_way_results.get("data", {}).get("context", {}).get("sessionId")
        
    if session_id:
        print(f"[+] Extracted Session ID: {session_id[:20]}... (truncated for display)")
        incomplete_results = flight_client.search_incomplete(session_id=session_id)
        save_to_json(incomplete_results, "search_incomplete.json", OUTPUT_DIR)
    else:
        print("[-] Skipping Search Incomplete: We couldn't extract the sessionId from the One-Way search.")

    # 4. Fetch and Save Search Multi-City
    print("\n--- Fetching Search Multi-City ---")
    multi_city_payload = {
        "market": "US",
        "locale": "en-US",
        "currency": "USD",
        "adults": 1,
        "children": 0,
        "infants": 0,
        "cabinClass": "economy",
        "stops": [],
        "sort": "",
        "carriersIds": [-32677, -32695],
        "flights": [
            {
                "originSkyId": "MSYA",
                "destinationSkyId": "LOND",
                "departDate": "2026-06-13"
            },
            {
                "originSkyId": "PARI",
                "destinationSkyId": "HAN",
                "departDate": "2026-06-29"
            }
        ]
    }
    multi_city_results = flight_client.search_multi_city(payload=multi_city_payload)
    save_to_json(multi_city_results, "search_multi_city.json", OUTPUT_DIR)

    print("\nAll Flight API tasks completed.")

if __name__ == "__main__":
    main()