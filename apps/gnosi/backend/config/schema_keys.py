# pipeline/config/schema_keys.py
"""
Candidate keys and aliases for data extraction from JSON and Notion.
Hardcoded keys; not configurable via params.yaml.
"""

# -----------------------------------
# Node Keys
# -----------------------------------
NODE_ID_KEYS = ["id", "page_id", "uuid", "ID", "key", "notion_id", "node_id"]
NODE_TITLE_KEYS = [
    "Nota", "Name", "Títol", "Title", "Título", "Nom", "label", "title", "name", "text", "Titre"
]
NODE_KIND_KEYS  = [
    "kind", "Tipus de nota", "type", "Tipus", "categoria", "class", "classe", 
    "Tipo", "Tipo de nota", "Type", "Type de note", "Catégorie"
]

# -----------------------------------
# Edge Keys
# -----------------------------------
EDGE_SRC_KEYS = ["source", "from", "src", "a", "u", "id1", "source_id", "from_id"]
EDGE_DST_KEYS = ["target", "to", "dst", "b", "v", "id2", "target_id", "to_id"]

EDGE_ARRAY_KEYS = ["edges", "links", "relations", "connections", "enllacos", "enlaces"]

# -----------------------------------
# Relation and Project Keys
# -----------------------------------
PROJECT_KEYS    = [
    "Projecte", "Projectes", "Project", "Projects", "Proyecto", "Proyectos", "Projet", "Projets"
]
LINKS_PROP_KEYS = [
    "Enllaça a", "Enlaza a", "Link to", "Links to", "Enlace a", "Lien vers", "Lie à", "Relacionado con"
]

# -----------------------------------
# Semantic Mapping (Notion to Internal Types)
# -----------------------------------
SELECT_TO_KIND = {
    # Català
    "nota permanent": "permanent",
    "permanent": "permanent",
    "nota de lectura": "lectura",
    "lectura": "lectura",
    "nota índex": "index",
    "índex": "index",
    "index": "index",
    "nota diàleg": "dialogo",
    "diàleg": "dialogo",
    "dialogo": "dialogo",

    # Español
    "nota permanente": "permanent",
    "permanente": "permanent",
    "nota índice": "index",
    "índice": "index",

    # English
    "permanent note": "permanent",
    "reading note": "lectura",
    "literature note": "lectura",
    "index note": "index",

    # Français
    "note permanente": "permanent",
    "note de lecture": "lectura",
    "note d'index": "index",
    "index": "index",
}

# -----------------------------------
# Helper Functions
# -----------------------------------
def pick(d: dict, keys: list[str]):
    """Returns the first existing value in d for any key in keys."""
    for k in keys:
        if k in d:
            return d[k]
    return None


# -----------------------------------
# Public API: Retrieve Full Schema
# -----------------------------------
def get_schema_keys() -> dict:
    """
    Return dictionary containing all core keys and mappings.
    Importable as:
        from pipeline.config.schema_keys import get_schema
        SCHEMA = get_schema()
    """
    return {
        "NODE_ID_KEYS": NODE_ID_KEYS,
        "NODE_TITLE_KEYS": NODE_TITLE_KEYS,
        "NODE_KIND_KEYS": NODE_KIND_KEYS,

        "EDGE_SRC_KEYS": EDGE_SRC_KEYS,
        "EDGE_DST_KEYS": EDGE_DST_KEYS,
        "EDGE_ARRAY_KEYS": EDGE_ARRAY_KEYS,

        "PROJECT_KEYS": PROJECT_KEYS,
        "LINKS_PROP_KEYS": LINKS_PROP_KEYS,

        "SELECT_TO_KIND": SELECT_TO_KIND,

        # Expose helper function
        "pick": pick,
    }
