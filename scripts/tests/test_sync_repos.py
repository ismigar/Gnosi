"""Regression tests for the public Gnosi repository boundary."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "sync_repos.py"
SPEC = importlib.util.spec_from_file_location("sync_repos", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Could not load {SCRIPT_PATH}")
sync_repos = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync_repos)


class PublicManifestTests(unittest.TestCase):
    def test_source_pathspecs_do_not_select_broad_application_tree(self) -> None:
        pathspecs = sync_repos.source_pathspecs()

        self.assertIn("monorepo/apps/gnosi", pathspecs)
        self.assertNotIn("monorepo", pathspecs)
        self.assertNotIn("monorepo/apps", pathspecs)
        self.assertNotIn("monorepo/scripts", pathspecs)

    def test_existing_pathspecs_skip_absent_optional_entries(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            path = repo_root / "monorepo/apps/gnosi/app.py"
            path.parent.mkdir(parents=True)
            path.write_text("APP = 'gnosi'\n", encoding="utf-8")
            self._git(repo_root, "init", "-b", "main")
            self._git(repo_root, "config", "user.name", "Gnosi Sync Test")
            self._git(repo_root, "config", "user.email", "sync-test@example.invalid")
            self._git(repo_root, "add", ".")
            self._git(repo_root, "commit", "-m", "fixture")

            pathspecs = sync_repos.existing_source_pathspecs(repo_root, "main")

            self.assertEqual(pathspecs, ("monorepo/apps/gnosi",))

    def test_manifest_accepts_gnosi_and_shared_packages(self) -> None:
        manifest = sync_repos.validate_public_manifest(
            [
                ".github/workflows/documentation-pages.yml",
                "apps/gnosi/README.md",
                "LICENSE",
                "README.md",
                "packages/filesystem/package.json",
            ]
        )

        self.assertIn("apps/gnosi/README.md", manifest)
        self.assertIn("packages/filesystem/package.json", manifest)

    def test_manifest_rejects_unrelated_applications(self) -> None:
        required = [
            ".github/workflows/documentation-pages.yml",
            "apps/gnosi/README.md",
            "LICENSE",
            "README.md",
        ]
        for forbidden in (
            "apps/mcp-drupal-proxy/server.py",
            "apps/sandbox/package.json",
            "scripts/sync_notion_bulk.py",
            "temenos/composer.json",
        ):
            with self.subTest(forbidden=forbidden):
                with self.assertRaisesRegex(ValueError, "Invalid public manifest"):
                    sync_repos.validate_public_manifest([*required, forbidden])

    def test_source_manifest_maps_only_allowlisted_paths(self) -> None:
        manifest = sync_repos.public_manifest_from_source_paths(
            [
                "monorepo/.github/workflows/documentation-pages.yml",
                "monorepo/apps/gnosi/backend/server.py",
                "monorepo/apps/mcp-drupal-proxy/server.py",
                "monorepo/apps/sandbox/package.json",
                "monorepo/packages/filesystem/package.json",
                "monorepo/scripts/sync_notion_bulk.py",
                "temenos/composer.json",
            ]
        )

        self.assertEqual(
            manifest,
            (
                ".github/workflows/documentation-pages.yml",
                "apps/gnosi/backend/server.py",
                "packages/filesystem/package.json",
            ),
        )

    def test_manifest_requires_public_workflows_and_product_files(self) -> None:
        with self.assertRaisesRegex(ValueError, "missing required paths"):
            sync_repos.validate_public_manifest(["apps/gnosi/README.md"])

    def test_snapshot_preparation_excludes_unrelated_sources(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            files = {
                "monorepo/.github/workflows/documentation-pages.yml": "name: docs\n",
                "monorepo/apps/gnosi/app.py": "APP = 'gnosi'\n",
                "monorepo/apps/mcp-drupal-proxy/server.py": "PRIVATE = True\n",
                "monorepo/apps/sandbox/package.json": "{}\n",
                "monorepo/packages/filesystem/package.json": "{}\n",
                "monorepo/LICENSE": "AGPL\n",
                "monorepo/README.md": "# Gnosi\n",
                "monorepo/scripts/sync_notion_bulk.py": "PRIVATE = True\n",
                "temenos/composer.json": "{}\n",
            }
            for relative_path, content in files.items():
                path = repo_root / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")

            self._git(repo_root, "init", "-b", "main")
            self._git(repo_root, "config", "user.name", "Gnosi Sync Test")
            self._git(repo_root, "config", "user.email", "sync-test@example.invalid")
            self._git(repo_root, "add", ".")
            self._git(repo_root, "commit", "-m", "fixture")

            manifest = sync_repos.prepare_public_snapshot(repo_root)

            self.assertIn("apps/gnosi/app.py", manifest)
            self.assertIn("packages/filesystem/package.json", manifest)
            self.assertFalse((repo_root / "monorepo").exists())
            self.assertFalse((repo_root / "apps/mcp-drupal-proxy").exists())
            self.assertFalse((repo_root / "apps/sandbox").exists())
            self.assertFalse((repo_root / "scripts").exists())
            self.assertFalse((repo_root / "temenos").exists())

    @staticmethod
    def _git(repo_root: Path, *args: str) -> None:
        subprocess.run(
            ["git", *args],
            cwd=repo_root,
            check=True,
            capture_output=True,
            text=True,
        )


if __name__ == "__main__":
    unittest.main()
