import unicodedata
from typing import Union, Set

def normalize_tag(tag: str) -> str:
    """
    Normalize tag string: lowercase, strip accents, remove extra spaces.
    Returns a unique semantic equivalent.
    """
    t = (tag or "").strip().casefold()
    t = unicodedata.normalize("NFD", t)
    return "".join(ch for ch in t if unicodedata.category(ch) != "Mn")

def normalize_tagset(tags: Union[list, set]) -> Set[str]:
    result = set()
    for t in (tags or []):
        # Handle dict tags with 'name' key
        if isinstance(t, dict):
            tag_str = t.get("name", "")
        else:
            tag_str = t
        
        normalized = normalize_tag(tag_str)
        if normalized:
            result.add(normalized)
    
    return result
