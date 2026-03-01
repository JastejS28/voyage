# import requests
# import logging
# from typing import Dict, Any, Optional

# class FlyScraperAPIClient:
#     def __init__(self, api_key: str, host: str = "fly-scraper.p.rapidapi.com"):
#         """
#         Initializes the Fly Scraper API Client with RapidAPI headers and logging.
#         """
#         self.base_url = f"https://{host}"
        
#         # Session automatically applies these headers to every request
#         self.session = requests.Session()
#         self.session.headers.update({
#             "x-rapidapi-host": host,
#             "x-rapidapi-key": api_key,
#             "Content-Type": "application/json"
#         })
        
#         # Setup Logging
#         self.logger = logging.getLogger("FlyScraperAPI")
#         self.logger.setLevel(logging.INFO)
#         if not self.logger.handlers:
#             handler = logging.StreamHandler()
#             formatter = logging.Formatter('%(asctime)s | %(levelname)s | %(message)s')
#             handler.setFormatter(formatter)
#             self.logger.addHandler(handler)

#     def _make_request(self, method: str, endpoint: str, params: Optional[Dict] = None, payload: Optional[Dict] = None) -> Optional[Dict]:
#         """
#         Internal helper to execute requests, catch errors, and log results.
#         Supports both query parameters (for GET) and JSON payloads (for POST).
#         """
#         url = f"{self.base_url}/{endpoint.lstrip('/')}"
#         self.logger.info(f"Attempting {method} request to route: /{endpoint}")
        
#         try:
#             if method.upper() == "GET":
#                 response = self.session.get(url, params=params)
#             elif method.upper() == "POST":
#                 response = self.session.post(url, json=payload, params=params)
#             else:
#                 self.logger.error(f"Unsupported HTTP method: {method}")
#                 return None

#             # Raise an HTTPError if the HTTP request returned an unsuccessful status code
#             response.raise_for_status()
#             self.logger.info(f"SUCCESS: Route /{endpoint} responded successfully.")
            
#             # The API might occasionally return empty content; handle gracefully
#             if not response.text.strip():
#                 return {}
                
#             return response.json()
            
#         except requests.exceptions.HTTPError as http_err:
#             self.logger.error(f"HTTP ERROR on route /{endpoint}: {http_err} | Response details: {response.text}")
#         except requests.exceptions.RequestException as req_err:
#             self.logger.error(f"CONNECTION ERROR on route /{endpoint}: {req_err}")
#         except ValueError as json_err:
#             self.logger.error(f"JSON DECODE ERROR on route /{endpoint}: {json_err} | Raw output: {response.text}")
#         except Exception as e:
#             self.logger.error(f"UNEXPECTED ERROR on route /{endpoint}: {e}")
            
#         return None

#     # ==========================================
#     # API ROUTE METHODS
#     # ==========================================

#     def autocomplete(self, params: Optional[Dict[str, Any]] = None) -> Optional[Dict]:
#         """
#         Route: GET /v2/flights/autocomplete
#         Pass a dictionary with query params, e.g., {"query": "new"}
#         """
#         return self._make_request("GET", "v2/flights/autocomplete", params=params)

#     def search_one_way(self, params: Dict[str, Any]) -> Optional[Dict]:
#         """
#         Route: GET /v2/flights/search-one-way
#         Expects a dictionary with search params, e.g., {"originSkyId": "MSYA", "destinationSkyId": "PARI"}
#         """
#         return self._make_request("GET", "v2/flights/search-one-way", params=params)

#     def search_multi_city(self, payload: Dict[str, Any]) -> Optional[Dict]:
#         """
#         Route: POST /v2/flights/search-multi-city
#         Expects a full dictionary for the complex JSON body payload.
#         """
#         return self._make_request("POST", "v2/flights/search-multi-city", payload=payload)

#     def search_incomplete(self, params: Optional[Dict[str, Any]] = None) -> Optional[Dict]:
#         """
#         Route: GET /v2/flights/search-incomplete
#         """
#         return self._make_request("GET", "v2/flights/search-incomplete", params=params)


# # ==========================================
# # EXAMPLE USAGE
# # ==========================================
# if __name__ == "__main__":
#     # Ensure you keep your real API key secure in production environments!
#     API_KEY = "66aaca58f8msh86de9f20a718d06p15ec02jsnaa5ed7dc78d3"
    
#     # 1. Initialize the client
#     flight_client = FlyScraperAPIClient(api_key=API_KEY)

#     # 2. Test Autocomplete (GET with query params)
#     print("\n--- Testing Autocomplete ---")
#     autocomplete_params = {"query": "new"}
#     autocomplete_results = flight_client.autocomplete(params=autocomplete_params)

#     # 3. Test Autocomplete (GET without params - matching your second curl)
#     print("\n--- Testing Autocomplete (No Params) ---")
#     autocomplete_empty = flight_client.autocomplete()

#     # 4. Test Search One Way (GET)
#     print("\n--- Testing One-Way Search ---")
#     one_way_params = {
#         "originSkyId": "MSYA",
#         "destinationSkyId": "PARI",
#         "date": "2025-06-13" # Added date as an example of flexibility; adjust as needed per API docs
#     }
#     one_way_results = flight_client.search_one_way(params=one_way_params)

#     # 5. Test Search Multi-City (POST)
#     print("\n--- Testing Multi-City Search ---")
#     multi_city_payload = {
#         "market": "US",
#         "locale": "en-US",
#         "currency": "USD",
#         "adults": 1,
#         "children": 0,
#         "infants": 0,
#         "cabinClass": "economy",
#         "stops": [],
#         "sort": "",
#         "carriersIds": [-32677, -32695],
#         "flights": [
#             {
#                 "originSkyId": "MSYA",
#                 "destinationSkyId": "LOND",
#                 "departDate": "2025-06-13"
#             },
#             {
#                 "originSkyId": "PARI",
#                 "destinationSkyId": "HAN",
#                 "departDate": "2025-06-29"
#             }
#         ]
#     }
#     multi_city_results = flight_client.search_multi_city(payload=multi_city_payload)

#     # 6. Test Search Incomplete (GET)
#     print("\n--- Testing Search Incomplete ---")
#     incomplete_results = flight_client.search_incomplete()

import requests
import logging
from typing import Dict, Any, Optional

class FlyScraperAPIClient:
    def __init__(self, api_key: str, host: str = "fly-scraper.p.rapidapi.com"):
        """
        Initializes the Fly Scraper API Client with RapidAPI headers and logging.
        """
        self.base_url = f"https://{host}"
        
        self.session = requests.Session()
        self.session.headers.update({
            "x-rapidapi-host": host,
            "x-rapidapi-key": api_key,
            "Content-Type": "application/json"
        })
        
        # Setup Logging
        self.logger = logging.getLogger("FlyScraperAPI")
        self.logger.setLevel(logging.INFO)
        if not self.logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter('%(asctime)s | %(levelname)s | %(message)s')
            handler.setFormatter(formatter)
            self.logger.addHandler(handler)

    def _make_request(self, method: str, endpoint: str, params: Optional[Dict] = None, payload: Optional[Dict] = None) -> Optional[Dict]:
        """
        Internal helper to execute requests, catch errors, and log results.
        """
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        self.logger.info(f"Attempting {method} request to route: /{endpoint}")
        
        try:
            if method.upper() == "GET":
                response = self.session.get(url, params=params)
            elif method.upper() == "POST":
                response = self.session.post(url, json=payload, params=params)
            else:
                self.logger.error(f"Unsupported HTTP method: {method}")
                return None

            response.raise_for_status()
            self.logger.info(f"SUCCESS: Route /{endpoint} responded successfully.")
            
            if not response.text.strip():
                return {}
                
            return response.json()
            
        except requests.exceptions.HTTPError as http_err:
            self.logger.error(f"HTTP ERROR on route /{endpoint}: {http_err} | Response details: {response.text}")
        except Exception as e:
            self.logger.error(f"UNEXPECTED ERROR on route /{endpoint}: {e}")
            
        return None

    # ==========================================
    # API ROUTE METHODS (Updated for Strictness)
    # ==========================================

    def autocomplete(self, query: str) -> Optional[Dict]:
        """
        Route: GET /v2/flights/autocomplete
        The 'query' string is REQUIRED (e.g., 'new' or 'london').
        """
        if not query:
            self.logger.error("Autocomplete failed: 'query' parameter cannot be empty.")
            return None
        return self._make_request("GET", "v2/flights/autocomplete", params={"query": query})

    def search_one_way(self, origin_id: str, dest_id: str, date: str, additional_params: Optional[Dict] = None) -> Optional[Dict]:
        """
        Route: GET /v2/flights/search-one-way
        Requires Origin, Destination, and Date (YYYY-MM-DD).
        """
        params = {
            "originSkyId": origin_id,
            "destinationSkyId": dest_id,
            "date": date 
        }
        # Merge any extra optional params (like adults, cabinClass) if provided
        if additional_params:
            params.update(additional_params)
            
        return self._make_request("GET", "v2/flights/search-one-way", params=params)

    def search_multi_city(self, payload: Dict[str, Any]) -> Optional[Dict]:
        """
        Route: POST /v2/flights/search-multi-city
        Requires a complete JSON payload dictionary.
        """
        if "flights" not in payload or not payload["flights"]:
            self.logger.warning("Multi-city payload seems to be missing the 'flights' array.")
            
        return self._make_request("POST", "v2/flights/search-multi-city", payload=payload)

    def search_incomplete(self, session_id: str) -> Optional[Dict]:
        """
        Route: GET /v2/flights/search-incomplete
        REQUIRED: session_id (Usually returned from a one-way or multi-city search response).
        """
        if not session_id:
             self.logger.error("Search Incomplete failed: A 'sessionId' is required to poll for results.")
             return None
             
        return self._make_request("GET", "v2/flights/search-incomplete", params={"sessionId": session_id})


# ==========================================
# EXAMPLE USAGE
# ==========================================
if __name__ == "__main__":
    API_KEY = "66aaca58f8msh86de9f20a718d06p15ec02jsnaa5ed7dc78d3"
    flight_client = FlyScraperAPIClient(api_key=API_KEY)

    # 1. Autocomplete (Properly handled)
    print("\n--- Testing Autocomplete ---")
    results = flight_client.autocomplete(query="new")

    # 2. Search One Way (Mandatory params strictly enforced)
    print("\n--- Testing One-Way Search ---")
  
    one_way = flight_client.search_one_way(origin_id="MSYA", dest_id="PARI", date="2025-06-13")
    
    # 3. Extract Session ID from the "context" object
    session_id = None
    if one_way and "data" in one_way and "context" in one_way["data"]:
        # The API usually stores the session tracking token right here
        context_data = one_way["data"]["context"]
        
        # Safely extract it (handling cases where it might be named slightly differently)
        session_id = context_data.get("sessionId") or context_data.get("session_id")
        
        if session_id:
            print(f"[+] Successfully extracted Session ID: {session_id}")
        else:
            print("[-] Could not find a 'sessionId' inside the 'context' object. Here is what 'context' contains:")
            print(context_data.keys())

    # 4. Search Incomplete (Polling for the rest of the results)
    print("\n--- Testing Search Incomplete ---")
    if session_id:
        incomplete = flight_client.search_incomplete(session_id=session_id)
        if incomplete:
            print("[+] Successfully fetched incomplete search results!")
            # If you are saving it to a file:
            # save_to_json(incomplete, "search_incomplete.json", "flight_api_responses")
    else:
        print("[-] Skipping Search Incomplete: We couldn't extract the sessionId.")