"""Lock all nine static catalogs to a synthetic pre-extraction contract."""

from __future__ import annotations

import hashlib
from pathlib import Path

from pipeline.skills.technical_documentation.scripts.generate import build_outputs


def write_catalog_fixture(root: Path) -> Path:
    """Create source that must be parsed, never imported or executed."""
    sources = {
        "backend/server.py": (
            "raise RuntimeError('must never import the application')\n"
            "@app.get('/api/pages/{page_id}')\n"
            "def get_page_v2():\n    '''Return Source | 42.'''\n    pass\n"
        ),
        "backend/models/page.py": (
            "class Page:\n    __tablename__ = 'pages_v2'\n"
            "    id: Mapped[int] = mapped_column(primary_key=True)\n"
            "    title: Mapped[str | None] = mapped_column(default='Source')\n"
        ),
        "backend/config.py": (
            "import os\nURL = os.getenv('GNOSI_ENDPOINT', 'local')\n"
            "TOKEN = os.environ.get('SERVICE_TOKEN', 'do-not-publish')\n"
        ),
        "frontend/src/Source groups/page.ts": (
            "export const get_page_v2 = '/api/pages/{page_id}?limit=100';\n"
            "export const endpoint = import.meta.env.VITE_ENDPOINT;\n"
        ),
        "frontend/src/App.tsx": (
            "import { Route } from 'react-router-dom';\n"
            "function Page() { return null; }\n"
            "export const App = () => <Route path='/pages/:page_id' element={<Page />} />;\n"
        ),
        "pipeline/skills/fixture/SKILL.md": "# Summary\n",
        "backend/tests/test_source.py": "def test_source():\n    pass\n",
        "domains.json": "[]",
    }
    for relative, content in sources.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    return root / "domains.json"


# Filled from commit 8177609a94c8a42d324c6ef5f7126b0ab2942069 before extraction.
EXPECTED_DIGESTS = {
    "api-catalog.md": "e47cc0aba14401ba71e2a7a97f25465a818518fde0dcf70e1c0dfbe6b4372bbf",
    "backend-modules.md": "805e865549d9655b2df95ae1663b0f11990b9b7f0c9950d2425dc257ca479f9e",
    "configuration.md": "08069490ae60264b5153e77f19033cc4433ecd1d49c0242d18d860f4bad55073",
    "coverage.md": "1708b0a2bfdb50db5e7d8d27497b513e9ea617462021024f2c52713301d69b11",
    "data-model.md": "d92690250e44ca4a60c7a0baa46335ac50abc67e5fd018c75bb1c40e55ccde65",
    "frontend-catalog.md": "f8e14cad99fc91f869cc01786c375a328d7cd2531e628e05924ce793fc0e534c",
    "repository-inventory.md": "c51f9d19e8d4a3aa05cd69c2dfcbc8f1507ba6b3e6f5ea8b5359ce707210ad7b",
    "skills.md": "55597372921945f0cb83b0d0ff3ca356b9b714c22feb88b8f30f8a9f74221285",
    "tests.md": "ddbd94480ff66544b16b3f9b6a12019fd97d1a0336b94a6769e94a55dbe4364a",
}


def test_all_catalog_bytes_match_pre_extraction_baseline(tmp_path: Path) -> None:
    domains = write_catalog_fixture(tmp_path)
    outputs = build_outputs(tmp_path, tmp_path, domains)
    actual = {
        name: hashlib.sha256(content.encode("utf-8")).hexdigest()
        for name, content in outputs.items()
    }
    assert len(actual) == 9
    assert actual == EXPECTED_DIGESTS
    assert "do-not-publish" not in "".join(outputs.values())
