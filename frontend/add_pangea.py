import json

path = "../pipeline/private_skills/secrets/integrations.json"
try:
    with open(path, "r") as f:
        data = json.load(f)
except Exception:
    data = {}

data.setdefault("calendars", []).append({
    "id": "manual_123",
    "email": "ismigar@pangea.org",
    "username": "ismigar@pangea.org",
    "provider": "manual",
    "server_url": "https://caldav.pangea.org",
    "password": "fakepassword",
    "type": "calendar"
})

data.setdefault("contacts", []).append({
    "id": "manual_124",
    "email": "ismigar@pangea.org",
    "username": "ismigar@pangea.org",
    "provider": "manual",
    "server_url": "https://carddav.pangea.org",
    "password": "fakepassword",
    "type": "contacts"
})

with open(path, "w") as f:
    json.dump(data, f, indent=4)
