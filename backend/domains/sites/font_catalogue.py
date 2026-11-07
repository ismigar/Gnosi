"""Click-based public font sources, downloaded as bounded local website assets."""
from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlsplit

from fastapi import HTTPException
from pydantic import Field, model_validator

from . import public_http
from .font_metadata import describe_font
from .models import Contract, SiteFont
from .storage import SiteStore
from .theme_assets import LIMIT, upload


class FontCatalogueEntry(Contract):
    id: str
    family: str
    provider: str
    license_url: str


class FontImportRequest(Contract):
    url: str = Field(default='', max_length=8000)
    catalogue_id: str = Field(default='', max_length=100)

    @model_validator(mode='after')
    def one_source(self) -> FontImportRequest:
        if bool(self.url.strip()) == bool(self.catalogue_id):
            raise ValueError('Choose a catalogue font or a font URL')
        return self


GOOGLE_FAMILIES = ('Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Raleway', 'Nunito', 'Oswald', 'Merriweather', 'Lora', 'Playfair Display', 'Libre Baskerville', 'Source Sans 3', 'Source Serif 4', 'Noto Sans', 'Noto Serif', 'Fira Sans', 'Fira Code', 'IBM Plex Sans', 'IBM Plex Serif')
FONTSOURCE_FAMILIES = {'inter': 'Inter', 'literata': 'Literata', 'atkinson-hyperlegible': 'Atkinson Hyperlegible', 'work-sans': 'Work Sans'}
CATALOGUE = [FontCatalogueEntry(id='google:' + family, family=family, provider='Google Fonts', license_url='https://fonts.google.com/specimen/' + quote(family.replace(' ', '+'), safe='+')) for family in GOOGLE_FAMILIES] + [FontCatalogueEntry(id='fontsource:' + slug, family=family, provider='Fontsource', license_url='https://fontsource.org/fonts/' + slug + '/license') for slug, family in FONTSOURCE_FAMILIES.items()]


def _google_families(url: str) -> list[str]:
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.port not in {None, 443} or parsed.username or parsed.password:
        raise ValueError('Use a Google Fonts HTTPS URL')
    if parsed.hostname == 'fonts.googleapis.com' and parsed.path in {'/css', '/css2'} or parsed.hostname == 'fonts.google.com' and parsed.path in {'/selection/embed', '/share', '/selection'}:
        values = parse_qs(parsed.query).get('family', []) or parse_qs(parsed.query).get('selection.family', [])
        names = [name.split(':')[0] for value in values for name in value.split('|')]
    elif parsed.hostname == 'fonts.google.com' and parsed.path.startswith('/specimen/'):
        names = [unquote(parsed.path[len('/specimen/'):]).replace('+', ' ')]
    else:
        raise ValueError('Choose a Google Fonts family or stylesheet URL')
    if not 1 <= len(names) <= 4 or any(not re.fullmatch(r'[\w -]{1,100}', name, re.UNICODE) for name in names):
        raise ValueError('Choose between one and four font families')
    return list(dict.fromkeys(names))


def import_fonts(store: SiteStore, site_id: str, request: FontImportRequest) -> list[SiteFont]:
    site = store.load(site_id)
    budget = public_http.FetchBudget.start(45)
    budget.remaining = budget.encoded_remaining = 16_000_000
    try:
        if request.catalogue_id.startswith('fontsource:'):
            slug = request.catalogue_id.removeprefix('fontsource:')
            if slug not in FONTSOURCE_FAMILIES:
                raise ValueError('Choose a font from the catalogue')
            result = []
            for catalogue_weight in ('400', '700'):
                url = f'https://cdn.jsdelivr.net/fontsource/fonts/{slug}@latest/latin-{catalogue_weight}-normal.woff2'
                response = public_http.fetch(url, budget, maximum=LIMIT)
                source, _ = upload(store, site, f'{slug}-{catalogue_weight}.woff2', response.body, 'font')
                result.append(SiteFont(family=FONTSOURCE_FAMILIES[slug], src=source, weight=catalogue_weight))
            return result
        if request.catalogue_id:
            family = request.catalogue_id.removeprefix('google:')
            if request.catalogue_id != 'google:' + family or family not in GOOGLE_FAMILIES:
                raise ValueError('Choose a font from the catalogue')
            families = [family]
        else:
            families = _google_families(request.url.strip())
        # The legacy API without a browser user agent returns full fonts rather
        # than subset faces; storing overlapping subsets without unicode-range
        # would silently lose accented/non-Latin characters.
        query = '|'.join(family + ':400,700' for family in families)
        response = public_http.fetch('https://fonts.googleapis.com/css?family=' + quote(query, safe='|:,') + '&display=swap', budget, maximum=200_000)
        css = response.body.decode('utf-8')
        faces = re.findall(r'@font-face\s*\{([^{}]+)\}', css)
        if not 1 <= len(faces) <= 8 or 'unicode-range' in css.lower():
            raise ValueError('The provider did not return complete font files')
        prepared: list[tuple[bytes, str, str, str]] = []
        for face in faces:
            name = re.search(r'font-family\s*:\s*[\'"]?([\w -]+)', face)
            weight = re.search(r'font-weight\s*:\s*([1-9]00)', face)
            src = re.search(r'url\(\s*[\'"]?(https://fonts\.gstatic\.com/[^\s)\'";]+)', face)
            if not name or name.group(1).strip() not in families or not weight or not src:
                raise ValueError('The provider returned an unsupported font declaration')
            source_url = src.group(1)
            suffix = Path(urlsplit(source_url).path).suffix.lower()
            if suffix not in {'.woff', '.woff2', '.ttf', '.otf'}:
                raise ValueError('The provider returned an unsupported font file')
            raw = public_http.fetch(source_url, budget, maximum=LIMIT).body
            prepared.append((raw, suffix, name.group(1).strip(), weight.group(1)))
        result = []
        for raw, suffix, family, face_weight in prepared:
            source, _ = upload(store, site, family + suffix, raw, 'font')
            font = describe_font(raw, family + suffix, source)
            result.append(font.model_copy(update={'family': family, 'weight': face_weight, 'style': 'normal'}))
        return result
    except (ValueError, UnicodeError) as error:
        raise HTTPException(422, str(error)) from None
