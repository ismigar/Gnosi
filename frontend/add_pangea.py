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

data.setdefault("mail_accounts", []).append({
    "id": "mail_ismigar@pangea.org",
    "email": "ismigar@pangea.org",
    "provider": "manual",
    "imap_host": "mail.pangea.org",
    "imap_port": "993",
    "imap_user": "ismigar@pangea.org",
    "imap_password": "fakepassword",
    "imap_encryption": "ssl",
    "smtp_host": "smtp.pangea.org",
    "smtp_port": "465",
    "smtp_user": "ismigar@pangea.org",
    "smtp_password": "fakepassword",
    "smtp_encryption": "ssl",
    "type": "mail"
})

with open(path, "w") as f:
    json.dump(data, f, indent=4)
