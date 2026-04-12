import requests
import json

try:
    response = requests.get("http://localhost:5002/api/contacts", headers={"X-Workspace-ID": "default"})
    print(f"Status Code: {response.status_code}")
    if response.status_code == 200:
        print(f"Found {len(response.json())} contacts")
        print(json.dumps(response.json()[:1], indent=2))
    else:
        print(f"Error Response: {response.text}")
except Exception as e:
    print(f"Connection Error: {e}")
