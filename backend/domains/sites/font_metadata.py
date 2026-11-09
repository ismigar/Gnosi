"""Bounded OpenType/WOFF naming metadata, with a filename-based CSS alias fallback.

References: learn.microsoft.com/en-us/typography/opentype/spec/name and
www.w3.org/TR/WOFF/#TableDirectory. WOFF2 uses the original filename as its alias.
"""
from pathlib import Path
import re
import struct
import zlib
from typing import Literal

from .models import SiteFont

TABLE_LIMIT = 1_000_000
WEIGHTS = [('extra-bold', 800), ('extrabold', 800), ('ultrabold', 800), ('semibold', 600), ('demibold', 600), ('extralight', 200), ('ultralight', 200), ('thin', 100), ('light', 300), ('medium', 500), ('black', 900), ('heavy', 900), ('bold', 700)]


def _table(raw: bytes, tag: bytes) -> bytes:
    woff = raw.startswith(b'wOFF')
    if not woff and not raw.startswith((b'\x00\x01\x00\x00', b'OTTO')):
        return b''
    start, size, count_offset = (44, 20, 12) if woff else (12, 16, 4)
    if len(raw) < start:
        return b''
    count = struct.unpack_from('>H', raw, count_offset)[0]
    if count > 256 or start + count * size > len(raw):
        return b''
    for index in range(count):
        entry = start + index * size
        if raw[entry:entry + 4] != tag:
            continue
        if woff:
            offset, length, original = struct.unpack_from('>III', raw, entry + 4)
        else:
            offset, length = struct.unpack_from('>II', raw, entry + 8)
            original = length
        if original > TABLE_LIMIT or length > TABLE_LIMIT or offset > len(raw) or length > len(raw) - offset:
            return b''
        data = raw[offset:offset + length]
        if woff and length < original:
            try:
                decoder = zlib.decompressobj()
                data = decoder.decompress(data, original + 1)
                if not decoder.eof or decoder.unused_data or len(data) != original:
                    return b''
            except zlib.error:
                return b''
        return data if len(data) == original else b''
    return b''


def _names(table: bytes) -> dict[int, str]:
    if len(table) < 6:
        return {}
    _, count, storage = struct.unpack_from('>HHH', table)
    if count > 4096 or 6 + count * 12 > len(table) or not 6 + count * 12 <= storage <= len(table):
        return {}
    names: dict[int, str] = {}
    ranks: dict[int, int] = {}
    for index in range(count):
        platform, encoding, language, name, length, offset = struct.unpack_from('>HHHHHH', table, 6 + index * 12)
        if name not in {1, 2, 16, 17} or not 0 < length <= 2048 or storage + offset + length > len(table):
            continue
        codec = 'utf-16-be' if platform in {0, 3} else 'mac_roman' if platform == 1 and encoding == 0 else None
        if not codec:
            continue
        rank = (2 if language in {0, 0x409} else 0) + (1 if platform in {0, 3} else 0)
        if rank <= ranks.get(name, -1):
            continue
        try:
            value = table[storage + offset:storage + offset + length].decode(codec).strip()
        except UnicodeError:
            continue
        if value:
            names[name] = value
            ranks[name] = rank
    return names


def describe_font(raw: bytes, filename: str, source: str) -> SiteFont:
    stem = Path(filename.replace('\\', '/').split('/')[-1]).stem
    hint = stem.casefold()
    weight = next((str(value) for word, value in WEIGHTS if word in hint), '400')
    style: Literal['normal', 'italic'] = 'italic' if 'italic' in hint or 'oblique' in hint else 'normal'
    family = re.sub(r'(?i)[-_ ](?:extra[-_ ]?light|ultra[-_ ]?light|semi[-_ ]?bold|demi[-_ ]?bold|extra[-_ ]?bold|ultra[-_ ]?bold|thin|light|regular|normal|book|medium|bold|black|heavy|italic|oblique|[1-9]00)(?:[-_ ]*(?:italic|oblique))?$', '', stem)
    names = _names(_table(raw, b'name'))
    family = names.get(16) or names.get(1) or family
    subfamily = (names.get(17) or names.get(2) or '').casefold()
    metrics = _table(raw, b'OS/2')
    if len(metrics) >= 6:
        detected = struct.unpack_from('>H', metrics, 4)[0]
        if 1 <= detected <= 1000:
            weight = str(detected)
    if subfamily or len(metrics) >= 64:
        style = 'italic' if 'italic' in subfamily or 'oblique' in subfamily or len(metrics) >= 64 and struct.unpack_from('>H', metrics, 62)[0] & 1 else 'normal'
    family = re.sub(r'[^\w -]', ' ', family, flags=re.UNICODE)
    family = re.sub(r'\s+', ' ', family).strip()[:100] or 'Imported font'
    return SiteFont(family=family, src=source, weight=weight, style=style)
