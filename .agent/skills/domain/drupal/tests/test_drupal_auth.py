
import requests
import os
from dotenv import load_dotenv
import base64

# Load credential from .env.shared (simulated here for isolation, or load directly)
# In real scenario we would load from file but for purity I'll use the values I just read
# to avoid path complexity issues in the sandbox.

DRUPAL_URL = "https://www.temenosismael.org"
USER = "admin"
PASSWORD = "YT0LTtiJ0KuUF3EUhUsl"

def test_auth():
    print(f"Testing auth for {USER} at {DRUPAL_URL}...")
    
    # Test Basic Auth against an endpoint that requires permission or just check validity
    # JSON:API entry point usually typically public but operations aren't.
    # Let's try to get the user ID of current user using debug endpoint or simple jsonapi
    
    # We will try to read an article or something protected, or just check if we get 403 vs 200
    # But a specialized endpoint like /jsonapi is good
    
    url = f"{DRUPAL_URL}/jsonapi"
    
    auth_str = f"{USER}:{PASSWORD}"
    b64_auth = base64.b64encode(auth_str.encode()).decode()
    
    headers = {
        "Authorization": f"Basic {b64_auth}",
        "Content-Type": "application/vnd.api+json",
        "Accept": "application/vnd.api+json"
    }

    try:
        response = requests.get(url, headers=headers, timeout=10)
        print(f"Status Code: {response.status_code}")
        if response.status_code == 200:
            print("Auth seems OK (Public access or valid user)")
            # Try to see if we are authenticated
            # Often X-Drupal-Cache-Tags can give hints, or checking specific filtering
        else:
            print("Response:", response.text[:200])

        # Test creating a node (simulation) or just checking specific permission
        # Let's try to access a protected resource if known, or just rely on status
        
    except Exception as e:
        print(f"Connection failed: {e}")

if __name__ == "__main__":
    test_auth()
