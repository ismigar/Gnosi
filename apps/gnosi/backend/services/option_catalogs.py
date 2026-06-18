"""Catàlegs d'opcions rics, rols semàntics de camp i seeds per taula.

Implementa el model de dades de la directiva
`vault_option_catalogs_action_rules.md`:

  * `config.options` admet DOS formats — string llegat ("CA") i objecte ric
    `{name, color?, group?}`. La lectura normalitza; l'escriptura sempre desa
    el format ric. Un registry vell carrega sense migrar.
  * `config.role` (`language` | `status` | `tags`) identifica el camp que les
    accions han d'usar, amb fallback als heurístics de nom existents.
  * Seeds: en desar una taula (upsert del registry) es garanteix el catàleg
    base del camp d'estat i s'hi afegeixen els estats que les funcionalitats
    actives requereixen («Traduït», «Publicat a Drupal», «Publicat a XXSS»).
  * Catàlegs compartits amb nom: bloc `option_catalogs` a l'arrel del registry;
    un camp hi enllaça amb `config.catalog_ref` (mai conviu amb `options`).

Com `translation_helpers`: sense I/O, sense FastAPI, sense imports del backend
— dades entren, dades surten (testejable amb pytest sense arrossegar l'app).
"""
import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

# Tipus de camp amb catàleg d'opcions triables (mirall de OPTION_FIELD_TYPES
# del SchemaConfigModal).
OPTION_TYPES = {"select", "multi_select", "status"}

# Paleta tancada de colors per opció (els noms són estables: la UI els mapeja
# a CSS). El color automàtic es tria per hash del nom — estable entre Macs i
# entre execucions, sense estat compartit.
OPTION_COLOR_PALETTE = [
    "gray", "blue", "green", "yellow", "orange",
    "red", "purple", "pink", "brown", "teal",
]

# Grups per defecte d'un camp `status` (estil Notion: Inicial · En curs · Final).
DEFAULT_STATUS_GROUPS = ["Inicial", "En curs", "Final"]

# Catàleg seed d'Estat (decisió d'Ismael, directiva §9.1). «Esborrany» i
# «Revisat» sempre; la resta s'afegeix segons les funcionalitats actives.
STATUS_DRAFT = "Esborrany"
STATUS_REVIEWED = "Revisat"
STATUS_TRANSLATED = "Traduït"
STATUS_PUBLISHED_DRUPAL = "Publicat a Drupal"
STATUS_PUBLISHED_SOCIAL = "Publicat a XXSS"

BASE_STATUS_SEED: List[Tuple[str, str]] = [
    (STATUS_DRAFT, "Inicial"),
    (STATUS_REVIEWED, "En curs"),
]

ROLE_LANGUAGE = "language"
ROLE_STATUS = "status"
ROLE_TAGS = "tags"

# Heurístics de nom per assignar rols (mateixos sinònims que
# translation_helpers._LANGUAGE_FIELD_NAMES per al camp idioma).
_ROLE_FIELD_NAMES = {
    ROLE_LANGUAGE: {"idioma", "llengua", "language", "lang", "lengua", "lingua"},
    ROLE_STATUS: {"estat", "estado", "status", "state"},
    ROLE_TAGS: {"tags", "tag", "etiquetes", "etiquetas", "labels"},
}

# Tipus admissibles per a l'heurístic de NOM de cada rol. Un camp «Estat» de
# tipus text (p. ex. el cicle de vida propi de «Publicacions Socials») NO és
# un camp d'estat semàntic: ni se li fan seeds ni les accions l'usen. El rol
# EXPLÍCIT (config.role) no té aquesta restricció — mana la intenció.
_ROLE_ALLOWED_TYPES = {
    ROLE_LANGUAGE: {"select", "status"},
    ROLE_STATUS: {"select", "status"},
    ROLE_TAGS: {"multi_select"},
}

# Senyal de publicació a XXSS: columna `system` amb nom xxss/social (mateix
# regex que el frontend — isSocialPublishTable a VaultTable).
_SOCIAL_COLUMN_RE = re.compile(r"xxss|social", re.IGNORECASE)


def _strip_accents(text: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", text)
        if unicodedata.category(c) != "Mn"
    )


def _norm_name(name: Any) -> str:
    return _strip_accents(str(name or "").strip().lower())


def auto_color(name: str) -> str:
    """Color estable per a una opció sense color explícit.

    Hash djb2-xor sobre el nom normalitzat: trivialment replicable a JS
    (optionCatalogUtils.js fa servir el MATEIX algorisme) perquè una opció
    encara no persistida es pinti igual al client que al servidor.
    """
    h = 5381
    for ch in _norm_name(name):
        h = ((h * 33) ^ ord(ch)) & 0xFFFFFFFF
    return OPTION_COLOR_PALETTE[h % len(OPTION_COLOR_PALETTE)]


def normalize_option(opt: Any) -> Optional[Dict[str, Any]]:
    """Una opció (string llegat o dict ric) → dict ric, o None si invàlida."""
    if isinstance(opt, dict):
        name = str(opt.get("name") or "").strip()
        if not name:
            return None
        out: Dict[str, Any] = {"name": name}
        color = str(opt.get("color") or "").strip().lower()
        out["color"] = color if color in OPTION_COLOR_PALETTE else auto_color(name)
        group = str(opt.get("group") or "").strip()
        if group:
            out["group"] = group
        return out
    if isinstance(opt, (str, int, float, bool)):
        name = str(opt).strip()
        if not name:
            return None
        return {"name": name, "color": auto_color(name)}
    return None


def normalize_options(options: Any) -> List[Dict[str, Any]]:
    """Llista d'opcions en qualsevol format → llista rica sense duplicats
    (primera aparició mana, comparació exacta per nom)."""
    out: List[Dict[str, Any]] = []
    seen = set()
    for opt in options if isinstance(options, list) else []:
        norm = normalize_option(opt)
        if norm and norm["name"] not in seen:
            seen.add(norm["name"])
            out.append(norm)
    return out


def option_names(options: Any) -> List[str]:
    return [o["name"] for o in normalize_options(options)]


def get_prop_config(prop: dict) -> dict:
    cfg = prop.get("config")
    return cfg if isinstance(cfg, dict) else {}


def get_prop_options(prop: dict, option_catalogs: Optional[dict] = None) -> List[Dict[str, Any]]:
    """Opcions efectives d'una property, normalitzades.

    Prioritat (mateixa que buildSchemaFromTableProperties al frontend):
    `config.catalog_ref` (catàleg compartit) → `config.options` (niat, l'escriu
    el PATCH inline) → `options` al nivell superior (l'escriu el desat del
    modal).
    """
    cfg = get_prop_config(prop)
    ref = str(cfg.get("catalog_ref") or "").strip()
    if ref and isinstance(option_catalogs, dict) and isinstance(option_catalogs.get(ref), list):
        return normalize_options(option_catalogs[ref])
    if isinstance(cfg.get("options"), list):
        return normalize_options(cfg["options"])
    if isinstance(prop.get("options"), list):
        return normalize_options(prop["options"])
    return []


def set_prop_options(prop: dict, options: List[Dict[str, Any]]) -> None:
    """Escriu el catàleg (normalitzat) a la ubicació canònica `config.options`
    i retira el duplicat llegat del nivell superior perquè no divergeixin."""
    cfg = prop.setdefault("config", {})
    cfg["options"] = normalize_options(options)
    prop.pop("options", None)


def prop_role(prop: dict) -> str:
    """Rol explícit (`config.role`) o '' si no en té."""
    role = str(get_prop_config(prop).get("role") or "").strip().lower()
    return role if role in (ROLE_LANGUAGE, ROLE_STATUS, ROLE_TAGS) else ""


def find_role_prop(table: dict, role: str) -> Optional[dict]:
    """Property d'una taula per rol semàntic, amb fallback a l'heurístic de nom.

    El fallback garanteix compatibilitat amb taules no migrades: les accions
    troben el camp «Estat»/«Idioma»/«Tags» encara que ningú hagi assignat rols.
    """
    props = table.get("properties") or []
    for p in props:
        if prop_role(p) == role:
            return p
    names = _ROLE_FIELD_NAMES.get(role, set())
    allowed = _ROLE_ALLOWED_TYPES.get(role, OPTION_TYPES)
    for p in props:
        if _norm_name(p.get("name")) in names and p.get("type") in allowed:
            return p
    return None


def table_has_social_column(table: dict) -> bool:
    for p in table.get("properties") or []:
        cfg = get_prop_config(p)
        is_system = p.get("system") is True or cfg.get("system") is True
        if is_system and _SOCIAL_COLUMN_RE.search(str(p.get("name") or "")):
            return True
    return False


def assign_roles(table: dict) -> bool:
    """Assigna `config.role` per nom als camps que no en tinguin (idempotent).

    Només camps de tipus opció (per a status/tags) o select (per a idioma):
    un camp de text lliure anomenat «Estat» no es toca.
    """
    changed = False
    taken = {prop_role(p) for p in table.get("properties") or [] if prop_role(p)}
    for p in table.get("properties") or []:
        if prop_role(p):
            continue
        if p.get("type") not in OPTION_TYPES:
            continue
        name = _norm_name(p.get("name"))
        for role, names in _ROLE_FIELD_NAMES.items():
            if name in names and role not in taken:
                if role == ROLE_TAGS and p.get("type") != "multi_select":
                    continue
                if role in (ROLE_LANGUAGE, ROLE_STATUS) and p.get("type") == "multi_select":
                    continue
                p.setdefault("config", {})["role"] = role
                taken.add(role)
                changed = True
                break
    return changed


def ensure_options_exist(prop: dict, wanted: List[Tuple[str, str]]) -> bool:
    """Garanteix que les opcions `(nom, grup)` són al catàleg del camp.

    Normalitza el catàleg existent (strings → format ric) i hi afegeix les que
    faltin. No toca ni reordena les existents. Retorna True si ha modificat.
    Camps amb `catalog_ref` no es toquen (el catàleg compartit és de l'usuari).
    """
    cfg = get_prop_config(prop)
    if str(cfg.get("catalog_ref") or "").strip():
        return False
    existing = get_prop_options(prop)
    before = [dict(o) for o in existing]
    have = {o["name"] for o in existing}
    for name, group in wanted:
        if name not in have:
            opt: Dict[str, Any] = {"name": name, "color": auto_color(name)}
            if group:
                opt["group"] = group
            existing.append(opt)
            have.add(name)
    raw_options = get_prop_config(prop).get("options") or prop.get("options")
    needs_normalize = raw_options is not None and normalize_options(raw_options) != raw_options
    if existing != before or needs_normalize or (raw_options is None and existing):
        set_prop_options(prop, existing)
        return True
    return False


def ensure_status_seed(table: dict) -> bool:
    """Seed-on-enable del camp d'estat (directiva §3.3, decisió §9.1).

    Catàleg base «Esborrany»/«Revisat» sempre; «Traduït» si la taula és
    traduïble; «Publicat a Drupal» / «Publicat a XXSS» si tenen la
    funcionalitat activa. També garanteix `option_groups` per a camps status.
    No fa res si la taula no té camp d'estat.
    """
    prop = find_role_prop(table, ROLE_STATUS)
    if not prop:
        return False
    wanted = list(BASE_STATUS_SEED)
    if table.get("translation_enabled"):
        wanted.append((STATUS_TRANSLATED, "En curs"))
    if table.get("drupal_sync_enabled"):
        wanted.append((STATUS_PUBLISHED_DRUPAL, "Final"))
    if table_has_social_column(table):
        wanted.append((STATUS_PUBLISHED_SOCIAL, "Final"))
    changed = ensure_options_exist(prop, wanted)
    if prop.get("type") == "status":
        cfg = prop.setdefault("config", {})
        if not isinstance(cfg.get("option_groups"), list) or not cfg.get("option_groups"):
            cfg["option_groups"] = list(DEFAULT_STATUS_GROUPS)
            changed = True
    return changed


def normalize_table_options(table: dict) -> bool:
    """Canonicalitza els catàlegs de tots els camps d'opcions d'una taula:
    format ric + ubicació única (`config.options`). Idempotent."""
    changed = False
    for p in table.get("properties") or []:
        if p.get("type") not in OPTION_TYPES:
            continue
        cfg = get_prop_config(p)
        if str(cfg.get("catalog_ref") or "").strip():
            # Amb catàleg compartit no hi ha opcions locals: si en queden de
            # llegades, es retiren (mai conviuen, directiva §3.1).
            if cfg.get("options") is not None or p.get("options") is not None:
                cfg.pop("options", None)
                p.pop("options", None)
                changed = True
            continue
        raw = cfg.get("options") if isinstance(cfg.get("options"), list) else p.get("options")
        if raw is None:
            continue
        normalized = normalize_options(raw)
        if raw != normalized or "options" in p:
            set_prop_options(p, normalized)
            changed = True
    return changed


def ensure_table_seeds(table: dict) -> bool:
    """Punt únic d'entrada del desat de taula (upsert del registry): normalitza
    catàlegs, assigna rols per nom i fa el seed d'estats. Idempotent."""
    changed = normalize_table_options(table)
    changed = assign_roles(table) or changed
    changed = ensure_status_seed(table) or changed
    return changed
