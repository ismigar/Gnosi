
import requests
import json
import base64

# Config from .env.shared (simulated)
DRUPAL_URL = "https://www.temenosismael.org"
USER = "admin"
PASSWORD = "YT0LTtiJ0KuUF3EUhUsl"
ENDPOINT = "/custom/node-helper/update"

def test_endpoint():
    url = f"{DRUPAL_URL}{ENDPOINT}"
    auth_str = f"{USER}:{PASSWORD}"
    b64_auth = base64.b64encode(auth_str.encode()).decode()
    
    headers = {
        "Authorization": f"Basic {b64_auth}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }

    # Payload simulando update de nodo (ejemplo dummy)
    payload = {
        "nid": "1", # Asumimos existe nodo 1, o fallará con 404 pero auth pass
        "title": "Test Update via Script"
    }

    print(f"Testing custom endpoint: {url}")
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=10)
        print(f"Status Code: {response.status_code}")
        print("Response Body:", response.text[:300])
        
        if response.status_code == 405:
            print("❌ Method Not Allowed. Check routing.yml methods.")
        elif response.status_code == 403:
            print("❌ Access Denied. User lacks 'bypass content access control'?")
        elif response.status_code == 404:
            print("❌ Endpoint Not Found. Check routing path or clean cache.")

    except Exception as e:
        print(f"Connection error: {e}")

if __name__ == "__main__":
    test_endpoint()
