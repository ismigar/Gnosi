import os
import requests
from dotenv import load_dotenv
import pathlib
import sys

# Ruta: monorepo/apps/gnosi/pipeline/skills/n8n/test_connection.py

def load_envs():
    current_dir = pathlib.Path(__file__).parent.absolute()
    project_root = current_dir.parent.parent.parent.parent.parent.parent
    
    env_shared = project_root / ".env.shared"
    env_local = current_dir.parent.parent.parent / ".env"
    
    print(f"Loading shared env from: {env_shared}")
    load_dotenv(env_shared)
    print(f"Loading local env from: {env_local}")
    load_dotenv(env_local)

def check_n8n():
    api_key = os.getenv("N8N_API_KEY")
    base_url = os.getenv("N8N_BASE_URL", "http://localhost:5678/api/v1")
    
    if not api_key:
        print("ERROR: N8N_API_KEY not found.")
        return
        
    print(f"Testing connection to {base_url}...")
    headers = {"X-N8N-API-KEY": api_key}
    
    try:
        response = requests.get(f"{base_url}/workflows", headers=headers, timeout=5)
        if response.status_code == 200:
            print("SUCCESS: Connection established.")
            data = response.json()
            print(f"Found {len(data.get('data', []))} workflows.")
        else:
            print(f"FAILED: Status {response.status_code}")
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    load_envs()
    check_n8n()
