"""Compatibility facade for pure citation lookup normalizers.

Canonical implementations live under
``backend.domains.vault.citations.normalizers``. Historical imports remain
available here while callers migrate to the domain package.
"""

from __future__ import annotations

import re as re
from typing import Any as Any
from typing import Optional as Optional

from backend.domains.vault.citations.normalizers.arxiv import (
    arxiv_to_zotero_item as arxiv_to_zotero_item,
)
from backend.domains.vault.citations.normalizers.crossref import (
    CROSSREF_TYPE_TO_ZOTERO as _CROSSREF_TYPE_TO_ZOTERO,
)
from backend.domains.vault.citations.normalizers.crossref import (
    crossref_to_zotero_item as crossref_to_zotero_item,
)
from backend.domains.vault.citations.normalizers.html import (
    html_meta_to_zotero_item as html_meta_to_zotero_item,
)
from backend.domains.vault.citations.normalizers.html import (
    parse_meta_tags as _parse_meta_tags,
)
from backend.domains.vault.citations.normalizers.identifiers import (
    DOI_RE as _DOI_RE_LOCAL,
)
from backend.domains.vault.citations.normalizers.identifiers import (
    normalize_doi as _normalize_doi_local,
)
from backend.domains.vault.citations.normalizers.identifiers import (
    normalize_isbn as _normalize_isbn_local,
)
from backend.domains.vault.citations.normalizers.names import (
    pubmed_name_to_creator as _pubmed_name_to_creator,
)
from backend.domains.vault.citations.normalizers.names import (
    split_full_name as _split_full_name,
)
from backend.domains.vault.citations.normalizers.open_library import (
    openlibrary_to_zotero_item as openlibrary_to_zotero_item,
)
from backend.domains.vault.citations.normalizers.pubmed import (
    pubmed_to_zotero_item as pubmed_to_zotero_item,
)
