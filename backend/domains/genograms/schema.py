"""Portable table schemas identified by stable IDs, independent of labels."""
from __future__ import annotations

from uuid import NAMESPACE_URL, uuid5
import json
from pathlib import Path

OPTION_LABELS = json.loads(Path(__file__).with_name("option_labels.json").read_text(encoding="utf-8"))
from backend.domains.vault.registry.state import RegistryData
from .contracts import GenogramPerson, GenogramRelation
from .model import PERSON_OPTIONS, RELATION_OPTIONS


def stable_id(name: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"gnosi:genograms:v1:{name}"))


def field_id(kind: str, role: str) -> str:
    return "fld_" + uuid5(NAMESPACE_URL, f"gnosi:genograms:{kind}:{role}").hex[:8]


LABELS = {
    "database": "Genogrames|Genograms|Genogramas|Génogrammes",
    "people": "Persones|People|Personas|Personnes",
    "relations": "Relacions|Relationships|Relaciones|Relations",
    "view": "Genograma|Genogram|Genograma|Génogramme",
    "title": "Nom|Name|Nombre|Nom", "alias": "Àlies|Alias|Alias|Alias",
    "kind": "Tipus de registre|Record type|Tipo de registro|Type de fiche",
    "symbol": "Símbol|Symbol|Símbolo|Symbole", "gender": "Gènere|Gender|Género|Genre",
    "birth_date": "Naixement|Birth|Nacimiento|Naissance", "death_date": "Defunció|Death|Defunción|Décès",
    "birth_approximate": "Naixement aproximat|Approximate birth|Nacimiento aproximado|Naissance approximative",
    "death_approximate": "Defunció aproximada|Approximate death|Defunción aproximada|Décès approximatif",
    "vital_status": "Estat vital|Vital status|Estado vital|État vital",
    "pregnancy_status": "Estat de gestació|Pregnancy status|Estado de gestación|État de grossesse",
    "pregnancy_date": "Data de gestació|Pregnancy date|Fecha de gestación|Date de grossesse",
    "pregnancy_weeks": "Setmanes de gestació|Pregnancy weeks|Semanas de gestación|Semaines de grossesse",
    "multiple_group": "Grup de naixement múltiple|Multiple birth group|Grupo de nacimiento múltiple|Groupe de naissance multiple",
    "multiple_type": "Tipus de naixement múltiple|Multiple birth type|Tipo de nacimiento múltiple|Type de naissance multiple",
    "birth_order": "Ordre de naixement|Birth order|Orden de nacimiento|Ordre de naissance",
    "tags": "Etiquetes|Tags|Etiquetas|Étiquettes",
    "notes": "Observacions|Notes|Observaciones|Observations", "sources": "Fonts|Sources|Fuentes|Sources",
    "source": "Origen|Source|Origen|Origine", "target": "Destí|Target|Destino|Destination",
    "union_type": "Tipus d’unió|Union type|Tipo de unión|Type d’union",
    "union_status": "Estat d’unió|Union status|Estado de unión|État de l’union",
    "parentage": "Tipus de filiació|Parentage|Tipo de filiación|Filiation",
    "emotion": "Vincle emocional|Emotional bond|Vínculo emocional|Lien émotionnel",
    "union_id": "Unió de referència|Reference union|Unión de referencia|Union de référence",
    "start_date": "Inici|Start|Inicio|Début", "separation_date": "Separació|Separation|Separación|Séparation",
    "divorce_date": "Divorci|Divorce|Divorcio|Divorce", "end_date": "Finalització|End|Finalización|Fin",
    "observed_date": "Data d’observació|Observation date|Fecha de observación|Date d’observation",
    "informant": "Informant|Informant|Informante|Informateur",
}


def label(key: str, locale: str) -> str:
    return LABELS.get(key, f"{key}|{key}|{key}|{key}").split("|")[{"ca": 0, "en": 1, "es": 2, "fr": 3}.get(locale, 1)]


def make_table(kind: str, locale: str) -> RegistryData:
    model = GenogramPerson if kind == "people" else GenogramRelation
    options = PERSON_OPTIONS if kind == "people" else RELATION_OPTIONS
    properties: list[RegistryData] = []
    for role, field in model.model_fields.items():
        if role in ("id", "etag"):
            continue
        property_type = "text"
        if role == "title":
            property_type = "title"
        elif role.endswith("_approximate"):
            property_type = "checkbox"
        elif role in ("birth_order", "pregnancy_weeks"):
            property_type = "number"
        elif role in ("source", "target", "union_id", "sources"):
            property_type = "relation"
        elif role == "tags":
            property_type = "multi_select"
        elif role in options:
            property_type = "select"
        prop: RegistryData = {"id": field_id(kind, role), "name": "title" if role == "title" else label(role, locale), "type": property_type}
        if role in options:
            prop["options"] = [{"id": value, "name": OPTION_LABELS[value].get(locale, value), "color": "gray"} for value in options[role]]
            prop["default"] = OPTION_LABELS[str(field.default)].get(locale, str(field.default))
        if role in ("source", "target", "union_id"):
            prop.update({"relation_database_id": stable_id("relations" if role == "union_id" else "people"), "cardinality": "single", "limit": 1})
        properties.append(prop)
    return {"id": stable_id(kind), "name": label(kind, locale), "folder": f"genograms-{kind}", "database_id": stable_id("database"), "genogram_kind": kind, "properties": properties}
