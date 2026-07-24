import os
import sys
import xml.etree.ElementTree as ET
import feedparser
from datetime import datetime, timedelta, timezone
from bs4 import BeautifulSoup
from groq import Groq
from gtts import gTTS
import time

# Load variables
try:
    from dotenv import load_dotenv
    # Load .env_shared from the projects root
    env_path = os.path.join(os.path.dirname(__file__), '../../../../.env_shared')
    if os.path.exists(env_path):
        load_dotenv(env_path)
except ImportError:
    print("pip install python-dotenv is required to load env vars")

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")

TARGET_TAGS = ["Religió", "ESS", "Actualitat", "News"]

def parse_opml(filepath):
    """Reads the OPML and extracts the feed URLs that belong to the target folders."""
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
        print(f"Error reading OPML: {e}")
    return feeds

def fetch_rss_24h(feeds):
    """Downloads and filters articles published in the last 24 hours, cleaning the HTML."""
    target_time = datetime.now(timezone.utc) - timedelta(hours=24)
    articles = []
    
    for feed in feeds:
        print(f"Reading feed: {feed['title']} ({feed['url']})")
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
                        "content": text_content[:2000] # We limit this to avoid excessively long articles
                    })
        except Exception as e:
            print(f"Error processing feed {feed['url']}: {e}")
            continue
            
    return articles

def generate_summary(articles):
    """Joins the articles, manages the tokens, and makes the request to the Groq model for audio synthesis."""
    if not GROQ_API_KEY:
        print("GROQ_API_KEY is missing!")
        return "Error: the Groq API key is missing."
        
    if not articles:
        return "Hello. There are no new articles from the last 24 hours in the selected categories."
        
    client = Groq(api_key=GROQ_API_KEY)
    
    prompt = "You are a senior editorial assistant. Summarize the following articles for a listener with a background in engineering and philosophy. Avoid shallow headlines; focus on depth, connections between topics, and ethical implications. Structure the summary as a fluid 10–15 minute podcast script. Language: English.\n\nARTICLES:\n"
    
    for idx, art in enumerate(articles):
        article_text = f"--- Article {idx+1} ---\nSource: {art['source']} (Category: {art['category']})\nTitle: {art['title']}\nContent: {art['content']}\n\n"
        if len(prompt) + len(article_text) > 25000:
            print("Approximate token limit reached. Some articles were skipped for this run.")
            break
        prompt += article_text
        
    print("Calling the Groq API (Llama-3-70b)... This may take a few seconds.")
    try:
        chat_completion = client.chat.completions.create(
            messages=[
                {
                    "role": "system",
                    "content": "You are an intelligent podcast assistant. Write only the text that will be read aloud, without notes or meta-commentary."
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
        print(f"Groq API error: {e}")
        return "The summary could not be generated because of an LLM provider error."

def text_to_audio(text, filename):
    """Converts English text to audio using gTTS."""
    print(f"Generating audio with gTTS; it will be saved as {filename}...")
    try:
        tts = gTTS(text=text, lang='en', slow=False)
        tts.save(filename)
        print(f"Podcast saved successfully to: {filename}")
    except Exception as e:
        print(f"Error generating TTS audio: {e}")

def main():
    base_dir = os.path.dirname(__file__)
    opml_path = os.path.join(base_dir, "feeds.opml")
    
    if not os.path.exists(opml_path):
        print(f"{opml_path} does not exist. Check that you exported it from the RSS app.")
        sys.exit(1)
        
    feeds = parse_opml(opml_path)
    print(f"Found {len(feeds)} feeds in the selected categories.")
    
    articles = fetch_rss_24h(feeds)
    print(f"Downloaded {len(articles)} unique articles from the last 24 hours.")
    
    summary_text = generate_summary(articles)
    
    # Save script text for review
    txt_filename = os.path.join(base_dir, f"summary_{datetime.now().strftime('%Y_%m_%d')}.txt")
    with open(txt_filename, 'w', encoding='utf-8') as f:
        f.write(summary_text)
        
    # Generate Audio
    audio_filename = os.path.join(base_dir, f"summary_{datetime.now().strftime('%Y_%m_%d')}.mp3")
    text_to_audio(summary_text, audio_filename)

if __name__ == "__main__":
    main()
