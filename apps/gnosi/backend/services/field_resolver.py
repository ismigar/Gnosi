"""
Resolució de camps per ID immutable o nom (capa de compatibilitat).

Cada property d'una taula del registry té un 'id' immutable amb format
'fld_xxxxxxxx'. Aquest mòdul ofereix helpers per llegir/escriure metadata
de pàgines de manera independent del nom (que pot canviar).

Convencions:
- Una "ref" pot ser un id ('fld_*') o un nom de camp (string qualsevol).
- Quan llegim metadata, si la clau ID hi és la prioritzem; si no, fallback al nom.

PERSISTÈNCIA PER NOM (2026-05): el `.md` i les respostes API guarden les claus
pel **nom actual** del camp, mai per `fld_*` (que és opac per a un humà). L'id
segueix existint a l'esquema (registry) com a referència de vistes/filtres. Per
robustesa davant renombrar columnes, cada property pot tenir `aliases` (noms
antics): el resolver casa per id, nom actual o àlies, i `to_storage_names` /
`to_response_names` reescriuen sempre al nom actual. Vegeu la directiva
`docs/dev_memory/directives/vault_persist_by_name.md`.
"""
from typing import Any, Dict, List, Optional, Tuple


def is_field_id(value: Any) -> bool:
    return isinstance(value, str) and value.startswith("fld_") and len(value) == 12


def get_property_by_id(table: Dict, field_id: str) -> Optional[Dict]:
    if not table or not field_id:
        return None
    for p in table.get("properties", []) or []:
        if p.get("id") == field_id:
            return p
    return None


def get_property_by_name(table: Dict, name: str) -> Optional[Dict]:
    """Casa per nom ACTUAL primer; si no, per àlies (nom antic)."""
    if not table or not name:
        return None
    props = table.get("properties", []) or []
    for p in props:
        if p.get("name") == name:
            return p
    # Fallback: nom antic guardat com a àlies.
    for p in props:
        if name in (p.get("aliases") or []):
            return p
    return None


def resolve_property(table: Dict, ref: str) -> Optional[Dict]:
    """Resol una ref (id, nom actual o àlies) a la property completa."""
    if not ref:
        return None
    if is_field_id(ref):
        return get_property_by_id(table, ref)
    return get_property_by_name(table, ref)


def resolve_ref(table: Dict, ref: str) -> Tuple[Optional[str], Optional[str]]:
    """Retorna (id, name) per una ref donada."""
    prop = resolve_property(table, ref)
    if not prop:
        # No existeix; mantenim la ref en el camp on tindria sentit
        if is_field_id(ref):
            return ref, None
        return None, ref
    return prop.get("id"), prop.get("name")


def get_meta_value(metadata: Dict, table: Dict, ref: str) -> Any:
    """Llegeix metadata per ref (id o nom). Prioritza id, fallback a nom."""
    if not metadata:
        return None
    fid, fname = resolve_ref(table, ref)
    if fid and fid in metadata:
        return metadata[fid]
    if fname and fname in metadata:
        return metadata[fname]
    return None


def set_meta_value(metadata: Dict, table: Dict, ref: str, value: Any) -> Dict:
    """
    Escriu metadata utilitzant id com a clau quan és possible.
    Elimina la clau-nom si encara hi era (migració lazy).
    Muta i retorna metadata.
    """
    if metadata is None:
        metadata = {}
    fid, fname = resolve_ref(table, ref)
    if fid:
        metadata[fid] = value
        if fname and fname != fid and fname in metadata:
            del metadata[fname]
    elif fname:
        metadata[fname] = value
    return metadata


def expand_metadata_for_response(metadata: Dict, table: Dict) -> Dict:
    """
    Per a respostes API: si una clau és un field_id i existeix la property
    corresponent al schema, afegeix també una entrada amb el nom actual
    (sense esborrar la id). Així el frontend antic (que llegeix per nom)
    continua funcionant durant la migració.
    Retorna un dict nou (no muta).
    """
    if not metadata or not table:
        return dict(metadata or {})
    properties = table.get("properties", []) or []
    id_to_name = {p["id"]: p["name"] for p in properties if p.get("id") and p.get("name")}
    out = dict(metadata)
    for k, v in metadata.items():
        if is_field_id(k) and k in id_to_name:
            name = id_to_name[k]
            if name not in out:
                out[name] = v
    return out


def migrate_metadata_keys(metadata: Dict, table: Dict) -> Tuple[Dict, int]:
    """
    Reescriu totes les claus name → id quan trobem coincidència al schema.
    Retorna (metadata_migrada, nombre_de_claus_migrades).
    No toca claus que ja són IDs ni claus desconegudes (no estan al schema).
    """
    if not metadata or not table:
        return metadata or {}, 0
    properties = table.get("properties", []) or []
    name_to_id = {p["name"]: p["id"] for p in properties if p.get("id") and p.get("name")}
    migrated = 0
    new_meta = {}
    for k, v in metadata.items():
        if k in name_to_id:
            new_meta[name_to_id[k]] = v
            migrated += 1
        else:
            new_meta[k] = v
    return new_meta, migrated


# Prioritat de procedència quan diverses claus apunten a la mateixa columna.
_PRIO_CURRENT_NAME = 0
_PRIO_FIELD_ID = 1
_PRIO_ALIAS = 2


def to_storage_names(metadata: Dict, table: Dict) -> Tuple[Dict, bool]:
    """Reescriu TOTES les claus resolubles al **nom actual** de la columna.

    És el límit canònic d'ESCRIPTURA (disc) i de resposta: garanteix que mai es
    persisteixi un `fld_*` ni un nom antic (àlies). Les claus que no resolen a
    cap property (propietats locals reals) es conserven intactes.

    Conflicte (diverses claus → mateixa columna): guanya per prioritat
    nom actual > id > àlies.

    Retorna (metadata_nou, ha_canviat). No muta l'entrada.
    """
    if not isinstance(metadata, dict) or not metadata or not table:
        return (dict(metadata) if isinstance(metadata, dict) else {}), False

    props = table.get("properties", []) or []
    name_set = {p["name"] for p in props if p.get("name")}
    id_to_name = {p["id"]: p["name"] for p in props if p.get("id") and p.get("name")}
    alias_to_name: Dict[str, str] = {}
    for p in props:
        cname = p.get("name")
        for a in (p.get("aliases") or []):
            if a and a != cname and a not in name_set:
                alias_to_name[a] = cname

    chosen: Dict[str, Tuple[int, Any]] = {}  # nom_actual -> (prioritat, valor)
    passthrough: Dict[str, Any] = {}          # claus no resolubles (locals reals)
    order: List[Tuple[str, str]] = []         # ordre de primera aparició

    def consider(cname: str, prio: int, value: Any) -> None:
        if cname not in chosen:
            order.append(("col", cname))
            chosen[cname] = (prio, value)
        elif prio < chosen[cname][0]:
            chosen[cname] = (prio, value)

    for k, v in metadata.items():
        if k in name_set:
            consider(k, _PRIO_CURRENT_NAME, v)
        elif k in id_to_name:
            consider(id_to_name[k], _PRIO_FIELD_ID, v)
        elif k in alias_to_name:
            consider(alias_to_name[k], _PRIO_ALIAS, v)
        elif k not in passthrough:
            order.append(("raw", k))
            passthrough[k] = v

    out: Dict[str, Any] = {}
    for kind, key in order:
        out[key] = chosen[key][1] if kind == "col" else passthrough[key]

    changed = list(out.items()) != list(metadata.items())
    return out, changed


def to_response_names(metadata: Dict, table: Dict) -> Dict:
    """Versió per a respostes API: claus resoltes al nom actual, sense `fld_*`
    ni àlies. No muta. Substitueix `expand_metadata_for_response`."""
    out, _ = to_storage_names(metadata, table)
    return out
