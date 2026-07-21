
import os
from dotenv import load_dotenv

# Carregar variables d'entorn
load_dotenv()

NOTION_TOKEN = os.getenv("NOTION_TOKEN")
DATABASE_ID = os.getenv("DATABASE_ID") or "1ef268e527148046a7bcdc6a5d555eb7"

headers = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28"
}

def audit():
    url = f"https://api.notion.com/v1/databases/{DATABASE_ID}/query"
    has_more = True
    next_cursor = None
    all_pages = []

    print("--- INICIANDO AUDITORÍA ---")
    while has_more:
        payload = {"page_size": 100}
        if next_cursor:
            payload["start_cursor"] = next_cursor
        
        response = requests.post(url, headers=headers, json=payload)
        data = response.json()
        all_pages.extend(data.get("results", []))
        has_more = data.get("has_more", False)
        next_cursor = data.get("next_cursor")

    print(f"Total registros obtenidos: {len(all_pages)}")
    
    cases_found = []
    for page in all_pages:
        p_id = page["id"]
        props = page.get("properties", {})
        title_prop = props.get("Títol", {}).get("title", [])
        
        has_mention = False
        mentioned_page_id = None
        plain_text = ""
        
        for part in title_prop:
            plain_text += part.get("plain_text", "")
            if part.get("type") == "mention":
                has_mention = True
                mentioned_page_id = part.get("mention", {}).get("page", {}).get("id")
        
        if has_mention:
            cases_found.append({
                "page_id": p_id,
                "mentioned_page_id": mentioned_page_id,
                "title": plain_text
            })

    print(f"Casos con mención detectados: {len(cases_found)}")
    for c in cases_found:
        print(f"ID: {c['page_id']} | Mención: {c['mentioned_page_id']} | Título: {c['title']}")

if __name__ == '__main__':
    audit()
