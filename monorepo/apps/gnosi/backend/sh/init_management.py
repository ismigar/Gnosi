import sys
from pathlib import Path

# Add the backend to the path so we can import the models
_this_file = Path(__file__).resolve()
PROJECT_ROOT = _this_file.parents[2]
sys.path.append(str(PROJECT_ROOT))

from backend.data.management_db import Base, get_mgmt_session, _get_or_init_mgmt_engine
from backend.models.management import User, Workspace, Membership, Vault, UserRole
from backend.models.notification import Notification

def init_mgmt_db():
    # Ensure the engine and the tables
    _get_or_init_mgmt_engine()
    
    db = get_mgmt_session()
    try:
        # 1. Check whether we already have the "Personal" workspace
        personal_ws = db.query(Workspace).filter(Workspace.slug == "personal").first()
        if not personal_ws:

            personal_ws = Workspace(
                name="Personal",
                slug="personal"
            )
            db.add(personal_ws)
            db.commit()
            db.refresh(personal_ws)
            
            # 2. Create a default user (ismael-legacy)
            legacy_user = db.query(User).filter(User.email == "ismael-legacy@gnosi.app").first()
            if not legacy_user:

                legacy_user = User(
                    email="ismael-legacy@gnosi.app",
                    name="Ismael Garcia (Default)"
                )
                db.add(legacy_user)
                db.commit()
                db.refresh(legacy_user)
            
            # 3. Link user to the workspace as OWNER

            membership = Membership(
                user_id=legacy_user.id,
                workspace_id=personal_ws.id,
                role=UserRole.OWNER
            )
            db.add(membership)
            
            # 4. Create the main Vault

            default_vault = Vault(
                workspace_id=personal_ws.id,
                name="Cervell Digital",
                path_override="vault" # The current vault
            )
            db.add(default_vault)
            db.commit()

        pass

    finally:
        db.close()

if __name__ == "__main__":
    init_mgmt_db()
