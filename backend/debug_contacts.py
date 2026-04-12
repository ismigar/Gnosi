import sys
from pathlib import Path
sys.path.append(str(Path.cwd()))

from backend.data.management_db import get_mgmt_session
from backend.services.contacts_service import ContactsService
from backend.models.contact import ContactResponse, Contact
import json

def debug():
    session = get_mgmt_session()
    # Find a workspace
    from backend.models.workspace import Workspace
    ws = session.query(Workspace).first()
    if not ws:
        print("No workspace found")
        return
        
    print(f"Using workspace: {ws.id}")
    service = ContactsService(session, ws.id)
    
    contacts = service.list_contacts()
    print(f"Found {len(contacts)} contacts")
    
    for c in contacts:
        print(f"Checking contact: {c.name} (ID: {c.id})")
        try:
            # Manually try to convert to dict and then to Pydantic
            # This mimics what FastAPI does
            res = ContactResponse.from_orm(c)
            print(f"  SUCCESS: {res.name}")
        except Exception as e:
            print(f"  ERROR for {c.name}: {e}")
            # Try to see what exactly is failing
            import traceback
            traceback.print_exc()
            break

if __name__ == "__main__":
    debug()
