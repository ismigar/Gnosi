import os
import sys
import xml.etree.ElementTree as ET
import feedparser
from datetime import datetime, timedelta, timezone
from bs4 import BeautifulSoup
from groq import Groq
from gtts import gTTS
import time

# Carreguem variables
try:
    from dotenv import load_dotenv
    # Carreguem .env_shared des de l'arrel de projectes
    env_path = os.path.join(os.path.dirname(__file__), '../../../../.env_shared')
    if os.path.exists(env_path):
        load_dotenv(env_path)
except ImportError:
    print("pip install python-dotenv is required to load env vars")

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")

TARGET_TAGS = ["Religió", "ESS", "Actualitat", "News"]

def parse_opml(filepath):
    """Llegeix l'OPML i extreu les URLs dels feeds que pertanyen a les carpetes diana."""
    feeds = []
    try:
        tree = ET.parse(filepath)
        root = tree.getroot()
        for outline in root.findall('.//outline'):
            if 'xmlUrl' not in outline.attrib:
                folder_title = outline.attrib.get('title', outline.attrib.get('text', ''))
                if folder_title in TARGET_TAGS:
                    for sub_outline in outline.findall('./outline'):
                        feed_url = sub_outline.attrib.get('xmlUrl')
                        title = sub_outline.attrib.get('title', sub_outline.attrib.get('text', ''))
                        if feed_url:
                            feeds.append({"title": title, "url": feed_url, "category": folder_title})
    except Exception as e:
        print(f"Error llegint OPML: {e}")
    return feeds

def fetch_rss_24h(feeds):
    """Descarrega i filtra articles publicats en les darreres 24 hores, netejant el HTML."""
    target_time = datetime.now(timezone.utc) - timedelta(hours=24)
    articles = []
    
    for feed in feeds:
        print(f"Llegint feed: {feed['title']} ({feed['url']})")
        try:
            parsed = feedparser.parse(feed['url'])
            for entry in parsed.entries:
                pub_date = None
                if hasattr(entry, 'published_parsed') and entry.published_parsed:
                    pub_date = datetime.fromtimestamp(time.mktime(entry.published_parsed), tz=timezone.utc)
                elif hasattr(entry, 'updated_parsed') and entry.updated_parsed:
                    pub_date = datetime.fromtimestamp(time.mktime(entry.updated_parsed), tz=timezone.utc)
                
                if pub_date and pub_date > target_time:
                    content_raw = entry.get('content', [{'value': entry.get('summary', '')}])[0]['value']
                    soup = BeautifulSoup(content_raw, 'html.parser')
                    text_content = soup.get_text(separator=' ', strip=True)
                    
                    articles.append({
                        "source": feed['title'],
                        "category": feed['category'],
                        "title": entry.title,
                        "content": text_content[:2000] # Limitem per evitar articles excessivament llargs
                    })
        except Exception as e:
            print(f"Error processant el feed {feed['url']}: {e}")
            continue
            
    return articles

def generate_summary(articles):
    """Junta els articles, controla els tokens i fa la petició al model de Groq per a síntesi d'àudio."""
    if not GROQ_API_KEY:
        print("Falta GROQ_API_KEY!")
        return "Error: Falta la clau de l'API de Groq."
        
    if not articles:
        return "Bon dia. No hi ha cap article nou en les últimes 24 hores per a les categories seleccionades. Salutacions."
        
    client = Groq(api_key=GROQ_API_KEY)
    
    prompt = "Ets un assistent editorial d'alt nivell. Resumeix els següents articles per a un oient amb formació en enginyeria i filosofia. No busquis el titular fàcil; cerca la profunditat, la connexió entre temes i les implicacions ètiques. Estructura el resum com un guió de podcast fluid de 10-15 minuts. Llengua: Català.\n\nARTICLES:\n"
    
    for idx, art in enumerate(articles):
        article_text = f"--- Article {idx+1} ---\nFont: {art['source']} (Categoria: {art['category']})\nTítol: {art['title']}\nContingut: {art['content']}\n\n"
        if len(prompt) + len(article_text) > 25000:
            print(f"Límit de tokens aproximat assolit. S'han descartat alguns articles per aquesta iteració.")
            break
        prompt += article_text
        
    print("Trucant a l'API de Groq (Llama-3-70b)... Aquest procés pot tardar uns segons.")
    try:
        chat_completion = client.chat.completions.create(
            messages=[
                {
                    "role": "system",
                    "content": "Ets un assistent de podcast intel·ligent. Escriu exclusivament el text que serà llegit literalment, sense afegir notes, ni meta-comentaris."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            model="llama3-70b-8192",
            temperature=0.7,
        )
        return chat_completion.choices[0].message.content
    except Exception as e:
        print(f"Error a Groq API: {e}")
        return "Error generant el resum a causa del proveïdor LLM."

def text_to_audio(text, filename):
    """Converteix text a àudio utilitzant gTTS en llengua catalana."""
    print(f"Generant àudio amb gTTS, es guardarà com a {filename}...")
    try:
        tts = gTTS(text=text, lang='ca', slow=False)
        tts.save(filename)
        print(f"Podcast desat correctament a: {filename}")
    except Exception as e:
        print(f"Error generant l'àudio TTS: {e}")

def main():
    base_dir = os.path.dirname(__file__)
    opml_path = os.path.join(base_dir, "feeds.opml")
    
    if not os.path.exists(opml_path):
        print(f"El fitxer {opml_path} no existeix. Comprova que l'has exportat des de l'app de RSS.")
        sys.exit(1)
        
    feeds = parse_opml(opml_path)
    print(f"S'han trobat {len(feeds)} feeds de les teves categories.")
    
    articles = fetch_rss_24h(feeds)
    print(f"S'han descarregat {len(articles)} articles únics de les últimes 24 hores.")
    
    summary_text = generate_summary(articles)
    
    # Save script text for review
    txt_filename = os.path.join(base_dir, f"resum_{datetime.now().strftime('%Y_%m_%d')}.txt")
    with open(txt_filename, 'w', encoding='utf-8') as f:
        f.write(summary_text)
        
    # Generate Audio
    audio_filename = os.path.join(base_dir, f"resum_{datetime.now().strftime('%Y_%m_%d')}.mp3")
    text_to_audio(summary_text, audio_filename)

if __name__ == "__main__":
    main()
