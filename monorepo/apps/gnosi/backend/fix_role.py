from backend.data.management_db import get_mgmt_session
from backend.models.management import Membership, UserRole

def fix_role():
    session = get_mgmt_session()
    membership = session.query(Membership).filter(Membership.user_id == "ismael-legacy").first()
    if membership:

        membership.role = "owner"
        session.commit()

    else:

    session.close()

if __name__ == "__main__":
    fix_role()
