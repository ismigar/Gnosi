from backend.data.management_db import _get_mgmt_db_path

def print_db_path():
    path = _get_mgmt_db_path()

if __name__ == "__main__":
    print_db_path()
