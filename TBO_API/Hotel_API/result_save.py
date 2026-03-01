import os
import json
from typing import Dict, Optional

# Import the class from the file where you saved it
# Make sure your previous code is saved as 'tbo_client.py'
from test import TBOHotelAPIClient

def save_to_json(data: Optional[Dict], filename: str, output_dir: str):
    """
    Helper function to save dictionary data to a JSON file.
    Creates the output directory if it doesn't exist.
    """
    if data is None:
        print(f"[-] Skipping {filename}: No data received (check logs for errors).")
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
    BASE_URL = "http://api.tbotechnology.in/TBOHolidays_HotelAPI"
    USERNAME = "hackathontest"
    PASSWORD = "Hac@98147521"
    OUTPUT_DIR = "TBO_API/Hotel_API/responses" # Your desired output directory

    # Initialize the client
    api_client = TBOHotelAPIClient(BASE_URL, USERNAME, PASSWORD)
    print(f"Starting API calls. Output directory: '{OUTPUT_DIR}'\n")

    # 1. Fetch and Save Country List
    print("--- Fetching Country List ---")
    countries = api_client.get_country_list()
    save_to_json(countries, "country_list.json", OUTPUT_DIR)

    # 2. Fetch and Save City List
    print("\n--- Fetching City List ---")
    cities = api_client.get_city_list(country_code="MV")
    save_to_json(cities, "city_list_MV.json", OUTPUT_DIR)

    # 3. Fetch and Save Hotel Code List
    print("\n--- Fetching Hotel Codes ---")
    hotel_codes = api_client.get_hotel_code_list(city_code="130543")
    save_to_json(hotel_codes, "hotel_codes_130543.json", OUTPUT_DIR)

    # 4. Fetch and Save Hotel Details
    print("\n--- Fetching Hotel Details ---")
    target_hotels = "376565,1345318,1345320"
    hotel_details = api_client.get_hotel_details(hotel_codes=target_hotels)
    save_to_json(hotel_details, "hotel_details.json", OUTPUT_DIR)

    # 5. Execute and Save Search
    print("\n--- Executing Search ---")
    search_payload = {
        "CheckIn": "2025-11-20",
        "CheckOut": "2025-11-24",
        "HotelCodes": "376565,1345318,1345320,1200255",
        "GuestNationality": "AE",
        "PaxRooms": [
            {
                "Adults": 1,
                "Children": 0,
                "ChildrenAges": [0]
            }
        ],
        "ResponseTime": 20.0,
        "IsDetailedResponse": True,
        "Filters": {
            "Refundable": True,
            "NoOfRooms": 0,
            "MealType": 0,
            "OrderBy": 0,
            "StarRating": 0,
            "HotelName": None
        }
    }
    search_results = api_client.search(search_payload)
    save_to_json(search_results, "search_results.json", OUTPUT_DIR)

    print("\nAll tasks completed.")

if __name__ == "__main__":
    main()