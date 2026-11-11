"""Legacy renderer presentation derived only from explicitly exported native fields."""
from __future__ import annotations

import hashlib
import math
import re
import unicodedata
from datetime import datetime, timezone
from html import escape
from urllib.parse import urlsplit

from pydantic import JsonValue

from .models import PublicRecord, SiteConfig


def _label(value: object) -> str:
    text = unicodedata.normalize('NFKD', str(value or ''))
    return re.sub(r'[^a-z0-9]', '', ''.join(c for c in text if not unicodedata.combining(c)).lower())


def _text(value: JsonValue) -> str:
    return value.strip() if isinstance(value, str) else ''


def _date(value: JsonValue) -> float | None:
    if isinstance(value, dict):
        value = value.get('start')
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value) if isinstance(value, (int, float, str)) else 0
        if math.isfinite(number) and 0 < number < 253402300800:
            return number
    except (ValueError, OverflowError):
        pass
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
            return parsed.replace(tzinfo=timezone.utc).timestamp() if parsed.tzinfo is None else parsed.timestamp()
        except (ValueError, OverflowError):
            pass
    return None


def _href(value: JsonValue) -> str:
    raw = _text(value)
    try:
        parsed = urlsplit(raw)
        return raw if parsed.scheme in {'https', 'http'} and parsed.hostname and not parsed.username and not parsed.password else ''
    except ValueError:
        return ''


def _tags(value: JsonValue, definition: dict[str, JsonValue], site: SiteConfig, language: str) -> list[JsonValue]:
    config = definition.get('config')
    options = config.get('options', []) if isinstance(config, dict) else definition.get('options', [])
    labels: dict[str, tuple[str, str]] = {}
    if isinstance(options, list):
        for option in options:
            if isinstance(option, dict):
                name = _text(option.get('name') or option.get('label'))
                identity = _text(option.get('id'))
                if name:
                    labels[identity or name] = (name, identity)
                    labels[name] = (name, identity)
    values = value if isinstance(value, list) else [value]
    result: list[JsonValue] = []
    for item in values:
        raw = _text(item.get('name') or item.get('label') or item.get('id')) if isinstance(item, dict) else _text(item)
        if not raw:
            continue
        name, identity = labels.get(raw, (raw, ''))
        if raw not in labels and re.fullmatch(r'(?:[a-f0-9]{8}-[a-f0-9-]{27,}|(?:opt|option)[_-].+)', raw, re.I):
            continue
        # Existing configured public tag pages supply route identity only. The
        # displayed label and membership always come from the selected field.
        route = next((page for page in site.pages if page.enabled and page.language == language and page.title == name and page.id.startswith('tag-') and page.id.endswith('-' + language)), None)
        tag_id = route.id[len('tag-'):-(len(language) + 1)] if route else identity or 'native-' + hashlib.sha256(name.encode()).hexdigest()[:16]
        tag: JsonValue = {'tid': tag_id, 'label': name}
        if tag not in result:
            result.append(tag)
    return result


def _project_value(presentation: dict[str, JsonValue], definition: dict[str, JsonValue], value: JsonValue, site: SiteConfig, language: str) -> None:
    name = _label(definition.get('name'))
    field_type = str(definition.get('type') or '')
    image_names = {'image', 'imatge', 'imagen', 'logo', 'cover', 'foto', 'photo', 'thumbnail'}
    if name in image_names and re.search(r'files?|image|media|attachment', field_type):
        values = value if isinstance(value, list) else [value]
        image = next((_text(v) for v in values if _text(v)), '')
        if image and 'image' not in presentation:
            presentation['image'] = {'url': image, 'alt': ''}
    elif name in {'summary', 'resum', 'resumen', 'resume', 'abstract', 'description', 'descripcio', 'descripcion'}:
        if _text(value):
            presentation.setdefault('summary', _text(value))
    elif name in {'year', 'any', 'ano', 'annee'} and isinstance(value, (str, int, float)) and not isinstance(value, bool):
        if str(value).strip():
            presentation['year'] = str(value).strip()
    elif name in {'tags', 'etiquetes', 'etiquetas'}:
        presentation['tags'] = _tags(value, definition, site, language)
    elif name in {'url', 'website', 'web', 'siteweb', 'llocweb', 'enllac', 'link'} and field_type == 'url':
        if _href(value):
            presentation['href'] = _href(value)


def project_presentation(record: PublicRecord, table: dict[str, JsonValue], site: SiteConfig) -> dict[str, JsonValue]:
    """Never inspect private/unselected note metadata or an imported baseline."""
    table_name = _label(table.get('name'))
    stable_kinds = {'imported-blog': 'article', 'imported-research': 'recurs',
                    'imported-stories': 'recurs', 'imported-resources': 'recurs',
                    'imported-design': 'disseny', 'imported-collaborators': 'col_laboradora'}
    kind = next((stable_kinds[source] for source in record.source_ids if source in stable_kinds), None)
    if kind is None:
        kind = {'articles': 'article', 'article': 'article', 'blog': 'article', 'recursos': 'recurs', 'resources': 'recurs',
                'dissenys': 'disseny', 'designs': 'disseny', 'collaboradores': 'col_laboradora',
                'collaborators': 'col_laboradora'}.get(table_name, 'page')
    presentation: dict[str, JsonValue] = {'kind': kind}
    properties = table.get('properties', [])
    if isinstance(properties, dict):
        properties = [dict(value, id=key) if isinstance(value, dict) else {'id': key, 'name': str(value), 'type': 'text'} for key, value in properties.items()]
    definitions = [p for p in properties if isinstance(p, dict)] if isinstance(properties, list) else []
    chosen = [(p, record.fields[str(p.get('id'))]) for p in definitions if str(p.get('id')) in record.fields]
    writing_names = {'datadescriptura', 'fechadeescritura', 'writingdate', 'published', 'publishedat', 'publicationdate', 'datadepublicacio', 'fechadepublicacion', 'datedepublication'}
    date_candidates = []
    for definition, value in chosen:
        name = _label(definition.get('name'))
        field_type = str(definition.get('type') or '')
        _project_value(presentation, definition, value, site, record.language)
        if name in writing_names or field_type == 'created_time' or name in {'created', 'createdat', 'datadecreacio', 'datecreated'}:
            parsed = _date(value)
            if parsed is not None:
                date_candidates.append((0 if name in writing_names else 1, parsed))
        elif field_type == 'last_edited_time':
            changed = _date(value)
            if changed is not None:
                presentation['changed'] = changed
    image = presentation.get('image')
    if isinstance(image, dict):
        alt = next((_text(value) for definition, value in chosen if _label(definition.get('name')) in {'imagealttext', 'imatgealttext', 'imagenalttext', 'logoalttext', 'alttext'} and _text(value)), '')
        image['alt'] = alt
    if date_candidates:
        presentation['created'] = min(date_candidates, key=lambda candidate: candidate[0])[1]
    return presentation


def detail_image(body: str, presentation: dict[str, JsonValue]) -> str:
    image = presentation.get('image')
    if presentation.get('kind') not in {'article', 'disseny', 'col_laboradora'} or not isinstance(image, dict) or not image.get('url'):
        return body
    url = str(image['url'])
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(body, 'html.parser')
    if any(img.get('src') == url for img in soup.find_all('img')):
        return body
    picture = '<img src="' + escape(url, quote=True) + '" alt="' + escape(str(image.get('alt') or ''), quote=True) + '">'
    href = _href(presentation.get('href'))
    if presentation.get('kind') == 'col_laboradora' and href:
        picture = '<a href="' + escape(href, quote=True) + '">' + picture + '</a>'
    return '<figure>' + picture + '</figure>' + body
