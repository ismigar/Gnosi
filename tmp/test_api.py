import requests
import json

try:
    res = requests.get('http://localhost:8000/api/config')
    print("Status:", res.status_code)
    print("JSON rebut:")
    print(json.dumps(res.json(), indent=2))
except Exception as e:
    print(f"Error connectant a l'API: {e}")
