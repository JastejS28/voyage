import requests
import logging
from typing import Dict, Any, Optional

class TBOHotelAPIClient:
    def __init__(self, base_url: str, username: str, password: str):
        """
        Initializes the TBO Hotel API Client with authentication and logging.
        """
        self.base_url = base_url.rstrip('/')
        
        # Session handles connection pooling and persistent Basic Auth
        self.session = requests.Session()
        self.session.auth = (username, password)
        
        # Setup Logging
        self.logger = logging.getLogger("TBOHotelAPI")
        self.logger.setLevel(logging.INFO)
        if not self.logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter('%(asctime)s | %(levelname)s | %(message)s')
            handler.setFormatter(formatter)
            self.logger.addHandler(handler)

    def _make_request(self, method: str, endpoint: str, payload: Optional[Dict] = None) -> Optional[Dict]:
        """
        Internal helper to execute requests, catch errors, and log results.
        """
        url = f"{self.base_url}/{endpoint}"
        self.logger.info(f"Attempting {method} request to route: /{endpoint}")
        
        try:
            if method.upper() == "GET":
                response = self.session.get(url)
            elif method.upper() == "POST":
                response = self.session.post(url, json=payload)
            else:
                self.logger.error(f"Unsupported HTTP method: {method}")
                return None

            # Raise an HTTPError if the HTTP request returned an unsuccessful status code
            response.raise_for_status()
            self.logger.info(f"SUCCESS: Route /{endpoint} responded successfully.")
            return response.json()
            
        except requests.exceptions.HTTPError as http_err:
            self.logger.error(f"HTTP ERROR on route /{endpoint}: {http_err} | Response details: {response.text}")
        except requests.exceptions.RequestException as req_err:
            self.logger.error(f"CONNECTION ERROR on route /{endpoint}: {req_err}")
        except ValueError as json_err:
            self.logger.error(f"JSON DECODE ERROR on route /{endpoint}: {json_err} | Raw output: {response.text}")
        except Exception as e:
            self.logger.error(f"UNEXPECTED ERROR on route /{endpoint}: {e}")
            
        return None

    # ==========================================
    # API ROUTE METHODS
    # ==========================================

    def search(self, payload: Dict[str, Any]) -> Optional[Dict]:
        """
        Route: /search
        Expects a fully customized dictionary for the search criteria.
        """
        return self._make_request("POST", "search", payload)

    def get_country_list(self) -> Optional[Dict]:
        """
        Route: /CountryList
        """
        return self._make_request("GET", "CountryList")

    def get_city_list(self, country_code: str) -> Optional[Dict]:
        """
        Route: /CityList
        """
        payload = {"CountryCode": country_code}
        return self._make_request("POST", "CityList", payload)

    def get_hotel_code_list(self, city_code: str, is_detailed_response: bool = True) -> Optional[Dict]:
        """
        Route: /TBOHotelCodeList
        """
        payload = {
            "CityCode": city_code,
            "IsDetailedResponse": str(is_detailed_response).lower() # API expects string "true"/"false" based on Postman
        }
        return self._make_request("POST", "TBOHotelCodeList", payload)

    def get_hotel_details(self, hotel_codes: str, language: str = "EN") -> Optional[Dict]:
        """
        Route: /Hoteldetails
        hotel_codes should be a comma-separated string of codes.
        """
        payload = {
            "Hotelcodes": hotel_codes,
            "Language": language
        }
        return self._make_request("POST", "Hoteldetails", payload)


# ==========================================
# EXAMPLE USAGE
# ==========================================
if __name__ == "__main__":
    BASE_URL = "http://api.tbotechnology.in/TBOHolidays_HotelAPI"
    USERNAME = "hackathontest"
    PASSWORD = "Hac@98147521"

    # 1. Initialize the client
    api_client = TBOHotelAPIClient(BASE_URL, USERNAME, PASSWORD)

    # 2. Test Country List (GET)
    print("\n--- Fetching Country List ---")
    countries = api_client.get_country_list()
    # print(countries) 

    # 3. Test City List (POST)
    print("\n--- Fetching City List ---")
    cities = api_client.get_city_list(country_code="MV")

    # 4. Test Hotel Code List (POST)
    print("\n--- Fetching Hotel Codes ---")
    hotel_codes = api_client.get_hotel_code_list(city_code="130543")

    # 5. Test Hotel Details (POST)
    print("\n--- Fetching Hotel Details ---")
    hotel_details = api_client.get_hotel_details(hotel_codes="376565,1345318,1345320")

    # 6. Test Search (POST) with full flexibility
    print("\n--- Executing Search ---")
    search_payload = {
        "CheckIn": "2025-11-20",
        "CheckOut": "2025-11-24",
        "HotelCodes": "376565,1345318,1345320",
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