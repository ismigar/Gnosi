import requests
import json

def test_chat():
    url = "http://localhost:5002/api/chat"
    payload = {
        "message": "Hola, qui ets?",
        "agent_id": "gnosy",
        "session_id": "test_session",
        "history": []
    }
    
    print(f"Testing chat endpoint: {url}")
    try:
        with requests.post(url, json=payload, stream=True) as response:
            if response.status_code != 200:
                print(f"Error: {response.status_code}")
                print(response.text)
                return

            print("Streaming response:")
            for line in response.iter_lines():
                if line:
                    data = json.loads(line.decode('utf-8'))
                    print(f"Update: {data}")
    except Exception as e:
        print(f"Request failed: {e}")

if __name__ == "__main__":
    test_chat()
