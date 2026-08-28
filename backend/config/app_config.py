# config/app_config.py
import yaml
import os
import logging
from pathlib import Path
from collections.abc import Mapping
from typing import Any, cast
from .env_config import get_env, load_env
from .paths_config import get_paths
from .schema_keys import get_schema_keys

log = logging.getLogger(__name__)

DEFAULT_INTERFACE_LANGUAGE = "en"
SUPPORTED_INTERFACE_LANGUAGES = frozenset({"ca", "en", "es", "fr"})
ENV_PROVIDER_MIGRATIONS = {
    "OPENAI_API_KEY": ("openai", "__keychain__:openai_api_key"),
    "GROQ_API_KEY": ("groq", "__keychain__:groq_api_key"),
    "ANTHROPIC_API_KEY": ("anthropic", "__keychain__:anthropic_api_key"),
    "OPENROUTER_API_KEY": ("openrouter", "__keychain__:openrouter_api_key"),
    "GOOGLE_API_KEY": ("google", "__keychain__:google_api_key"),
}
ConfigDict = dict[str, Any]


def normalize_interface_language(value: object) -> str:
    """Return a supported interface language or the English default."""
    language = str(value or "").strip().split("-", 1)[0].lower()
    return language if language in SUPPORTED_INTERFACE_LANGUAGES else DEFAULT_INTERFACE_LANGUAGE


def deep_merge(dict1: ConfigDict, dict2: ConfigDict) -> ConfigDict:
    """Recursively merges dict2 into dict1."""
    if not isinstance(dict1, dict) or not isinstance(dict2, dict):
        return dict2
    for k, v in dict2.items():
        if k in dict1 and isinstance(dict1[k], dict) and isinstance(v, dict):
            deep_merge(cast(ConfigDict, dict1[k]), cast(ConfigDict, v))
        else:
            dict1[k] = v
    return dict1


def apply_env_provider_migration(
    params: ConfigDict,
    environ: Mapping[str, str] | None = None,
) -> bool:
    """Add legacy environment-backed providers unless explicitly disconnected.

    Provider deletion cannot remove a LaunchAgent or ``.env`` variable. The
    persisted ``disconnected_providers`` tombstone therefore prevents the
    legacy migration from recreating a provider on every config load.
    """
    environ = os.environ if environ is None else environ
    ai_cfg = cast(ConfigDict, params.setdefault("ai", {}))
    providers = cast(ConfigDict, ai_cfg.setdefault("providers", {}))
    disconnected = {
        str(provider).strip().lower()
        for provider in (ai_cfg.get("disconnected_providers") or [])
        if str(provider).strip()
    }

    migrated = False
    for env_var, (provider_id, credential_ref) in ENV_PROVIDER_MIGRATIONS.items():
        if not environ.get(env_var) or provider_id in disconnected:
            continue
        provider_cfg = cast(ConfigDict, providers.setdefault(provider_id, {}))
        if not provider_cfg.get("credential_ref"):
            provider_cfg["credential_ref"] = credential_ref
            migrated = True
    return migrated


class Config:
    def __init__(
        self,
        params: ConfigDict | None,
        params_source: Path,
        strict_env: bool = True,
    ) -> None:
        self.hf: ConfigDict = {}
        if params is None:
            params = {}

        self.params: ConfigDict = params
        self.params_source: Path = params_source

        # Load YAML sub-dictionaries.
        self.ai: ConfigDict = cast(ConfigDict, params.get("ai", {}))
        self.graph: ConfigDict = cast(ConfigDict, params.get("graph", {}))
        self.colors: ConfigDict = cast(ConfigDict, params.get("colors", {}))
        self.input_files: ConfigDict = cast(ConfigDict, params.get("input_files", {}))
        self.mapping: ConfigDict = cast(ConfigDict, params.get("mapping", {}))
        self.settings: ConfigDict = dict(cast(ConfigDict, params.get("settings") or {}))
        self.settings["language"] = normalize_interface_language(self.settings.get("language"))
        self.params["settings"] = self.settings

        # Determine Gnosi mode (personal or organization).
        self.gnosi_mode = os.environ.get("GNOSI_MODE") or self.settings.get(
            "gnosi_mode", "personal"
        )

        # Load paths with optional overrides from params.yaml.
        self.paths: dict[str, Path | None] = get_paths(params.get("paths", {}))

    def get(self, key: str, default: Any = None) -> Any:
        return self.params.get(key, default)


def _active_params_path() -> Path | None:
    """Resolve the request-local Vault configuration without loading config again."""
    try:
        from backend.services.context_vars import active_vault_path

        active = active_vault_path.get()
        return Path(active) / ".gnosi" / "params.yaml" if active else None
    except Exception:
        return None


def _exists_tolerant(path: Path | None) -> bool:
    """Treat unavailable cloud placeholders as absent configuration files."""
    if path is None:
        return False
    try:
        return path.exists()
    except OSError as error:
        log.warning(
            "params.yaml is unreadable (OneDrive placeholder?): %s → %s",
            path,
            error,
        )
        return False


def _user_params_path(
    params: ConfigDict,
    *,
    local_path: Path,
    home_path: Path,
    active_path: Path | None,
) -> Path | None:
    """Select the user configuration with the historical precedence rules."""
    if _exists_tolerant(active_path):
        return active_path

    environment_vault = os.environ.get("DIGITAL_BRAIN_VAULT_PATH")
    if environment_vault:
        vault_params = Path(environment_vault) / ".gnosi" / "params.yaml"
        if _exists_tolerant(vault_params):
            return vault_params
    elif _exists_tolerant(home_path):
        return home_path

    vault_raw = (params.get("paths") or {}).get("vault")
    if not vault_raw:
        return None
    vault_params = Path(vault_raw) / ".gnosi" / "params.yaml"
    if _exists_tolerant(vault_params) and vault_params != local_path:
        return vault_params
    return None


def _merge_user_params(
    params: ConfigDict,
    params_path: Path,
    user_params_path: Path | None,
) -> tuple[ConfigDict, Path]:
    """Merge an available user file while tolerating cloud hydration races."""
    if user_params_path is None:
        return params, params_path
    try:
        with user_params_path.open("r", encoding="utf-8") as handle:
            loaded = yaml.safe_load(handle) or {}
            user_params = cast(ConfigDict, loaded) if isinstance(loaded, dict) else {}
        return deep_merge(params, user_params), user_params_path
    except OSError as error:
        log.warning(
            "params.yaml became unreadable while opening (OneDrive placeholder?): %s → %s",
            user_params_path,
            error,
        )
        return params, params_path


def _persist_provider_migration(params: ConfigDict, params_path: Path) -> None:
    """Persist environment-provider migration through the atomic writer."""
    if not apply_env_provider_migration(params):
        return
    try:
        from backend.utils.safe_io import safe_write_text

        yaml_text = yaml.dump(params, default_flow_style=False, allow_unicode=True)
        safe_write_text(params_path, yaml_text)
    except Exception as error:
        log.error("Error saving migrated configuration: %s", error)


def load_params(strict_env: bool = True) -> Config:
    """
        Loads params.yaml and returns a Config object.
    Priority:
    1. DIGITAL_BRAIN_VAULT_PATH/.gnosi/params.yaml
    2. ~/.gnosi/params.yaml
    3. Gnosi/config/params.yaml (Base/Default)

    """
    load_env()

    local_path = Path(__file__).parents[2] / "config" / "params.yaml"
    home_path = Path.home() / ".gnosi" / "params.yaml"

    # ── 1. Load the local base configuration ──
    params: ConfigDict = {}
    if local_path.exists():
        with open(local_path, "r", encoding="utf-8") as f:
            loaded = yaml.safe_load(f) or {}
            params = cast(ConfigDict, loaded) if isinstance(loaded, dict) else {}

    params_path = local_path

    # ── 2. Determine the user source (active vault > vault environment > home) ──
    active_params_path = _active_params_path()
    user_params_path = _user_params_path(
        params,
        local_path=local_path,
        home_path=home_path,
        active_path=active_params_path,
    )
    params, params_path = _merge_user_params(params, params_path, user_params_path)

    # The active vault's params.yaml is always the save target (and is created
    # if needed), even when values were inherited. Editing a new vault's graph,
    # colors, or other settings therefore writes to its own .gnosi directory.
    if active_params_path:
        params_path = active_params_path

    _persist_provider_migration(params, params_path)

    return Config(params, params_path, strict_env=strict_env)
