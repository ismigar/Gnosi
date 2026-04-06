import os
from typing import Dict, Optional

from ..domain.auth import AuthSource


def _resolve_ref(ref, env: Dict[str, str]) -> Optional[str]:
    if isinstance(ref, str):
        return env.get(ref)

    ref_type = ref.get("type")
    if ref_type == "env":
        return env.get(ref.get("name", ""))

    if ref_type in ["file", "exec"]:
        return None

    return None


def resolve_auth_secret(
    auth: AuthSource,
    provider_id: str,
    env: Optional[Dict[str, str]] = None,
    profiles: Optional[Dict[str, Dict[str, str]]] = None,
    profile_name: Optional[str] = None,
) -> AuthSource:
    merged_env = dict(os.environ)
    merged_env.update(env or {})

    normalized_provider_id = "".join(c if c.isalnum() else "_" for c in provider_id.upper())
    env_key = f"{normalized_provider_id}_API_KEY"

    env_value = merged_env.get(env_key)
    if env_value:
        return AuthSource(mode="api_key", value=env_value, ref=auth.ref)

    profile_bucket = (profiles or {}).get(profile_name or "", {})
    profile_value = profile_bucket.get(provider_id) or profile_bucket.get(env_key)
    if profile_value:
        return AuthSource(mode="api_key", value=profile_value, ref=auth.ref)

    if auth.ref:
        ref_value = _resolve_ref(auth.ref, merged_env)
        if ref_value:
            return AuthSource(mode="api_key", value=ref_value, ref=auth.ref)

    return auth
