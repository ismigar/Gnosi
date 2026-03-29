
import requests
import json
import time

# --- CONFIGURATION (COMPLETAR ESTOS CAMPOS) ---
NOTION_TOKEN = "PEGA_AQUÍ_TU_NOTION_INTEGRATION_TOKEN"
DATABASE_ID = "1ef268e527148046a7bcdc6a5d555eb7"
GOOGLE_DOC_ID = "1ULgZpEwNUQsKXOjV6hEswzcyJ6S1kmcsJjYjUW08WVk"
# Necesitarás un Access Token de Google (OAuth o Service Account)
GOOGLE_ACCESS_TOKEN = "PEGA_AQUÍ_TU_GOOGLE_ACCESS_TOKEN"

NOTION_HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28"
}

GOOGLE_HEADERS = {
    "Authorization": f"Bearer {GOOGLE_ACCESS_TOKEN}",
    "Content-Type": "application/json"
}

def get_candidates():
    url = f"https://api.notion.com/v1/databases/{DATABASE_ID}/query"
    payload = {
        "filter": {
            "and": [
                { "property": "Estat", "status": { "equals": "Tancat" } },
                { "property": "Gems Sync", "checkbox": { "equals": False } }
            ]
        }
    }
    response = requests.post(url, headers=NOTION_HEADERS, json=payload)
    if response.status_code != 200:
        print(f"Error querying Notion: {response.text}")
        return []
    return response.json().get("results", [])

def get_page_content(page_id):
    url = f"https://api.notion.com/v1/blocks/{page_id}/children"
    response = requests.get(url, headers=NOTION_HEADERS)
    if response.status_code != 200:
        return ""
    
    blocks = response.json().get("results", [])
    text = ""
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
    return text

def append_to_google_doc(text):
    url = f"https://docs.googleapis.com/v1/documents/{GOOGLE_DOC_ID}:batchUpdate"
    # Insertamos al principio (index 1) para que sea como el n8n
    payload = {
        "requests": [
            {
                "insertText": {
                    "location": { "index": 1 },
                    "text": text
                }
            }
        ]
    }
    response = requests.post(url, headers=GOOGLE_HEADERS, json=payload)
    if response.status_code != 200:
        print(f"Error updating Google Doc: {response.text}")
        return False
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

def run_backfill():
    pages = get_candidates()
    print(f"Encontradas {len(pages)} páginas pendientes.")
    
    for page in pages:
        p_id = page["id"]
        props = page.get("properties", {})
        
        # Extraer Metadata V3.1 logic
        title = "Sin Título"
        if "Name" in props and props["Name"].get("title"):
            title = props["Name"]["title"][0]["plain_text"]
        elif "Títol" in props and props["Títol"].get("title"):
            title = props["Títol"]["title"][0]["plain_text"]
            
        date = page.get("created_time", "").split("T")[0]
        if "Date" in props and props["Date"].get("date"):
            date = props["Date"]["date"]["start"]
            
        print(f"Procesando: [{date}] {title}...")
        
        content = get_page_content(p_id)
        header = f"\n## [{date}] {title}\n**Link**: {page.get('url')}\n\n"
        full_text = header + content + "\n---\n"
        
        if append_to_google_doc(full_text):
            if mark_as_synced(p_id):
                print(f"¡Sincronizado! {title}")
            else:
                print(f"Error al marcar como sincronizado: {title}")
        
        time.sleep(1) # Rate limit protection

if __name__ == "__main__":
    run_backfill()
