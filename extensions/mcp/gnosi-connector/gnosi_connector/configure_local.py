"""Bootstrap a private profile on a loopback-only, personal Gnosi installation."""

import argparse
import asyncio
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from .client import Config, GnosiClient, origin, segment


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:5002")
    parser.add_argument("--vault", required=True, help="Exact vault name or slug")
    parser.add_argument("--enable-writes", action="store_true", help="Explicitly authorize read,write instead of read-only")
    parser.add_argument("--directory", required=True, type=Path, help="New private directory outside Git")
    args = parser.parse_args()
    scopes = "read,write" if args.enable_writes else "read"
    base = origin(args.base_url)
    if urlsplit(base).hostname not in {"localhost", "127.0.0.1", "::1"}:
        parser.error("Automatic setup is only available on loopback; use Gnosi's token UI remotely.")
    directory = args.directory.resolve()
    profile_path = directory / "profile.json"
    token_path = directory / "gnosi-token"
    if directory.exists():
        parser.error("The destination already exists; reuse its profile or select a new directory.")
    created_token_id = None
    with httpx.Client(base_url=base, timeout=20, follow_redirects=False, trust_env=False) as http:
        try:
            health = http.get("/api/health")
            health.raise_for_status()
            status = health.json()
            if status.get("require_auth") is not False or status.get("gnosi_mode") != "personal":
                parser.error("Use Gnosi's token settings to configure this authenticated/organization install.")
            response = http.get("/api/vaults")
            response.raise_for_status()
            matches = [v for v in response.json()["vaults"]
                       if args.vault.casefold() in {str(v.get("name", "")).casefold(),
                                                    str(v.get("slug", "")).casefold()}]
            if len(matches) != 1:
                parser.error("The vault name must match exactly one registered vault.")
            vault = matches[0]
            slug = segment(vault["slug"])
            directory.mkdir(parents=True, mode=0o700)
            response = http.post("/api/tokens", headers={"X-Vault-ID": vault["id"]},
                                 json={"name": f"Gnosi ChatGPT ({slug}; {scopes})", "scopes": scopes})
            response.raise_for_status()
            token = response.json()
            created_token_id = token["id"]
            with os.fdopen(os.open(token_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
                handle.write(token["token"])
            config = Config(base, slug, token["token"])
            asyncio.run(GnosiClient(config).authorize(write=args.enable_writes))
            asyncio.run(GnosiClient(config).pages(limit=1))
            profile = {"GNOSI_BASE_URL": base, "GNOSI_VAULT_SLUG": slug,
                       "GNOSI_TOKEN_FILE": str(token_path)}
            with os.fdopen(os.open(profile_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
                json.dump(profile, handle, indent=2)
                handle.write("\n")
        except Exception:
            if created_token_id:
                try:
                    http.delete("/api/tokens/" + segment(created_token_id)).raise_for_status()
                except Exception:
                    parser.exit(1, "Setup failed; revoke the newly created Gnosi ChatGPT token in Gnosi settings.\n")
            parser.exit(1, "Setup failed; no token value was logged. Check Gnosi and destination permissions.\n")
    print(f"Verified vault: {slug}\nPrivate profile: {profile_path}\nToken stored locally; scope: {scopes}")


if __name__ == "__main__":
    main()
