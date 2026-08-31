"""Re-walk: reattaches the Notion clone's subpages to their parent via `parent_id`.

Fixes a clone made BEFORE #689 (which already writes parent_id when cloning): the Wiki was
left inflated with all subpages flattened out. Cf. the `vault_subpages_hierarchy.md` directive.

Usage (from the root of the `Gnosi` app, with the native backend running):
    .venv/bin/python pipeline/utils/rewalk_subpage_parents.py --vault-id <CLONE-VAULT-ID>
    .venv/bin/python pipeline/utils/rewalk_subpage_parents.py --vault-id <ID> --apply

Without `--apply` it's a DRY-RUN: it only reports. The vault id comes from GET /api/vaults.

How it works (efficient, without downloading block trees):
  1. NOTION: `search_pages()` returns ALL pages with their `parent` embedded.
     For each page, the PARENT PAGE is resolved by walking up the chain (direct page_id;
     block_id → block owner, memoized). DB rows (parent database_id) and root
     pages (workspace) have no parent page → they're left untouched.
  2. CLONE VAULT: GET /api/vault/pages (X-Vault-Id) → existing ids + current parent_id.
  3. For each (child, parent) pair with BOTH sides present in the clone (deterministic ids
     `clone_page_id` = uuid5) and parent_id absent or different → PATCH {parent_id}. The PATCH
     merges metadata. Sequential with a short pause (client-side bulk exhausts the
     QueuePool, cf. memory feedback_bulk_ops_server_side).

Idempotent and metadata-ONLY: no file is moved between folders (the by-table grid's
folder membership must not be touched — cf. directive).
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import uuid
from collections.abc import Mapping, Sequence
from pathlib import Path

import httpx

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

# clone_page_id without importing the backend package (notion_clone pulls in heavy imports):
# same namespace as backend/services/notion_clone.py (_CLONE_NS).
_CLONE_NS = uuid.UUID("6f0c9b2e-1a4d-5e6f-8a9b-000000000003")


class _Arguments(argparse.Namespace):
    vault_id: str
    backend: str
    apply: bool


def _record(value: object) -> Mapping[object, object]:
    """Validate only traversed containers, preserving all opaque metadata."""
    if not isinstance(value, Mapping):
        raise TypeError("Notion/vault page data must be a mapping")
    return value


def _text(value: object) -> str:
    if not isinstance(value, str):
        raise TypeError("Notion/vault identifiers and tokens must be strings")
    return value


def _auth_headers() -> dict[str, str]:
    """`Authorization: Bearer` from GNOSI_API_TOKEN, when one is configured.

    Unauthenticated calls work only while the backend still falls back to the
    legacy account. Once `GNOSI_REQUIRE_AUTH` is on they get a 401, so this
    script needs a Personal Access Token: create one in Settings and export it
    as GNOSI_API_TOKEN. Absent, nothing is sent and the behaviour is unchanged.
    """
    token = os.environ.get("GNOSI_API_TOKEN", "").strip()
    return {"Authorization": f"Bearer {token}"} if token else {}


def clone_page_id(notion_page_id: str) -> str:
    return str(uuid.uuid5(_CLONE_NS, "page:" + str(notion_page_id or "").replace("-", "")))


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--vault-id", required=True, help="clone vault id (GET /api/vaults)")
    ap.add_argument("--backend", default="http://localhost:5002")
    ap.add_argument(
        "--apply", action="store_true", help="apply the PATCH requests (dry-run by default)"
    )
    args = ap.parse_args(argv, namespace=_Arguments())

    # Same credential contract as backend/api/notion_routes.py: get_raw resolves
    # secure-store references, using canonical configured data paths. Import
    # lazily so CLI help and pure ID helpers do not initialize credentials/data.
    from backend.services.integration_manager import integration_manager
    from backend.services.notion_importer import NotionClient

    raw_integration: object = integration_manager.get_raw("notion")
    token = _text(_record(raw_integration)["token"])
    client = NotionClient(token)

    print("1) Searching for pages in Notion...", flush=True)
    pages = client.search_pages()
    print(f"   {len(pages)} pages", flush=True)

    block_owner_cache: dict[str, Mapping[object, object]] = {}

    def parent_page_of(p: Mapping[object, object]) -> str | None:
        """Id of the parent page (or None if it hangs off a DB/workspace or can't be resolved)."""
        parent = _record(p.get("parent") or {})
        while True:
            t = parent.get("type")
            if t == "page_id":
                return _text(parent["page_id"])
            if t == "block_id":
                bid = _text(parent["block_id"])
                if bid in block_owner_cache:
                    parent = block_owner_cache[bid]
                else:
                    try:
                        blk = client.get_block(bid)
                    except Exception as e:  # noqa: BLE001
                        print(f"   ! could not resolve block {bid}: {e}", flush=True)
                        return None
                    parent = _record(blk.get("parent") or {})
                    block_owner_cache[bid] = parent
                continue
            return None  # database_id, workspace, unknown

    print("2) Resolving child → parent pairs...", flush=True)
    pairs: dict[str, str] = {}
    for raw_page in pages:
        p = _record(raw_page)
        pp = parent_page_of(p)
        if pp:
            pairs[_text(p["id"])] = pp
    print(f"   {len(pairs)} pages with a parent page in Notion", flush=True)

    print("3) Reading the clone vault...", flush=True)
    H = {"X-Vault-Id": args.vault_id, **_auth_headers()}
    r = httpx.get(f"{args.backend}/api/vault/pages", headers=H, timeout=180)
    r.raise_for_status()
    payload: object = r.json()
    if isinstance(payload, dict):
        payload = payload.get("pages", [])
    if not isinstance(payload, list):
        raise TypeError("Vault pages response must be a list or an object containing pages")
    vault_pages = [_record(page) for page in payload]
    vp_by_id = {_text(page["id"]): page for page in vault_pages}
    print(f"   {len(vault_pages)} pages in the clone vault", flush=True)
    if not vault_pages:
        print("   EMPTY OR UNREADABLE VAULT — stopping (is OneDrive still hydrating it?).")
        return 2

    print("4) Calculating PATCH requests...", flush=True)
    todo: list[tuple[str, str, object, object]] = []
    ja_be, sense_fill, sense_pare = 0, 0, 0
    for nchild, nparent in pairs.items():
        cid, pid = clone_page_id(nchild), clone_page_id(nparent)
        child = vp_by_id.get(cid)
        if child is None:
            sense_fill += 1
            continue
        if pid not in vp_by_id:
            sense_pare += 1
            continue
        if (child.get("parent_id") or "") == pid:
            ja_be += 1
            continue
        todo.append((cid, pid, child.get("title") or "?", vp_by_id[pid].get("title") or "?"))

    print(
        f"   to repair: {len(todo)} | already correct: {ja_be} | "
        f"child not cloned: {sense_fill} | parent not cloned: {sense_pare}",
        flush=True,
    )
    for cid, pid, ct, pt in todo[:15]:
        print(f"   · '{ct}' → will be attached to '{pt}'")
    if len(todo) > 15:
        print(f"   … and {len(todo) - 15} more")

    if not args.apply:
        print("\nDRY-RUN (nothing written). Run with --apply to apply the changes.")
        return 0

    print("5) Applying PATCH requests sequentially...", flush=True)
    ok = err = 0
    for i, (cid, pid, ct, pt) in enumerate(todo):
        try:
            rr = httpx.patch(
                f"{args.backend}/api/vault/pages/{cid}",
                headers={**H, "Content-Type": "application/json"},
                json={"parent_id": pid},
                timeout=60,
            )
            if rr.status_code == 200:
                ok += 1
            else:
                err += 1
                print(f"   ! {rr.status_code} «{ct}»: {rr.text[:120]}", flush=True)
        except Exception as e:  # noqa: BLE001
            err += 1
            print(f"   ! exception for '{ct}': {e}", flush=True)
        if i % 25 == 24:
            print(f"   ...{i + 1}/{len(todo)}", flush=True)
        time.sleep(0.05)

    print(f"\nDONE: {ok} repaired, {err} errors, {ja_be} already correct.")
    return 0 if err == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
