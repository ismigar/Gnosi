from langchain_core.tools import tool
from pathlib import Path
import os

from backend.utils.safe_io import safe_write_text

BASE_DIR = Path(__file__).resolve().parent.parent.parent
INSTRUCTIONS_DIR = Path(__file__).resolve().parent / "instructions"

# Ensure instructions directory exists
INSTRUCTIONS_DIR.mkdir(parents=True, exist_ok=True)


def _safe_directive_path(topic: str):
    """Resolve `topic` to a `.md` INSIDE INSTRUCTIONS_DIR, or None if it would escape.

    `topic` comes from the LLM (potentially influenced by untrusted content that
    the agent reads: vault pages, emails, PDFs). Without containment, a `../`
    or an absolute path would allow reading/WRITING arbitrary files outside the
    directives directory (path traversal). Same containment pattern as
    `run_tests` in system_tools.py.
    
    """
    topic = topic if topic.endswith(".md") else f"{topic}.md"
    base = INSTRUCTIONS_DIR.resolve()
    fp = (INSTRUCTIONS_DIR / topic).resolve()
    if fp != base and base not in fp.parents:
        return None
    return fp


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
        file_path = _safe_directive_path(topic)
        if file_path is None:
            return "Error: invalid directive name (outside the directives directory)."

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
        file_path = _safe_directive_path(topic)
        if file_path is None:
            return "Error: invalid directive name (outside the directives directory)."

        # Atomic write — a crash halfway through the write would leave a directive
        # truncated. The agent might be editing a critical directive and a
        # SIGINT (timeout or backend restart) corrupts it completely.
        safe_write_text(file_path, content)

        return f"Successfully updated directive: {topic}"

    except Exception as e:
        return f"Error updating directive: {str(e)}"
