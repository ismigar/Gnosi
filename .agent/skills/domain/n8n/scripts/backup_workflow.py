import os
import requests
from dotenv import load_dotenv
import pathlib
import sys
import json
import datetime

# Ruta: monorepo/apps/gnosi/pipeline/sandbox/backup_workflow.py

def load_envs():
    current_dir = pathlib.Path(__file__).parent.absolute()
    project_root = current_dir.parent.parent.parent.parent.parent # Projectes
    
    env_shared = project_root / ".env.shared"
    env_local = current_dir.parent.parent / ".env"
    
    if env_shared.exists():
        load_dotenv(env_shared)
    if env_local.exists():
        load_dotenv(env_local)

def backup_workflow(workflow_id):
    api_key = os.getenv("N8N_API_KEY")
    base_url = os.getenv("N8N_BASE_URL", "http://localhost:5678/api/v1")
    
    if not api_key:
        print("ERROR: N8N_API_KEY no encontrada.")
        sys.exit(1)

    headers = {"X-N8N-API-KEY": api_key}
    
    try:
        url = f"{base_url}/workflows/{workflow_id}"
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code == 200:
            workflow_data = response.json()
            
            # Crear directorio de backups si no existe
            backup_dir = pathlib.Path(__file__).parent.parent / "backups" / "n8n"
            backup_dir.mkdir(parents=True, exist_ok=True)
            
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"{workflow_data['name'].replace(' ', '_')}_{workflow_id}_{timestamp}.json"
            filepath = backup_dir / filename
            
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(workflow_data, f, indent=2, ensure_ascii=False)
                
            print(f"✅ Backup guardado en: {filepath}")
            print(f"Nombre: {workflow_data['name']}")
            return filepath
        else:
            print(f"Error al obtener workflow: {response.status_code} - {response.text}")
            
    except Exception as e:
        print(f"Error de conexión: {str(e)}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python backup_workflow.py <workflow_id>")
        sys.exit(1)
        
    load_envs()
    backup_workflow(sys.argv[1])
