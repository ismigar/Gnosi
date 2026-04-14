import os
import requests
from dotenv import load_dotenv
import pathlib
import sys

# Ruta: monorepo/apps/gnosi/pipeline/skills/n8n/list_workflows.py

def load_envs():
    # Ajuste de ruta para profundidad: skills/n8n
    current_dir = pathlib.Path(__file__).parent.absolute()
    # n8n -> skills -> pipeline -> gnosi -> apps -> monorepo -> Projectes (Raíz)
    project_root = current_dir.parent.parent.parent.parent.parent.parent
    
    env_shared = project_root / ".env.shared"
    env_local = current_dir.parent.parent.parent / ".env" # apps/gnosi/.env
    
    if env_shared.exists():
        load_dotenv(env_shared)
    else:
        print(f"WARNING: Shared env not found at {env_shared}", file=sys.stderr)
        
    if env_local.exists():
        load_dotenv(env_local)

def list_workflows():
    api_key = os.getenv("N8N_API_KEY")
    base_url = os.getenv("N8N_BASE_URL", "http://localhost:5678/api/v1")
    
    if not api_key:
        print("ERROR: N8N_API_KEY no encontrada en variables de entorno.")
        sys.exit(1)

    headers = {
        "X-N8N-API-KEY": api_key
    }
    
    try:
        url = f"{base_url}/workflows"
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            workflows = data.get('data', [])
            
            if not workflows:
                print("No se encontraron workflows.")
                return

            print(f"✅ Se encontraron {len(workflows)} workflows:\n")
            print(f"{'ID':<25} | {'ACTIVO':<8} | {'NOMBRE'}")
            print("-" * 80)
            
            for wf in workflows:
                active_icon = "🟢" if wf.get('active', False) else "🔴"
                print(f"{wf['id']:<25} | {active_icon:<8} | {wf['name']}")
                
        else:
            print(f"Error al listar workflows: {response.status_code} - {response.text}")
            
    except Exception as e:
        print(f"Error de conexión: {str(e)}")

if __name__ == "__main__":
    load_envs()
    list_workflows()
