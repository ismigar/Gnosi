"""Re-walk: reataca les subpàgines del clon de Notion al seu pare via `parent_id`.

Repara un clon fet ABANS del #689 (que ja escriu parent_id en clonar): el Wiki quedava
inflat amb totes les subpàgines aplanades. Cf. directiva `vault_subpages_hierarchy.md`.

Ús (des de l'arrel de l'app `monorepo/apps/gnosi`, amb el backend natiu engegat):
    .venv/bin/python pipeline/utils/rewalk_subpage_parents.py --vault-id <ID-DEL-VAULT-CLON>
    .venv/bin/python pipeline/utils/rewalk_subpage_parents.py --vault-id <ID> --apply

Sense `--apply` és DRY-RUN: només informa. L'id del vault surt de GET /api/vaults.

Com funciona (eficient, sense baixar arbres de blocs):
  1. NOTION: `search_pages()` retorna TOTES les pàgines amb el seu `parent` incrustat.
     Per cada pàgina es resol el PARE-PÀGINA pujant la cadena (page_id directe;
     block_id → owner del bloc, memoïtzat). Files de BD (parent database_id) i pàgines
     d'arrel (workspace) no tenen pare-pàgina → no es toquen.
  2. VAULT DEL CLON: GET /api/vault/pages (X-Vault-Id) → ids existents + parent_id actuals.
  3. Per cada parell (fill, pare) amb els DOS costats presents al clon (ids deterministes
     `clone_page_id` = uuid5) i parent_id absent o diferent → PATCH {parent_id}. El PATCH
     fa merge de metadata. Seqüencial amb pausa breu (el bulk client-side esgota el
     QueuePool, cf. memòria feedback_bulk_ops_server_side).

Idempotent i NOMÉS metadata: cap fitxer es mou de carpeta (la pertinença de la graella
by-table va per carpeta i no s'ha de tocar — cf. directiva).
"""
import argparse
import importlib.util
import json
import sys
import time
import uuid
from pathlib import Path

import httpx

APP = Path(__file__).resolve().parents[2]   # …/monorepo/apps/gnosi

# clone_page_id sense importar el paquet backend (notion_clone arrossega imports pesats):
# mateix namespace que backend/services/notion_clone.py (_CLONE_NS).
_CLONE_NS = uuid.UUID("6f0c9b2e-1a4d-5e6f-8a9b-000000000003")


def clone_page_id(notion_page_id: str) -> str:
    return str(uuid.uuid5(_CLONE_NS, "page:" + str(notion_page_id or "").replace("-", "")))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--vault-id", required=True, help="id del vault del clon (GET /api/vaults)")
    ap.add_argument("--backend", default="http://localhost:5002")
    ap.add_argument("--apply", action="store_true", help="aplica els PATCHes (per defecte, dry-run)")
    args = ap.parse_args()

    spec = importlib.util.spec_from_file_location(
        "notion_importer", APP / "backend/services/notion_importer.py")
    ni = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ni)

    token = json.load(open(APP / "local_data/secrets/integrations.json"))["notion"]["token"]
    client = ni.NotionClient(token)

    print("1) Cercant pàgines a Notion...", flush=True)
    pages = client.search_pages()
    print(f"   {len(pages)} pàgines", flush=True)

    block_owner_cache: dict = {}

    def parent_page_of(p):
        """Id de la pàgina-pare (o None si penja de BD/workspace o no es pot resoldre)."""
        parent = p.get("parent") or {}
        while True:
            t = parent.get("type")
            if t == "page_id":
                return parent["page_id"]
            if t == "block_id":
                bid = parent["block_id"]
                if bid in block_owner_cache:
                    parent = block_owner_cache[bid]
                else:
                    try:
                        blk = client.get_block(bid)
                    except Exception as e:  # noqa: BLE001
                        print(f"   ! bloc {bid} irresoluble: {e}", flush=True)
                        return None
                    parent = blk.get("parent") or {}
                    block_owner_cache[bid] = parent
                continue
            return None   # database_id, workspace, desconegut

    print("2) Resolent parells (fill → pare)...", flush=True)
    pairs = {}
    for p in pages:
        pp = parent_page_of(p)
        if pp:
            pairs[p["id"]] = pp
    print(f"   {len(pairs)} pàgines amb pare-pàgina a Notion", flush=True)

    print("3) Llegint el vault del clon...", flush=True)
    H = {"X-Vault-Id": args.vault_id}
    r = httpx.get(f"{args.backend}/api/vault/pages", headers=H, timeout=180)
    r.raise_for_status()
    vault_pages = r.json()
    if isinstance(vault_pages, dict):
        vault_pages = vault_pages.get("pages", [])
    vp_by_id = {p["id"]: p for p in vault_pages}
    print(f"   {len(vault_pages)} pàgines al vault del clon", flush=True)
    if not vault_pages:
        print("   VAULT BUIT O IL·LEGIBLE — atura't (OneDrive encara hidratant?).")
        return 2

    print("4) Calculant PATCHes...", flush=True)
    todo, ja_be, sense_fill, sense_pare = [], 0, 0, 0
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

    print(f"   a reparar: {len(todo)} | ja correctes: {ja_be} | "
          f"fill no clonat: {sense_fill} | pare no clonat: {sense_pare}", flush=True)
    for cid, pid, ct, pt in todo[:15]:
        print(f"   · «{ct}» → penjarà de «{pt}»")
    if len(todo) > 15:
        print(f"   … i {len(todo) - 15} més")

    if not args.apply:
        print("\nDRY-RUN (res escrit). Executa amb --apply per aplicar.")
        return 0

    print("5) Aplicant PATCHes (seqüencial)...", flush=True)
    ok = err = 0
    for i, (cid, pid, ct, pt) in enumerate(todo):
        try:
            rr = httpx.patch(f"{args.backend}/api/vault/pages/{cid}",
                             headers={**H, "Content-Type": "application/json"},
                             json={"parent_id": pid}, timeout=60)
            if rr.status_code == 200:
                ok += 1
            else:
                err += 1
                print(f"   ! {rr.status_code} «{ct}»: {rr.text[:120]}", flush=True)
        except Exception as e:  # noqa: BLE001
            err += 1
            print(f"   ! excepció «{ct}»: {e}", flush=True)
        if i % 25 == 24:
            print(f"   ...{i + 1}/{len(todo)}", flush=True)
        time.sleep(0.05)

    print(f"\nFET: {ok} reparades, {err} errors, {ja_be} ja eren correctes.")
    return 0 if err == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
