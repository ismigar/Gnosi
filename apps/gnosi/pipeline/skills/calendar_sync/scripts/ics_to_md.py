import os
import requests
import re
import yaml
from pathlib import Path
from datetime import datetime
from icalendar import Calendar

from dotenv import load_dotenv

# Load environment and paths
import sys
# Add project root to sys.path to allow importing from backend.config
PROJECT_ROOT = Path(__file__).resolve().parents[4]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# Now we can import the unified config
from backend.config.paths_config import get_paths

paths = get_paths()
VAULT_PATH = paths["VAULT"]

CALENDAR_PATH = VAULT_PATH / "Calendar" / "External"

CALENDAR_PATH.mkdir(parents=True, exist_ok=True)

def safe_filename(name: str) -> str:
    safe = re.sub(r'[<>:"/\\|?*]', '_', name)
    return safe[:100].strip() or "Event"

def fetch_external_calendars():
    """Fetches defined external calendars and generates markdown representations."""
    # Cleanup old files to avoid duplicates from previous versions or renamed sources
    if CALENDAR_PATH.exists():
        for f in CALENDAR_PATH.glob("*.md"):
            try:
                f.unlink()
            except Exception:
                pass
    
    for feed_url in EXTERNAL_CALENDARS:
        feed_url = feed_url.strip()
        if not feed_url:
            continue
            
        print(f"[*] Fetching calendar from {feed_url}")
        try:
            response = requests.get(feed_url, timeout=10)
            response.raise_for_status()
            
            cal = Calendar.from_ical(response.content)
            
            for component in cal.walk():
                if component.name == "VEVENT":
                    summary = str(component.get('summary', 'Sense títol'))
                    description = str(component.get('description', ''))
                    
                    dtstart = component.get('dtstart')
                    dtend = component.get('dtend')
                    
                    if not dtstart:
                        continue
                        
                    start_date = dtstart.dt
                    end_date = dtend.dt if dtend else start_date
                    
                    # Convert to ISO format handling both date and datetime
                    if isinstance(start_date, datetime):
                        start_iso = start_date.isoformat()
                    else:
                        start_iso = datetime.combine(start_date, datetime.min.time()).isoformat()
                        
                    if isinstance(end_date, datetime):
                        end_iso = end_date.isoformat()
                    else:
                        end_iso = datetime.combine(end_date, datetime.max.time()).isoformat()
                        
                    uid = str(component.get('uid', ''))
                    
                    # Store as note
                    frontmatter = {
                        "title": summary,
                        "type": "event",
                        "readonly": True,
                        "source": feed_url,
                        "uid": uid,
                        "date": start_iso,
                        "end_date": end_iso,
                        "created_time": datetime.now().isoformat()
                    }
                    
                    filename = safe_filename(f"{summary} - {start_date.strftime('%Y%m%d')}")
                    filepath = CALENDAR_PATH / f"{filename}.md"
                    
                    # Simple duplicate handling: We assume UID is unique, but if it's the 
                    # exact same file path, we just overwrite it to keep it synced.
                    
                    content = f"---\n{yaml.dump(frontmatter, allow_unicode=True, default_flow_style=False)}---\n\n"
                    content += f"# {summary}\n\n"
                    content += "---\n\n"
                    if description:
                        content += description
                        
                    filepath.write_text(content, encoding="utf-8")
                    print(f"[+] Saved event: {filepath.name}")
        except Exception as e:
            print(f"[-] Failed to process calendar {feed_url}: {e}")

def fetch_google_calendars():
    """Fetches events from OAuth-linked Google Calendars using integrations.json."""
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    import json
    from datetime import timedelta
    
    integrations_file = base_dir / "pipeline" / "private_skills" / "secrets" / "integrations.json"
    if not integrations_file.exists():
        print("[!] No integrations.json found, skipping Google Calendars.")
        return

    try:
        data = json.loads(integrations_file.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[-] Failed to read integrations.json: {e}")
        return

    calendars = data.get("calendars", [])
    for cal in calendars:
        if cal.get("provider") == "google" and cal.get("auth_type") == "oauth2":
            email = cal.get("email", cal.get("username", "unknown"))
            print(f"[*] Fetching Google Calendar for {email}")
            try:
                creds_dict = {
                    "token": cal.get("token"),
                    "refresh_token": cal.get("refresh_token"),
                    "token_uri": cal.get("token_uri", "https://oauth2.googleapis.com/token"),
                    "client_id": cal.get("client_id"),
                    "client_secret": cal.get("client_secret")
                }
                creds = Credentials(**creds_dict)
                service = build('calendar', 'v3', credentials=creds)
                
                # Fetch events from 1 month ago onwards
                time_min = (datetime.utcnow() - timedelta(days=30)).isoformat() + 'Z'
                
                # Fetch all calendars
                calendars_result = service.calendarList().list().execute()
                calendar_items = calendars_result.get('items', [])
                
                for cal_item in calendar_items:
                    calendar_id = cal_item.get('id')
                    calendar_name = cal_item.get('summary', 'Unknown')
                    
                    print(f"  [*] Checking Google Calendar: {calendar_name} ({calendar_id})")
                    try:
                        events_result = service.events().list(
                            calendarId=calendar_id, timeMin=time_min,
                            maxResults=200, singleEvents=True,
                            orderBy='startTime'
                        ).execute()
                        events = events_result.get('items', [])

                        for event in events:
                            summary = event.get('summary', 'Sense títol')
                            description = event.get('description', '')
                            # Sometimes events don't have start/end depending on visibility
                            if 'start' not in event or 'end' not in event: continue
                            start = event['start'].get('dateTime', event['start'].get('date'))
                            end = event['end'].get('dateTime', event['end'].get('date'))
                            uid = event.get('id', '')
                            if not uid: continue
                            
                            # Google event colors mapping
                            GOOGLE_COLORS = {
                                "1": "#7986cb", "2": "#33b679", "3": "#8e24aa",
                                "4": "#e67c73", "5": "#f6bf26", "6": "#f4511e",
                                "7": "#039be5", "8": "#616161", "9": "#3f51b5",
                                "10": "#0b8043", "11": "#d50000"
                            }
                            # Combine calendar color and event color
                            color_id = event.get('colorId')
                            event_color = GOOGLE_COLORS.get(color_id) if color_id else cal_item.get('backgroundColor')
                            
                            # Clean source name: avoid "email - email"
                            if calendar_name.lower() == email.lower():
                                source = email
                            else:
                                source = f"{email} - {calendar_name}"

                            # Store as note
                            frontmatter = {
                                "title": summary,
                                "type": "event",
                                "readonly": False, # Make editable
                                "source": source,
                                "uid": f"{calendar_id}_{uid}",
                                "date": start,
                                "end_date": end,
                                "created_time": datetime.now().isoformat()
                            }
                            if event_color:
                                frontmatter["color"] = event_color
                                
                            filename = safe_filename(f"{summary} - {start[:10]}")
                            # append something to avoid overriding events from different calendars with same title/date
                            filepath = CALENDAR_PATH / f"{filename}_{uid[-8:]}.md"
                            
                            content = f"---\n{yaml.dump(frontmatter, allow_unicode=True, default_flow_style=False)}---\n\n"
                            if description:
                                content += description
                                
                            filepath.write_text(content, encoding="utf-8")
                            print(f"    [+] Saved Google event: {filepath.name}")
                    except Exception as e:
                        print(f"    [-] Failed to sync component of Google Calendar {calendar_name}: {e}")
                    
            except Exception as e:
                print(f"[-] Failed to sync Google Calendar for {email}: {e}")

if __name__ == "__main__":
    fetch_external_calendars()
    fetch_google_calendars()
