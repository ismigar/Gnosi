import os
import json
import requests
from dotenv import load_dotenv
from pathlib import Path
import yaml
from datetime import datetime
import urllib.parse
from time import sleep

# Load environment
ENV_SHARED_PATH = Path('/Users/ismaelgarciafernandez/Projectes/.env_shared')
load_dotenv.env_shared_PATH)

TOKEN = os.getenv('NOTION_TOKEN')
VAULT_ROOT = os.getenv('gnosi_VAULT_PATH') or '/Users/ismaelgarciafernandez/Projectes/monorepo/apps/gnosi/vault'
VAULT_PATH = Path(VAULT_ROOT)
ASSETS_PATH = VAULT_PATH / "Assets"
ASSETS_PATH.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json"
}

DATABASE_ID = "1ef268e527148046a7bcdc6a5d555eb7" # Bitacora

def get_safe_filename(title: str) -> str:
    safe_title = "".join([c for c in title if c.isalnum() or c in [' ', '-', '_']]).strip()
    return f"{safe_title}" if safe_title else "Untitled"

def download_asset(url: str, original_filename: str) -> str:
    if not url: return ""
    ext = os.path.splitext(urllib.parse.urlparse(url).path)[1]
    if not ext: ext = ".png"
    # Clean query params from extension if any
    if '?' in ext: ext = ext.split('?')[0]
    
    safe_original = get_safe_filename(original_filename)
    new_filename = f"{safe_original}_{int(datetime.now().timestamp() * 1000)}{ext}"
    target_path = ASSETS_PATH / new_filename
    
    try:
        r = requests.get(url, stream=True)
        if r.status_code == 200:
            with open(target_path, 'wb') as f:
                for chunk in r.iter_content(1024):
                    f.write(chunk)
            # Retornem ruta relativa des de la carpeta de la base de dades
            # Les bases de dades van en subcarpetes, per tant: ../Assets/file
            return f"../Assets/{new_filename}"
    except Exception as e:
        print(f"      [!] Error descarregant imatge: {e}")
    return ""

def extract_flat_properties(props: dict) -> dict:
    frontmatter = {}
    title_key = None
    
    for key, value in props.items():
        prop_type = value.get('type')
        if not prop_type: continue
        
        # Normalitzem el nom de la propietat a minúscules per al YAML
        fmt_key = key.lower().replace(" ", "_")
        
        if prop_type == 'title':
            title_parts = value.get('title', [])
            extracted = "".join([t.get('plain_text', '') for t in title_parts])
            frontmatter['title'] = extracted
            title_key = extracted
            
        elif prop_type in ['status', 'select']:
            data = value.get(prop_type)
            if data:
                frontmatter[fmt_key] = data.get('name')
                
        elif prop_type == 'multi_select':
            options = value.get('multi_select', [])
            if options:
                frontmatter[fmt_key] = [opt['name'] for opt in options]
                
        elif prop_type == 'date':
            date_data = value.get('date')
            if date_data:
                frontmatter[fmt_key] = date_data.get('start')
                
        elif prop_type == 'url':
            url_data = value.get('url')
            if url_data:
                frontmatter[fmt_key] = url_data
                
        elif prop_type == 'checkbox':
            frontmatter[fmt_key] = value.get('checkbox', False)
            
        elif prop_type == 'number':
            num = value.get('number')
            if num is not None:
                frontmatter[fmt_key] = num
                
        elif prop_type == 'created_time':
            frontmatter['created_time'] = value.get('created_time')
            
        elif prop_type == 'last_edited_time':
            frontmatter['last_edited_time'] = value.get('last_edited_time')
            
        elif prop_type == 'rich_text':
            rich_texts = value.get('rich_text', [])
            extracted = "".join([t.get('plain_text', '') for t in rich_texts])
            frontmatter[fmt_key] = extracted
            
        elif prop_type == 'files':
            files = value.get('files', [])
            file_urls = []
            for f in files:
                f_type = f.get('type')
                url = f.get('file', {}).get('url') if f_type == 'file' else f.get('external', {}).get('url')
                if url:
                    # Descarreguem també els fitxers de les propietats "Files"
                    name = f.get('name', 'file')
                    local_path = download_asset(url, name)
                    file_urls.append(local_path if local_path else url)
            if file_urls:
                frontmatter[fmt_key] = file_urls
                
    if not title_key:
         frontmatter['title'] = 'Untitled'
         title_key = 'Untitled'
         
    return frontmatter, title_key

def convert_rich_text(rich_text_array: list) -> str:
    text = ""
    for rt in rich_text_array:
        content = rt.get('plain_text', '')
        annots = rt.get('annotations', {})
        href = rt.get('href')
        if annots.get('bold'): content = f"**{content}**"
        if annots.get('italic'): content = f"*{content}*"
        if annots.get('strikethrough'): content = f"~~{content}~~"
        # Notion uses code for inline code
        if annots.get('code'): content = f"`{content}`"
        if href: content = f"[{content}]({href})"
        text += content
    return text

def convert_block_to_md(block: dict) -> str:
    b_type = block.get('type')
    if not b_type: return ""
    b_data = block.get(b_type, {})
    
    if b_type == 'paragraph':
        return convert_rich_text(b_data.get('rich_text', [])) + "\n\n"
    elif b_type in ['heading_1', 'heading_2', 'heading_3']:
        level = b_type.split('_')[1]
        prefix = "#" * int(level)
        return f"{prefix} {convert_rich_text(b_data.get('rich_text', []))}\n\n"
    elif b_type == 'bulleted_list_item':
        return f"- {convert_rich_text(b_data.get('rich_text', []))}\n"
    elif b_type == 'numbered_list_item':
        return f"1. {convert_rich_text(b_data.get('rich_text', []))}\n"
    elif b_type == 'to_do':
        checked = "x" if b_data.get('checked') else " "
        return f"- [{checked}] {convert_rich_text(b_data.get('rich_text', []))}\n"
    elif b_type == 'quote':
        return f"> {convert_rich_text(b_data.get('rich_text', []))}\n\n"
    elif b_type == 'code':
        lang = b_data.get('language', '')
        # Rich text blocks within code blocks are just segments of code
        code_text = "".join([t.get('plain_text', '') for t in b_data.get('rich_text', [])])
        return f"```{lang}\n{code_text}\n```\n\n"
    elif b_type == 'divider':
        return "---\n\n"
    elif b_type == 'image':
        img_type = b_data.get('type')
        url = b_data.get('file', {}).get('url') if img_type == 'file' else b_data.get('external', {}).get('url')
        if url:
            # We download the image to avoid expiration
            caption = convert_rich_text(b_data.get('caption', [])) or "Imatge Notion"
            original_url = urllib.parse.urlparse(url).path
            original_name = os.path.basename(original_url) or "notion_image"
            local_path = download_asset(url, original_name)
            if local_path: return f"![{caption}]({local_path})\n\n"
            else: return f"![{caption}]({url})\n\n"
    return ""

def fetch_blocks(block_id: str) -> list:
    results = []
    has_more = True
    next_cursor = None
    
    while has_more:
        url = f"https://api.notion.com/v1/blocks/{block_id}/children?page_size=100"
        if next_cursor:
            url += f"&start_cursor={next_cursor}"
        
        res = requests.get(url, headers=HEADERS)
        if res.status_code == 200:
            data = res.json()
            results.extend(data.get('results', []))
            has_more = data.get('has_more', False)
            next_cursor = data.get('next_cursor')
        else:
            print(f"      [!] Error fetching blocks: {res.text}")
            break
            
    return results

def migrate_bitacora():
    print(f"🚀 Iniciant importació de Bitacora...")
    
    target_folder = VAULT_PATH / "Bitacora"
    target_folder.mkdir(parents=True, exist_ok=True)
    
    has_more = True
    next_cursor = None
    count = 0
    
    while has_more:
        payload = {"page_size": 100}
        if next_cursor:
            payload["start_cursor"] = next_cursor
            
        res = requests.post(f"https://api.notion.com/v1/databases/{DATABASE_ID}/query", headers=HEADERS, json=payload)
        
        if res.status_code != 200:
            print(f"❌ Error Notion API: {res.text}")
            break
            
        data = res.json()
        pages = data.get('results', [])
        has_more = data.get('has_more', False)
        next_cursor = data.get('next_cursor')
        
        for page in pages:
            page_id = page['id']
            props = page.get('properties', {})
            
            frontmatter, title_key = extract_flat_properties(props)
            frontmatter['notion_id'] = page_id
            
            print(f"  [{count+1}] Important: '{title_key}'")
            
            # Fetch content
            blocks = fetch_blocks(page_id)
            md_content = f"---\n{yaml.dump(frontmatter, allow_unicode=True, default_flow_style=False)}---\n\n"
            
            for block in blocks:
                md_content += convert_block_to_md(block)
                
            filename = get_safe_filename(title_key) + ".md"
            # Si el fitxer ja existeix, hi afegim un prefix per no sobreescriure (o podem sobreescriure si volem sync net)
            filepath = target_folder / filename
            
            try:
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(md_content)
            except Exception as e:
                print(f"      ❌ Error writing {filename}: {e}")
                
            count += 1
            sleep(0.35)
            
    print(f"✅ Importació completada. Total: {count} entrades.")

if __name__ == "__main__":
    if not TOKEN:
        print("❌ NOTION_TOKEN no trobat a .env_shared")
    else:
        migrate_bitacora()
