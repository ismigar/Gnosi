
import requests
import json
import time
import os

# --- CONFIGURATION (Load from environment variables) ---
NOTION_TOKEN = os.environ.get("NOTION_TOKEN")
DATABASE_ID = os.environ.get("DATABASE_ID", "1ef268e527148046a7bcdc6a5d555eb7")
DOCUMENT_ID = os.environ.get("DOCUMENT_ID", "1ULgZpEwNUQsKXOjV6hEswzcyJ6S1kmcsJjYjUW08WVk")
GOOGLE_TOKEN = os.environ.get("GOOGLE_OAUTH_TOKEN")

if not NOTION_TOKEN or not GOOGLE_TOKEN:
    print("⚠️  MISSING TOKENS! Please set NOTION_TOKEN and GOOGLE_OAUTH_TOKEN in your environment.")
    exit(1)

# Chunking configuration
MAX_INSERT_SIZE = 4500 # Tamaño de bloque para evitar errores de Google Docs

NOTION_HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28"
}

GOOGLE_HEADERS = {
    "Authorization": f"Bearer {GOOGLE_TOKEN}",
    "Content-Type": "application/json"
}

LOG_FILE = "processed_ids.csv"

def get_candidates():
    """Recata TODAS las páginas que existen en la DB (sin filtros como pidió el usuario)"""
    url = f"https://api.notion.com/v1/databases/{DATABASE_ID}/query"
    all_results = []
    has_more = True
    next_cursor = None
    
    # Filtro: NINGUNO para llegar a los 79 items totales
    payload = {
        "page_size": 100
    }
    
    while has_more:
        if next_cursor:
            payload["start_cursor"] = next_cursor
            
        response = requests.post(url, headers=NOTION_HEADERS, json=payload)
        if response.status_code != 200:
            print(f"Error querying Notion: {response.status_code} - {response.text}")
            break
            
        data = response.json()
        all_results.extend(data.get("results", []))
        has_more = data.get("has_more", False)
        next_cursor = data.get("next_cursor")
        
    return all_results

def get_page_content(page_id):
    """Obtiene TODO el contenido de los bloques, manejando paginación de Notion (100+)"""
    text = ""
    has_more = True
    next_cursor = None
    
    while has_more:
        url = f"https://api.notion.com/v1/blocks/{page_id}/children"
        params = {"page_size": 100}
        if next_cursor:
            params["start_cursor"] = next_cursor
            
        response = requests.get(url, headers=NOTION_HEADERS, params=params)
        if response.status_code != 200:
            print(f"   ⚠️ Error obteniendo bloques: {response.status_code}")
            break
            
        data = response.json()
        blocks = data.get("results", [])
        
        for block in blocks:
            b_type = block.get("type")
            if b_type in ["paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item", "quote"]:
                content = block.get(b_type, {}).get("rich_text", [])
                plain_text = "".join([t.get("plain_text", "") for t in content])
                if plain_text:
                    prefix = ""
                    if b_type == "heading_1": prefix = "# "
                    elif b_type == "heading_2": prefix = "## "
                    elif b_type == "heading_3": prefix = "### "
                    elif b_type == "bulleted_list_item": prefix = "- "
                    elif b_type == "numbered_list_item": prefix = "1. "
                    elif b_type == "quote": prefix = "> "
                    text += f"{prefix}{plain_text}\n\n"
        
        has_more = data.get("has_more", False)
        next_cursor = data.get("next_cursor")
        
    return text

def chunk_text(text, size):
    """Divide el texto en trozos respetando los saltos de línea"""
    chunks = []
    while len(text) > 0:
        if len(text) <= size:
            chunks.append(text)
            break
        
        # Buscar el último salto de línea dentro del límite
        cut_index = text.rfind("\n", 0, size)
        if cut_index == -1: # Si no hay saltos, cortar por el tamaño
            cut_index = size
            
        chunks.append(text[:cut_index])
        text = text[cut_index:].lstrip("\n")
    return chunks

def prepend_to_google_doc(full_text):
    """Inserta el texto en Google Docs fragmentado si es muy largo"""
    url = f"https://docs.googleapis.com/v1/documents/{DOCUMENT_ID}:batchUpdate"
    
    # Dividimos en trozos
    chunks = chunk_text(full_text, MAX_INSERT_SIZE)
    
    # Para que el orden sea correcto al PREPENDIR (index 1),
    # debemos insertar los trozos en orden INVERSO (del final al principio).
    for chunk in reversed(chunks):
        payload = {
            "requests": [
                {
                    "insertText": {
                        "location": { "index": 1 },
                        "text": chunk
                    }
                }
            ]
        }
        response = requests.post(url, headers=GOOGLE_HEADERS, json=payload)
        if response.status_code != 200:
            print(f"      ❌ Error trozo GDoc: {response.status_code} - {response.text}")
            return False
        time.sleep(0.2) # Pequeña pausa entre trozos
        
    return True

def mark_as_synced(page_id):
    url = f"https://api.notion.com/v1/pages/{page_id}"
    payload = {
        "properties": {
            "Gems Sync": { "checkbox": True }
        }
    }
    response = requests.patch(url, headers=NOTION_HEADERS, json=payload)
    return response.status_code == 200

def get_date_val(page):
    props = page.get("properties", {})
    if "Data" in props and props["Data"].get("date"):
        return props["Data"]["date"].get("start", "1970-01-01")
    return page.get("created_time", "1970-01-01").split("T")[0]

def get_sort_key(page):
    props = page.get("properties", {})
    # 1. Any (Prioritario)
    year = 0
    if "Any" in props and props["Any"].get("number") is not None:
        year = props["Any"]["number"]
    else:
        # Fallback si no hay Any, usamos el año de la fecha
        date_str = get_date_val(page)
        try:
            year = int(date_str.split('-')[0])
        except:
            year = 1970
    
    # 2. Data (Secundario)
    data = get_date_val(page)
    return (year, data)

def clear_google_doc():
    """Vacía el contenido del documento antes de empezar"""
    print("🧹 Vaciando documento de Google Docs...")
    # Primero obtenemos el final del documento
    url_get = f"https://docs.googleapis.com/v1/documents/{DOCUMENT_ID}"
    resp_get = requests.get(url_get, headers=GOOGLE_HEADERS)
    if resp_get.status_code != 200:
        print(f"   ⚠️ Error leyendo GDoc para vaciar: {resp_get.status_code}")
        return False
        
    end_index = resp_get.json().get("body", {}).get("content", [])[-1].get("endIndex", 1)
    
    if end_index <= 2: # Ya está vacío o casi vacío
        return True
        
    url_update = f"https://docs.googleapis.com/v1/documents/{DOCUMENT_ID}:batchUpdate"
    payload = {
        "requests": [
            {
                "deleteContentRange": {
                    "range": {
                        "startIndex": 1,
                        "endIndex": end_index - 1
                    }
                }
            }
        ]
    }
    response = requests.post(url_update, headers=GOOGLE_HEADERS, json=payload)
    return response.status_code == 200

def main():
    print("🚀 Backfill SEGURO (Sin duplicados + 79 entradas Notion)...")
    
    processed_ids = set()
    if os.path.exists(LOG_FILE):
        with open(LOG_FILE, "r") as f:
            processed_ids = {line.strip() for line in f if line.strip()}
    
    print(f"IDs ya procesados cargados: {len(processed_ids)}")
    
    # Limpiamos el log local para forzar reprocesamiento
    if os.path.exists(LOG_FILE):
        os.remove(LOG_FILE)
    
    if not clear_google_doc():
        print("❌ No se pudo vaciar el documento. Abortando para evitar duplicados.")
        return

    pages = get_candidates()
    if not pages:
        print("No hay entradas en Notion.")
        return
    
    # Ordenamos por (Año, Fecha) de RECIENTE a ANTIGUO.
    # Como insertamos siempre arriba (index 1), el resultado final en el doc
    # será de ANTIGUO (arriba) a RECIENTE (abajo).
    pages.sort(key=get_sort_key, reverse=True)
    
    print(f"Detectadas {len(pages)} entradas totales en Notion.")
    
    # to_process = [p for p in pages if p["id"] not in processed_ids]
    to_process = pages # Procesar TODO sin filtros como pidió el usuario
    print(f"Pendientes reales (TODOS por petición): {len(to_process)}")
    
    for page in to_process:
        p_id = page["id"]
        props = page.get("properties", {})
        
        # Extracción de título robusta (puede ser Mención o Texto)
        title = "Sin Título"
        t_key = "Títol" if "Títol" in props else "Name"
        if t_key in props and props[t_key].get("title"):
             t_data = props[t_key]["title"][0]
             if t_data.get("plain_text"):
                 title = t_data["plain_text"]
        
        date = get_date_val(page)
        
        year = "N/A"
        if "Any" in props and props["Any"].get("number"):
            year = str(props["Any"]["number"])
        else:
            year = date.split('-')[0]

        def get_ms(prop_name):
            if prop_name in props and props[prop_name].get("multi_select"):
                return ", ".join([e["name"] for e in props[prop_name]["multi_select"]])
            return "N/A"

        emotion = get_ms("Emoció/sentiment")
        valor = get_ms("Valor telòsic present")
        ambit = get_ms("Àmbit vital implicat")
        url = page.get('url', "")

        print(f"-> [{date}] {title}...")
        
        body = get_page_content(p_id)
        
        full_text = f"""
---
# {title}
> - **Data:** {date}
> - **Any:** {year}
> - **Estat emocional:** {emotion}
> - **Valor telòsic present:** {valor}
> - **Àmbit vital implicat:** {ambit}
> - **Referència:** {url}

{body}
---
""".strip()

        if prepend_to_google_doc(full_text + "\n\n"):
            # Marcamos en Notion y en nuestro log local
            mark_as_synced(p_id)
            with open(LOG_FILE, "a") as f:
                f.write(f"{p_id}\n")
            print(f"   ✓ OK.")
        else:
            print(f"   ❌ Error upload.")
        
        time.sleep(0.3)
    
    print(f"\n✅ Sincronización finalizada.")

if __name__ == "__main__":
    main()
