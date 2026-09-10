"""Exercise genogram schemas using only the relocated desktop resource plan."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path
from textwrap import dedent

from desktop.scripts import backend_resources as policy
from scripts.ci.pre_pr import isolated_environment

ROOT = Path(__file__).resolve().parents[2]


def test_relocated_genogram_schemas_keep_localized_options(tmp_path: Path) -> None:
    plan = policy.build_plan(ROOT)
    payload = tmp_path / "relocated bundle" / "_internal"
    for name in plan.module_files + plan.resources:
        destination = payload / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, destination)

    environment = isolated_environment(os.environ, tmp_path)
    result = subprocess.run(
        (
            sys.executable, "-I", "-c",
            dedent("""\
                import sys
                from pathlib import Path

                root = Path(sys.argv[1])
                sys.path.insert(0, str(root))
                from backend.domains.genograms import schema

                assert Path(schema.__file__).is_relative_to(root)
                expected = {
                    'ca': ('Persona', 'Parella o unió'),
                    'en': ('Person', 'Partnership or union'),
                    'es': ('Persona', 'Pareja o unión'),
                    'fr': ('Personne', 'Couple ou union'),
                }
                for locale, labels in expected.items():
                    for kind, label in zip(('people', 'relations'), labels):
                        table = schema.make_table(kind, locale)
                        kind_id = schema.field_id(kind, 'kind')
                        prop = next(p for p in table['properties'] if p['id'] == kind_id)
                        assert prop['default'] == label
                        assert prop['options'][0]['name'] == label
                """),
            str(payload),
        ),
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert result.returncode == 0, result.stderr
