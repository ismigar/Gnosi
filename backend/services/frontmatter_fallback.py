"""Parser tolerant de frontmatter per a quan `yaml.safe_load` falla.

Font de veritat ÚNICA per al rescat de frontmatter malformat. Abans vivia
duplicat com a `_parse_frontmatter_fallback` a `vault_routes.py`, però
`graph_service.parse_frontmatter` NO el tenia: una pàgina amb YAML lleugerament
malformat (una cometa sense tancar, un tab, un indicador reservat…) es llegia
correctament al Vault (via aquest rescat) però sortia BUIDA al graf (sense
títol, tipus ni color). Compartir-lo garanteix que les dues lectures recuperin
la mateixa metadata de primer nivell.
"""
from __future__ import annotations

import re


def parse_frontmatter_fallback(yaml_content: str) -> dict:
    """Rescata els parells escalars `key: value` de primer nivell d'un
    frontmatter que `yaml.safe_load` ha rebutjat.

    Ignora a posta els blocs niats/objectes/llistes i només salva els escalars
    de primer nivell, de manera que els llistats puguin resoldre id/title/
    table_id encara que una altra clau tingui YAML corrupte.
    """
    metadata: dict = {}
    for raw_line in yaml_content.splitlines():
        line = raw_line.rstrip()
        if not line:
            continue

        stripped = line.lstrip()
        if stripped.startswith("#"):
            continue

        # Ignora blocs YAML niats i membres de llista per no corrompre el parseig.
        if line.startswith((" ", "\t", "- ")):
            continue

        if ":" not in line:
            continue

        key, value = line.split(":", 1)
        key = key.strip()
        if not key:
            continue

        parsed_value = value.strip()

        if len(parsed_value) >= 2 and (
            (parsed_value[0] == '"' and parsed_value[-1] == '"')
            or (parsed_value[0] == "'" and parsed_value[-1] == "'")
        ):
            parsed_value = parsed_value[1:-1]

        lowered = parsed_value.lower()
        if lowered == "true":
            metadata[key] = True
        elif lowered == "false":
            metadata[key] = False
        elif re.fullmatch(r"-?\d+", parsed_value):
            metadata[key] = int(parsed_value)
        else:
            metadata[key] = parsed_value

    return metadata
