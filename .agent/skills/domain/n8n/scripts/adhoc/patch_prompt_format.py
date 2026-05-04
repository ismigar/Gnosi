import os
import requests
from dotenv import load_dotenv
import pathlib
import sys
import re
import json

# Ruta: monorepo/apps/gnosi/pipeline/sandbox/patch_translation_prompt.py

def load_envs():
    current_dir = pathlib.Path(__file__).parent.absolute()
    project_root = current_dir.parent.parent.parent.parent.parent
    env_shared = project_root / ".env.shared"
    env_local = current_dir.parent.parent / ".env"
    
    if env_shared.exists(): load_dotenv(env_shared)
    if env_local.exists(): load_dotenv(env_local)

def patch_workflow(workflow_id):
    api_key = os.getenv("N8N_API_KEY")
    base_url = os.getenv("N8N_BASE_URL", "http://localhost:5678/api/v1")
    
    if not api_key:
        print("ERROR: N8N_API_KEY no encontrada.")
        sys.exit(1)

    headers = {"X-N8N-API-KEY": api_key}
    
    # 1. Obtener Workflow
    try:
        response = requests.get(f"{base_url}/workflows/{workflow_id}", headers=headers)
        if response.status_code != 200:
            print(f"Error al obtener workflow: {response.text}")
            return
        workflow_data = response.json()
    except Exception as e:
        print(f"Error de conexión: {e}")
        return

    # 2. Modificar Prompt (PrepareNotionTranslate)
    target_node_name = "PrepareNotionTranslate"
    target_node = None
    for node in workflow_data.get('nodes', []):
        if node.get('name') == target_node_name:
            target_node = node
            break
            
    if not target_node:
        print(f"ERROR: Nodo '{target_node_name}' no encontrado.")
        return

    js_code = target_node['parameters'].get('jsCode', '')
    pattern = r"const prompt = `[\s\S]*?`;"
    new_prompt = """const prompt = `Ets un traductor expert en assaig i filosofia. 
Tradueix els valors d'aquest JSON del ${sourceName} al ${targetName}.

REQUISITS:
1. Respon ÚNICAMENT amb el JSON net.
2. Manté les CLAUS originals intactes.
3. PRESERVACIÓ DE FORMAT (CRÍTIC):
   - Si el text original té format Markdown (**, _, [], etc.), la traducció HA de mantenir-lo exactament als llocs corresponents.
   - Exemple: "La **casa** és _vermella_" -> "The **house** is _red_".
   - Els enllaços [text](url) han de mantenir la URL intacta.
4. **IMPORTANT: NO tradueixis mai les URLs que hi ha dins dels parèntesis (exemple: [Google](https://google.com) -> la URL es queda igual).**
5. No tradueixis el valor del camp "lang".

OBJECTE A TRADUIR:
${JSON.stringify(toTranslate)}

IMPORTANT: Genera un JSON vàlid.`;"""

    match = re.search(pattern, js_code)
    if not match:
        print("ERROR: Patrón no encontrado.")
        return

    target_node['parameters']['jsCode'] = js_code.replace(match.group(0), new_prompt)
    
    # 3. Filtrar Settings Problemáticos
    current_settings = workflow_data.get('settings', {})
    safe_settings = {}
    
    # Lista blanca de settings permitidos en PUT
    allowed_setting_keys = [
        "executionOrder", 
        "saveDataErrorExecution", 
        "saveDataSuccessExecution", 
        "saveManualExecutions", 
        "saveExecutionProgress", 
        "timezone", 
        "errorWorkflow"
    ]
    
    for k, v in current_settings.items():
        if k in allowed_setting_keys:
            safe_settings[k] = v
            
    # 4. Payload Final
    payload = {
        "nodes": workflow_data.get('nodes', []),
        "connections": workflow_data.get('connections', {}),
        "name": workflow_data.get('name', 'Untitled'),
        "settings": safe_settings
        # active omitido (read-only)
    }
    
    print(f"Enviando payload PUT con settings filtrados: {list(safe_settings.keys())}")

    update_response = requests.put(
        f"{base_url}/workflows/{workflow_id}", 
        headers=headers, 
        json=payload
    )
    
    if update_response.status_code == 200:
        print("✅ SUCCESS: Workflow actualizado correctamente.")
    else:
        print(f"FAILED: {update_response.status_code}")
        print(update_response.text)

if __name__ == "__main__":
    load_envs()
    patch_workflow("P7PTDH3uqldJn62X")
