#!/usr/bin/env python3
"""Upgrade the isolated local Drupal clone to Drupal 11 deterministically."""

from __future__ import annotations

import argparse
import copy
import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any


PHP_BIN = Path("/opt/homebrew/opt/php@8.4/bin/php")
COMPOSER_BIN = Path("/opt/homebrew/bin/composer")
DEFAULT_PROJECT_ROOT = Path(__file__).resolve().parents[5]
DEFAULT_STAGE_ROOT = Path(
    os.environ.get(
        "DRUPAL_LOCAL_STAGE_ROOT",
        DEFAULT_PROJECT_ROOT / ".local" / "drupal-staging",
    )
).resolve()
DEFAULT_SITE_ROOT = DEFAULT_STAGE_ROOT / "site"
RETIRED_PACKAGES = (
    "drupal/file_delete_ui",
    "drupal/layout_builder_st",
)
STAGE_ONE_REQUIREMENTS = {
    "drupal/imageapi_optimize_resmushit": "^2.1@beta",
    "drupal/webform": "^6.3",
    "drush/drush": "^13",
    "mglaman/composer-drupal-lenient": "^2.0",
}
CORE_REQUIREMENTS = {
    "drupal/core-composer-scaffold": "^11",
    "drupal/core-project-message": "^11",
    "drupal/core-recommended": "^11",
}
LOG = logging.getLogger(__name__)


def run(
    command: list[str],
    *,
    cwd: Path,
    env: dict[str, str] | None = None,
    capture: bool = False,
    timeout: int = 1800,
) -> subprocess.CompletedProcess[str]:
    """Run one command and raise with a redacted command on failure."""
    LOG.info("Running %s", " ".join(command))
    result = subprocess.run(
        command,
        cwd=cwd,
        env=env,
        text=True,
        capture_output=capture,
        timeout=timeout,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip() if capture else ""
        raise RuntimeError(
            f"Command failed ({result.returncode}): {' '.join(command)}"
            + (f"\n{detail}" if detail else "")
        )
    return result


def assert_local_stage(site_root: Path) -> None:
    """Reject any target that is not the isolated loopback staging clone."""
    settings = site_root / "web" / "sites" / "default" / "settings.local.php"
    if not settings.is_file():
        raise RuntimeError(f"Missing local settings: {settings}")
    contents = settings.read_text(encoding="utf-8")
    required_markers = (
        "deployment_identifier'] = 'local-staging'",
        "'host' => '127.0.0.1'",
        "'port' => '3307'",
        "smtp_on'] = FALSE",
        "interval'] = 0",
    )
    missing = [marker for marker in required_markers if marker not in contents]
    if missing:
        raise RuntimeError(
            "Refusing to update a site without all local-stage safety markers"
        )
    expected = DEFAULT_SITE_ROOT.resolve()
    if site_root.resolve() != expected:
        raise RuntimeError(f"Refusing non-standard site root: {site_root}")


def configure_stage_one(manifest: dict[str, Any]) -> dict[str, Any]:
    """Return the Drupal 10 contributed-project preparation manifest."""
    updated = copy.deepcopy(manifest)
    requirements = updated.setdefault("require", {})
    for package in RETIRED_PACKAGES:
        requirements.pop(package, None)
    requirements.update(STAGE_ONE_REQUIREMENTS)

    require_dev = updated.setdefault("require-dev", {})
    require_dev["drupal/core-dev"] = "^10.6"
    require_dev["drupal/upgrade_status"] = "^4.3"

    config = updated.setdefault("config", {})
    config["discard-changes"] = True
    allow_plugins = config.setdefault("allow-plugins", {})
    allow_plugins["mglaman/composer-drupal-lenient"] = True
    allow_plugins["symfony/runtime"] = True
    allow_plugins["tbachert/spi"] = True

    extra = updated.setdefault("extra", {})
    extra["drupal-lenient"] = {
        "allowed-list": ["drupal/multilingual_menu_urls"]
    }
    return updated


def configure_stage_two(manifest: dict[str, Any]) -> dict[str, Any]:
    """Return the Drupal 11 core manifest."""
    updated = copy.deepcopy(manifest)
    updated.setdefault("require", {}).update(CORE_REQUIREMENTS)
    updated.setdefault("require-dev", {})["drupal/core-dev"] = "^11"
    return updated


def write_manifest(path: Path, manifest: dict[str, Any]) -> None:
    """Write Composer JSON atomically with stable formatting."""
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(manifest, indent=4, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def composer(site_root: Path, *arguments: str, capture: bool = False):
    """Run Composer under the required PHP runtime."""
    env = os.environ.copy()
    env["COMPOSER_MAX_PARALLEL_HTTP"] = "1"
    env["COMPOSER_MAX_PARALLEL_PROCESSES"] = "1"
    return run(
        [
            str(PHP_BIN),
            "-d",
            "memory_limit=2G",
            str(COMPOSER_BIN),
            *arguments,
        ],
        cwd=site_root,
        env=env,
        capture=capture,
    )


def drush(
    site_root: Path,
    php_env: dict[str, str],
    *arguments: str,
    capture: bool = False,
):
    """Run the Drush PHP entrypoint with inherited batch memory settings."""
    return run(
        [
            str(PHP_BIN),
            str(site_root / "vendor" / "drush" / "drush" / "drush.php"),
            "--root",
            str(site_root / "web"),
            *arguments,
        ],
        cwd=site_root,
        env=php_env,
        capture=capture,
        timeout=1800,
    )


def scalar(drush_result: subprocess.CompletedProcess[str]) -> str:
    """Return the final non-empty output line."""
    lines = [line.strip() for line in drush_result.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError("Expected a scalar Drush result")
    return lines[-1]


def installed_modules(
    site_root: Path, php_env: dict[str, str]
) -> set[str]:
    """Return enabled module machine names."""
    result = drush(
        site_root,
        php_env,
        "php:eval",
        "echo json_encode(array_keys(\\Drupal::config('core.extension')"
        "->get('module') ?? []));",
        capture=True,
    )
    return set(json.loads(scalar(result)))


def database_count(
    site_root: Path, php_env: dict[str, str], query: str
) -> int:
    """Run a scalar SQL count without exposing connection credentials."""
    result = drush(site_root, php_env, "sql:query", query, capture=True)
    return int(scalar(result))


def validate_patch(site_root: Path) -> None:
    """Ensure the MCP schema normalization patch is the reviewed version."""
    patch = site_root / "patches" / "mcp-toolslist-inputschema-fix.patch"
    contents = patch.read_text(encoding="utf-8") if patch.is_file() else ""
    if "Normalize inputSchema" not in contents or "array_merge" not in contents:
        raise RuntimeError(f"Missing or stale MCP patch: {patch}")


def update(site_root: Path) -> None:
    """Perform and validate the complete two-stage Drupal 11 update."""
    assert_local_stage(site_root)
    validate_patch(site_root)
    composer_json = site_root / "composer.json"

    with tempfile.TemporaryDirectory(prefix="drupal11-php-") as temp_dir:
        php_ini = Path(temp_dir) / "php.ini"
        php_ini.write_text(
            "memory_limit = 1024M\n"
            "max_execution_time = 0\n"
            "error_reporting = 24575\n",
            encoding="utf-8",
        )
        php_env = os.environ.copy()
        php_env["PHPRC"] = str(php_ini)

        translated_before = database_count(
            site_root,
            php_env,
            "SELECT COUNT(*) FROM menu_link_content_data "
            "WHERE translated_link_on = 1",
        )
        blocks_before = database_count(
            site_root,
            php_env,
            "SELECT COUNT(*) FROM config WHERE name LIKE 'block.block.%'",
        )

        drush(
            site_root,
            php_env,
            "sql:query",
            "TRUNCATE cache_container; TRUNCATE cache_discovery; "
            "TRUNCATE cache_config;",
        )
        drush(site_root, php_env, "state:set", "system.maintenance_mode", "1")
        active_modules = installed_modules(site_root, php_env)
        if "file_delete_ui" in active_modules:
            drush(site_root, php_env, "pm:uninstall", "file_delete_ui", "-y")
        active_modules = installed_modules(site_root, php_env)
        if "file_delete_ui" not in active_modules:
            drush(
                site_root,
                php_env,
                "php:eval",
                "\\Drupal::keyValue('system.schema')->delete('file_delete_ui');",
            )

        manifest = json.loads(composer_json.read_text(encoding="utf-8"))
        write_manifest(composer_json, configure_stage_one(manifest))
        composer(site_root, "patches-relock")
        composer(
            site_root,
            "update",
            "--with-all-dependencies",
            "--prefer-dist",
            "--no-interaction",
        )
        drush(site_root, php_env, "cache:rebuild")
        drush(site_root, php_env, "updatedb", "-y")
        drush(site_root, php_env, "cache:rebuild")
        drush(site_root, php_env, "pm:install", "upgrade_status", "-y")
        drush(
            site_root,
            php_env,
            "upgrade_status:analyze",
            "temenos",
            "--format=plain",
        )

        manifest = json.loads(composer_json.read_text(encoding="utf-8"))
        write_manifest(composer_json, configure_stage_two(manifest))
        composer(
            site_root,
            "update",
            "--with-all-dependencies",
            "--prefer-dist",
            "--no-interaction",
        )
        drush(site_root, php_env, "updatedb", "-y")
        drush(
            site_root,
            php_env,
            "php:eval",
            '$manager=\\Drupal::entityDefinitionUpdateManager(); '
            'if (!$manager->getEntityType("ai_agent_override")) {'
            '$definition=\\Drupal::entityTypeManager()'
            '->getDefinition("ai_agent_override"); '
            '$manager->installEntityType($definition);}',
        )
        drush(
            site_root,
            php_env,
            "sql:query",
            "TRUNCATE cache_container; TRUNCATE cache_discovery; "
            "TRUNCATE cache_config;",
        )
        drush(site_root, php_env, "cache:rebuild")

        plugin_counts = json.loads(
            scalar(
                drush(
                    site_root,
                    php_env,
                    "php:eval",
                    'echo json_encode(["blocks"=>count(\\Drupal::service('
                    '"plugin.manager.block")->getDefinitions()),'
                    '"formatters"=>count(\\Drupal::service('
                    '"plugin.manager.field.formatter")->getDefinitions())]);',
                    capture=True,
                )
            )
        )
        if plugin_counts["blocks"] <= 1 or plugin_counts["formatters"] <= 1:
            raise RuntimeError(f"Incomplete plugin discovery cache: {plugin_counts}")

        modules_after = installed_modules(site_root, php_env)
        translated_after = database_count(
            site_root,
            php_env,
            "SELECT COUNT(*) FROM menu_link_content_data "
            "WHERE translated_link_on = 1",
        )
        blocks_after = database_count(
            site_root,
            php_env,
            "SELECT COUNT(*) FROM config WHERE name LIKE 'block.block.%'",
        )
        if translated_after != translated_before:
            raise RuntimeError(
                "Translated menu URL count changed: "
                f"{translated_before} -> {translated_after}"
            )
        if blocks_after != blocks_before:
            raise RuntimeError(f"Block count changed: {blocks_before} -> {blocks_after}")
        forbidden = {
            "file_delete_ui",
            "layout_builder_st",
            "n8n_helper",
            "notion_bridge",
        }
        if forbidden & modules_after:
            raise RuntimeError(
                f"Retired modules are enabled: {sorted(forbidden & modules_after)}"
            )
        required = {
            "ai",
            "ai_agents",
            "imageapi_optimize_resmushit",
            "multilingual_menu_urls",
            "webform",
        }
        if not required <= modules_after:
            raise RuntimeError(
                f"Required modules are missing: {sorted(required - modules_after)}"
            )
        default_theme = scalar(
            drush(
                site_root,
                php_env,
                "config:get",
                "system.theme",
                "default",
                "--format=string",
                capture=True,
            )
        )
        if default_theme != "temenos":
            raise RuntimeError(f"Unexpected default theme: {default_theme}")

        changes = scalar(
            drush(
                site_root,
                php_env,
                "php:eval",
                "echo json_encode(\\Drupal::entityDefinitionUpdateManager()"
                "->getChangeSummary());",
                capture=True,
            )
        )
        if json.loads(changes) != []:
            raise RuntimeError(f"Pending entity definition changes: {changes}")

        drush(site_root, php_env, "updatedb:status")
        composer(site_root, "validate", "--no-interaction")
        composer(site_root, "audit")
        composer(site_root, "install", "--dry-run", "--no-interaction")
        drush(site_root, php_env, "state:set", "system.maintenance_mode", "0")
        drush(site_root, php_env, "cache:rebuild")
        drush(
            site_root,
            php_env,
            "status",
            "--fields=drupal-version,php-version,db-status,bootstrap",
        )

    LOG.info(
        "Drupal 11 local upgrade passed: translated URLs=%d, blocks=%d",
        translated_after,
        blocks_after,
    )


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--site-root",
        type=Path,
        default=DEFAULT_SITE_ROOT,
        help="Absolute path to the ignored local Drupal site clone.",
    )
    return parser.parse_args()


def main() -> int:
    """Run the local-only upgrade."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    args = parse_args()
    update(args.site_root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
