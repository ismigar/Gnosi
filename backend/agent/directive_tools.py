from langchain_core.tools import tool
from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent.parent
INSTRUCTIONS_DIR = BASE_DIR / "backend" / "instructions"

# Ensure instructions directory exists
INSTRUCTIONS_DIR.mkdir(parents=True, exist_ok=True)

@tool
def list_directives() -> str:
    """
    Lists all available directives (SOPs) in the instructions directory.
    Use this to see what procedural knowledge is available.
    """
    try:
        files = list(INSTRUCTIONS_DIR.glob("*.md"))
        if not files:
            return "No directives found."
        
        return "Available Directives:\n" + "\n".join([f"- {f.name}" for f in files])
    except Exception as e:
        return f"Error listing directives: {str(e)}"

@tool
def read_directive(topic: str) -> str:
    """
    Reads the content of a specific directive (SOP).
    Args:
        topic: The filename (e.g., 'scraping_twitter.md') or topic name ('scraping_twitter').
    """
    try:
        if not topic.endswith(".md"):
            topic += ".md"
            
        file_path = INSTRUCTIONS_DIR / topic
        
        if not file_path.exists():
            return f"Directive '{topic}' not found."
            
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
            
    except Exception as e:
        return f"Error reading directive: {str(e)}"

@tool
def update_directive(topic: str, content: str) -> str:
    """
    Creates or updates a directive (SOP).
    Use this to save knowledge for the future when you learn something new or fix a bug.
    Args:
        topic: The filename or topic name.
        content: The full markdown content of the directive.
    """
    try:
        if not topic.endswith(".md"):
            topic += ".md"
            
        file_path = INSTRUCTIONS_DIR / topic
        
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
            
        return f"Successfully updated directive: {topic}"
            
    except Exception as e:
        return f"Error updating directive: {str(e)}"
