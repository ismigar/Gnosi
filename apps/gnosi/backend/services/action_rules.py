"""Regles d'acció declaratives per taula (bloc `table.action_rules`).

Governen les accions explícites de botó (traduir, sincronitzar amb Drupal,
publicar a XXSS) segons la directiva `vault_option_catalogs_action_rules.md`:

  * `requires`: condicions per PODER executar l'acció, amb `reason` per al
    tooltip del botó desactivat i per al 409 del backend.
  * `effects`: canvis d'Estat en completar-se (source / created).
  * `on_stale`: tornar les traduccions obsoletes a «Esborrany».

Frontera amb `rule_engine` (automations): les automations reaccionen a canvis
de dades (`property_change`); les action_rules governen accions de botó —
guarda prèvia + efectes posteriors, també sobre el registre creat. No són un
trigger nou d'automations (directiva §6).

Mòdul pur: sense I/O ni imports del backend. Qui aplica els efectes (escriure
metadata, desar el registry si s'ha hagut de crear una opció) és el caller.
"""
import copy
from typing import Any, Dict, List, Optional, Tuple

from backend.services import option_catalogs as oc

ACTION_TRANSLATE = "translate_row"
ACTION_SYNC_DRUPAL = "sync_drupal"
ACTION_PUBLISH_SOCIAL = "publish_social"

# Seeds per defecte (directiva §3.3). S'escriuen al registry quan la taula
# activa la funcionalitat corresponent; un cop al registry, manen els del
# registry (editables a mà).
DEFAULT_ACTION_RULES: Dict[str, dict] = {
    ACTION_TRANSLATE: {
        "requires": [
            {
                "role": "status",
                "not_in": [oc.STATUS_DRAFT],
                "reason": "No es pot traduir si està en esborrany",
            }
        ],
        "effects": {
            "source": [{"role": "status", "set": oc.STATUS_TRANSLATED}],
            "created": [{"role": "status", "set": oc.STATUS_DRAFT}],
        },
        "on_stale": [
            {"target": "translations", "role": "status", "set": oc.STATUS_DRAFT}
        ],
    },
    ACTION_SYNC_DRUPAL: {
        "requires": [
            {
                "role": "status",
                "not_in": [oc.STATUS_DRAFT],
                "reason": "No es pot sincronitzar un esborrany",
            }
        ],
        "effects": {
            "source": [{"role": "status", "set": oc.STATUS_PUBLISHED_DRUPAL}],
        },
    },
    ACTION_PUBLISH_SOCIAL: {
        "requires": [
            {
                "role": "status",
                "not_in": [oc.STATUS_DRAFT],
                "reason": "No es pot publicar un esborrany",
            }
        ],
        "effects": {
            "source": [{"role": "status", "set": oc.STATUS_PUBLISHED_SOCIAL}],
        },
    },
}


def _action_enabled(table: dict, action: str) -> bool:
    if action == ACTION_TRANSLATE:
        return bool(table.get("translation_enabled"))
    if action == ACTION_SYNC_DRUPAL:
        return bool(table.get("drupal_sync_enabled"))
    if action == ACTION_PUBLISH_SOCIAL:
        return oc.table_has_social_column(table)
    return False


def get_action_rules(table: dict, action: str) -> Optional[dict]:
    """Bloc de regles d'una acció: el del registry si hi és; si no, el default
    quan la funcionalitat està activa (taules encara no re-desades amb seed).
    None si l'acció no aplica a la taula."""
    rules = table.get("action_rules")
    if isinstance(rules, dict) and isinstance(rules.get(action), dict):
        return rules[action]
    if _action_enabled(table, action):
        return DEFAULT_ACTION_RULES.get(action)
    return None


def ensure_action_rules(table: dict) -> bool:
    """Seed-on-enable dels blocs d'action_rules (idempotent): escriu el bloc
    per defecte de cada funcionalitat activa que encara no en tingui. Mai
    sobreescriu un bloc existent (és editable a mà al registry)."""
    changed = False
    for action in (ACTION_TRANSLATE, ACTION_SYNC_DRUPAL, ACTION_PUBLISH_SOCIAL):
        if not _action_enabled(table, action):
            continue
        rules = table.setdefault("action_rules", {})
        if not isinstance(rules.get(action), dict):
            # Còpia profunda: el bloc del registry és editable a mà i no pot
            # compartir referències amb el default del mòdul.
            rules[action] = copy.deepcopy(DEFAULT_ACTION_RULES[action])
            changed = True
    return changed


def read_prop_value(metadata: dict, prop: dict) -> Any:
    """Valor d'una property al frontmatter (prioritat id → nom → àlies),
    mateixa convenció que la resta del backend."""
    keys: List[str] = []
    if prop.get("id"):
        keys.append(prop["id"])
    if prop.get("name"):
        keys.append(prop["name"])
    keys.extend(a for a in (prop.get("aliases") or []) if a)
    for k in keys:
        if k in (metadata or {}):
            v = metadata.get(k)
            if v not in (None, "", [], {}):
                return v
    return None


def _values_of(raw: Any) -> List[str]:
    if isinstance(raw, list):
        return [str(v).strip() for v in raw if str(v).strip()]
    if raw is None:
        return []
    s = str(raw).strip()
    return [s] if s else []


def _group_of(option_name: str, options: List[dict]) -> str:
    for o in options:
        if o.get("name") == option_name:
            return str(o.get("group") or "")
    return ""


def check_requires(
    table: dict, action: str, metadata: dict
) -> Tuple[bool, Optional[str]]:
    """Avalua les condicions `requires` d'una acció sobre un registre.

    Retorna `(ok, reason)`. Si la taula no té regles per a l'acció, o una
    condició no es pot avaluar (camp del rol inexistent, valor buit), passa:
    les regles restringeixen estats declarats, no l'absència de dada.
    """
    rules = get_action_rules(table, action)
    if not rules:
        return True, None
    for cond in rules.get("requires") or []:
        if not isinstance(cond, dict):
            continue
        role = str(cond.get("role") or "").strip()
        prop = oc.find_role_prop(table, role) if role else None
        if not prop:
            continue
        values = _values_of(read_prop_value(metadata or {}, prop))
        if not values:
            continue
        reason = str(cond.get("reason") or "").strip() or (
            f"L'estat actual no permet l'acció {action}"
        )
        not_in = cond.get("not_in")
        if isinstance(not_in, list) and any(v in not_in for v in values):
            return False, reason
        allowed = cond.get("in")
        if isinstance(allowed, list) and not any(v in allowed for v in values):
            return False, reason
        in_group = cond.get("in_group")
        not_in_group = cond.get("not_in_group")
        if in_group or not_in_group:
            options = oc.get_prop_options(prop)
            groups = {_group_of(v, options) for v in values}
            if isinstance(not_in_group, str) and not_in_group in groups:
                return False, reason
            if isinstance(in_group, str) and in_group not in groups:
                return False, reason
    return True, None


def effect_write_key(metadata: dict, prop: dict) -> Optional[str]:
    """Clau on escriure el valor d'un efecte: la que el frontmatter JA usa per
    a aquest camp (id, nom o àlies), per no crear claus duplicades; si la fila
    no en té cap, la convenció id-estable→nom."""
    candidates: List[str] = []
    if prop.get("id"):
        candidates.append(prop["id"])
    if prop.get("name"):
        candidates.append(prop["name"])
    candidates.extend(a for a in (prop.get("aliases") or []) if a)
    for k in candidates:
        if k in (metadata or {}):
            return k
    return prop.get("id") or prop.get("name")


def status_effect(
    table: dict, action: str, target: str
) -> Tuple[Optional[dict], Optional[str], bool]:
    """Efecte d'Estat que l'acció ha d'aplicar a `target` (source|created).

    Retorna `(property, valor, catalog_changed)` — el caller tria la clau amb
    `effect_write_key`. Si l'opció a escriure no és al catàleg del camp, s'hi
    AFEGEIX (directiva §4.1.5: una regla mai falla per catàleg incomplet) —
    `catalog_changed=True` indica al caller que ha de persistir el registry.
    """
    rules = get_action_rules(table, action)
    if not rules:
        return None, None, False
    for eff in (rules.get("effects") or {}).get(target) or []:
        if not isinstance(eff, dict):
            continue
        role = str(eff.get("role") or "").strip()
        value = str(eff.get("set") or "").strip()
        if not role or not value:
            continue
        prop = oc.find_role_prop(table, role)
        if not prop:
            continue
        catalog_changed = oc.ensure_options_exist(prop, [(value, "")])
        return prop, value, catalog_changed
    return None, None, False


def on_stale_effect(table: dict) -> Tuple[Optional[dict], Optional[str], bool]:
    """Efecte d'Estat per a les traduccions que queden obsoletes (`on_stale` de
    translate_row). Mateixa forma de retorn que `status_effect`."""
    rules = get_action_rules(table, ACTION_TRANSLATE)
    if not rules:
        return None, None, False
    for eff in rules.get("on_stale") or []:
        if not isinstance(eff, dict):
            continue
        if str(eff.get("target") or "translations") != "translations":
            continue
        role = str(eff.get("role") or "").strip()
        value = str(eff.get("set") or "").strip()
        if not role or not value:
            continue
        prop = oc.find_role_prop(table, role)
        if not prop:
            continue
        catalog_changed = oc.ensure_options_exist(prop, [(value, "")])
        return prop, value, catalog_changed
    return None, None, False
