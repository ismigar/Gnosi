
import os
from pathlib import Path

# Path to the calendar folder in the vault (using the mount point in the host for simplicity in this script, or I can use the container path)
# Since I'll run this inside the container:
vault_path = Path("/vault")
calendar_dir = vault_path / "Calendar" / "External" / "ismigar_gmail_com"

def patch_files():
    if not calendar_dir.exists():
        print(f"Directory {calendar_dir} not found.")
        return

    count = 0
    for file_path in calendar_dir.glob("*.md"):
        content = file_path.read_text(encoding="utf-8")
        old_line = "source: Google Calendar (ismigar@gmail.com)"
        new_line = "source: ismigar@gmail.com"
        
        if old_line in content:
            new_content = content.replace(old_line, new_line)
            file_path.write_text(new_content, encoding="utf-8")
            count += 1
    
    print(f"Patched {count} files in {calendar_dir}")

if __name__ == "__main__":
    patch_files()
