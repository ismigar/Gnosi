import sys
from pathlib import Path
sys.path.append(str(Path.cwd()))

from backend.data.management_db import get_mgmt_session
from backend.services.contacts_service import ContactsService
from backend.models.contact import Contact
from backend.models.management import Workspace
import json

def test_deduplication():
    session = get_mgmt_session()
    # Find a workspace
    ws = session.query(Workspace).first()
    if not ws:
        print("No workspace found")
        return
        
    service = ContactsService(session, ws.id)
    
    # 1. Test name search
    test_name = "Duplicat Test"
    existing = service.get_contact_by_name(test_name)
    if existing:
        session.delete(existing)
        session.commit()
        
    service.create_contact({
        "name": test_name,
        "email": "test@example.local",
        "source": "local"
    })
    
    found = service.get_contact_by_name(test_name)
    if found and found.name == test_name:
        print(f"✅ Pass: Found contact by name: {found.name}")
    else:
        print("❌ Fail: Could not find contact by name")

    # 2. Test extended email search
    test_email = "secundari@test.local"
    service.create_contact({
        "name": "User with multiple emails",
        "email": "primary@test.local",
        "emails": [{"address": test_email, "label": "work"}],
        "source": "local"
    })
    
    found_email = service.get_contact_by_email(test_email)
    if found_email and found_email.name == "User with multiple emails":
        print(f"✅ Pass: Found contact by secondary email: {test_email}")
    else:
        print("❌ Fail: Could not find contact by secondary email")

    # Cleanup
    session.delete(found)
    session.delete(found_email)
    session.commit()
    print("Cleanup done.")

if __name__ == "__main__":
    test_deduplication()
