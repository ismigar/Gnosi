#!/usr/bin/env python3
"""Backfill de vistes incrustades del clon de Notion (pestanyes 2..N que el clon v1 perdia).

El clon v1 només creava la PRIMERA vista de cada bloc `<database>` de Notion (les altres
pestanyes es perdien: «Cervell digital» 10→1, «Recursos» 13→1). Amb el fix multi-vista de
`notion_view_recreator`/`notion_clone`, aquest script fa l'import INCREMENTAL sense refer
el clon ni tocar el contingut editat:

  1. Escaneja el vault clonat (fitxers .md amb `gnosi-view:def`, fora de .history/.trash).
  2. Mapa pàgina del vault → pàgina de Notion (uuid5 del clon és one-way, així que re-enumera
     els ids de Notion: pàgines soltes de l'import-config + files de les BD via REST +
     search_pages com a fallback) i verifica per `clone_page_id`.
  3. Per cada pàgina: fetch MCP → blocs `<database>` → `build_clone_views` (TOTES les
     pestanyes reals, sense els gràfics "suggerits"; ids idèntics als del clon nou).
  4. RECONCILIA: al cos hi queda NOMÉS l'embed de l'àncora de cada bloc (les pestanyes
     pengen del camp `tabs` de l'àncora, com a Notion); s'upserten les vistes
     (POST /api/vault/views), s'esborren les de gràfic creades per error (DELETE) i es
     treuen del cos els defs apilats (PATCH /api/vault/pages/{id}).

Dry-run per defecte (informa, no escriu). `--apply` per escriure. Idempotent: re-executar
convergeix al mateix estat (ids deterministes).

Ús (des de l'arrel del checkout que porta el fix):
  .venv/bin/python pipeline/skills/notion_clone/scripts/backfill_notion_views.py \
      --vault-dir ~/Library/CloudStorage/OneDrive-UNED/Gnosi/Notion \
      --vault-id 3d2926f6-adfe-4d00-9c01-bae72978057e [--apply] [--only .Dashboards]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

GNOSI_ROOT = Path(__file__).resolve().parents[4]     # .../monorepo/apps/gnosi
sys.path.insert(0, str(GNOSI_ROOT))
# Secrets del backend VIU (tokens REST + MCP de Notion) — el natiu corre amb
# GNOSI_LOCAL_DATA=<repo principal>/local_data (cf. sh/run_native_dev.sh).
os.environ.setdefault(
    "GNOSI_LOCAL_DATA", str(Path.home() / "Projectes/monorepo/apps/gnosi/local_data"))

import httpx  # noqa: E402
import yaml  # noqa: E402

from backend.services import notion_mcp, notion_mcp_md, notion_clone  # noqa: E402
from backend.services import notion_view_recreator as nvr  # noqa: E402
from backend.services.notion_clone import clone_page_id, build_clone_views  # noqa: E402
from backend.services.notion_importer import NotionClient  # noqa: E402
from backend.services.integration_manager import integration_manager  # noqa: E402

EMBED_RE = re.compile(r'<!--\s*gnosi-view:def\s*\{"view_id":"([0-9a-f-]{36})"\}\s*-->')
SKIP_DIRS = {".history", ".trash", "Assets", "Biblioteca", ".gnosi"}


def log(msg: str) -> None:
    print(msg, flush=True)


# ---------------------------------------------------------------------------
# Vault: escaneig de pàgines amb embeds
# ---------------------------------------------------------------------------
def parse_frontmatter(text: str):
    m = re.match(r"^---\n(.*?)\n---\n?", text, re.DOTALL)
    if not m:
        return {}, text
    try:
        meta = yaml.safe_load(m.group(1)) or {}
    except Exception:
        meta = {}
    return meta, text[m.end():]


def scan_vault(vault_dir: Path, only: str | None):
    out = []
    for p in sorted(vault_dir.rglob("*.md")):
        rel = p.relative_to(vault_dir)
        if rel.parts and rel.parts[0] in SKIP_DIRS:
            continue
        if only and not str(rel).startswith(only):
            continue
        try:
            text = p.read_text(encoding="utf-8")
        except Exception:
            continue
        if "gnosi-view:def" not in text:
            continue
        meta, _ = parse_frontmatter(text)
        if not meta.get("id"):
            continue
        out.append({"path": p, "rel": str(rel), "id": str(meta["id"]),
                    "title": meta.get("title") or p.stem,
                    "table_id": meta.get("table_id") or "",
                    "embeds": EMBED_RE.findall(text)})
    return out


# ---------------------------------------------------------------------------
# Mapa clone_page_id → notion_id (el uuid5 és one-way: es re-enumeren els ids)
# ---------------------------------------------------------------------------
def build_notion_map(api: str, hdrs: dict, needed: set) -> dict:
    mapping: dict = {}

    def add(nid):
        cid = clone_page_id(nid)
        if cid in needed and cid not in mapping:
            mapping[cid] = str(nid)

    cfg = httpx.get(f"{api}/notion/import-config", headers=hdrs, timeout=30).json().get("config") or {}
    for nid in (cfg.get("loosePageTypes") or {}):
        add(nid)
    token = (integration_manager.get_raw("notion") or {}).get("token")
    if not token:
        raise RuntimeError("Sense token REST de Notion a integrations.json")
    rest = NotionClient(token)
    for db in (cfg.get("databases") or []):
        if len(mapping) == len(needed):
            break
        try:
            n = 0
            for row in rest.query_database(db["id"]):
                add(row.get("id"))
                n += 1
            log(f"  [map] BD «{db.get('title')}»: {n} files")
        except Exception as e:  # noqa: BLE001
            log(f"  [map] ERROR BD {db.get('title')}: {e}")
    missing = needed - set(mapping)
    if missing:
        log(f"  [map] {len(missing)} pàgines sense mapa; provo search_pages()…")
        try:
            for pg in rest.search_pages():
                add(pg.get("id"))
        except Exception as e:  # noqa: BLE001
            log(f"  [map] search_pages ha fallat: {e}")
    return mapping


# ---------------------------------------------------------------------------
# Reconciliació del contingut: per bloc, NOMÉS l'embed de l'àncora al cos
# (les altres pestanyes hi pengen pel camp `tabs` de l'àncora, com a Notion)
# ---------------------------------------------------------------------------
def remove_view_defs(content: str, ids: set) -> str:
    """Treu del contingut els `gnosi-view:def` (i el seu bloc snapshot
    `gnosi-view:result`, si el segueix) de les vistes indicades."""
    lines = content.split("\n")
    out, i = [], 0
    while i < len(lines):
        l = lines[i]
        if "gnosi-view:def" in l and any(vid in l for vid in ids):
            i += 1
            while i < len(lines) and not lines[i].strip():
                i += 1
            if i < len(lines) and lines[i].startswith("<!-- gnosi-view:result") \
                    and any(vid in lines[i] for vid in ids):
                while i < len(lines) and lines[i].strip() != "<!-- /gnosi-view:result -->":
                    i += 1
                i += 1
            continue
        out.append(l)
        i += 1
    text = "\n".join(out)
    return re.sub(r"\n{3,}", "\n\n", text)


def append_embed(content: str, embed: str) -> str:
    sep = "" if content.endswith("\n\n") else ("\n" if content.endswith("\n") else "\n\n")
    return content + sep + embed + "\n"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--vault-dir", required=True)
    ap.add_argument("--vault-id", required=True)
    ap.add_argument("--api", default="http://127.0.0.1:5002/api")
    ap.add_argument("--only", default=None, help="prefix relatiu (p. ex. '.Dashboards')")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--apply", action="store_true", help="escriu (per defecte: dry-run)")
    ap.add_argument("--state", default=None, help="fitxer JSONL de pàgines ja fetes (resume)")
    ap.add_argument("--ids", default=None,
                    help="processa NOMÉS aquests ids de pàgina del vault (separats per coma)")
    args = ap.parse_args()

    vault_dir = Path(os.path.expanduser(args.vault_dir))
    hdrs = {"X-Vault-Id": args.vault_id}
    api = args.api.rstrip("/")

    ok, reason = notion_mcp.healthcheck()
    if not ok:
        log(f"MCP de Notion no disponible: {reason}")
        return 1

    done_ids = set()
    state_path = Path(args.state) if args.state else None
    if state_path and state_path.exists():
        done_ids = {json.loads(l)["id"] for l in state_path.read_text().splitlines() if l.strip()}

    pages = scan_vault(vault_dir, args.only)
    if args.ids:
        wanted = {x.strip() for x in args.ids.split(",") if x.strip()}
        pages = [pg for pg in pages if pg["id"] in wanted]
    # Ordre: primer el que es veu (taulers, wiki), després les files de BD.
    rank = {".Dashboards": 0, "Wiki": 1}
    pages.sort(key=lambda pg: (rank.get(pg["rel"].split("/")[0], 2), pg["rel"]))
    if args.limit:
        pages = pages[:args.limit]
    log(f"Pàgines amb embeds: {len(pages)} (fetes prèviament: {len(done_ids)})")

    tables = httpx.get(f"{api}/vault/tables", headers=hdrs, timeout=60).json()
    tables = tables.get("tables", tables) if isinstance(tables, dict) else tables
    by_name = {}
    for t in tables:
        key = nvr._strip_icon(t.get("name"))
        if key:
            by_name[key] = t
    resolve = lambda n: by_name.get(nvr._strip_icon(n))  # noqa: E731

    needed = {pg["id"] for pg in pages if pg["id"] not in done_ids}
    log("Construint el mapa vault→Notion…")
    mapping = build_notion_map(api, hdrs, needed)
    log(f"  mapades {len(mapping)}/{len(needed)}")

    stats = {"pages": 0, "views_upserted": 0, "embeds_added": 0, "unmapped": 0,
             "mcp_empty": 0, "errors": []}
    for pg in pages:
        if pg["id"] in done_ids:
            continue
        nid = mapping.get(pg["id"])
        if not nid:
            stats["unmapped"] += 1
            log(f"[skip] sense mapa Notion: {pg['rel']}")
            continue
        host = nid.replace("-", "")
        page_md = ""
        for backoff in (0, 2, 4):
            if backoff:
                time.sleep(backoff)
            page_md = notion_mcp.fetch(nid)
            if page_md:
                break
        if not page_md:
            stats["mcp_empty"] += 1
            log(f"[err] fetch MCP buit: {pg['rel']}")
            continue
        block_ids = notion_mcp_md.extract_db_ids(page_md)
        try:
            text = pg["path"].read_text(encoding="utf-8")
        except Exception as e:  # noqa: BLE001
            stats["errors"].append({"page": pg["rel"], "error": f"read: {e}"})
            continue
        meta, content = parse_frontmatter(text)
        new_content = content
        page_changes = 0
        tag = "apply" if args.apply else "dry"
        for bid in block_ids:
            view_md = notion_mcp.fetch(bid)
            time.sleep(0.15)
            if not view_md:
                stats["errors"].append({"page": pg["rel"], "block": bid, "error": "fetch vista buit"})
                continue
            try:
                # gvs = pestanyes REALS (sense els gràfics "suggerits" de l'MCP);
                # gvs_all inclou els gràfics per poder esborrar els que un pas
                # anterior hagués creat.
                gvs = build_clone_views(host, pg["table_id"], bid, view_md, resolve)
                gvs_all = build_clone_views(host, pg["table_id"], bid, view_md, resolve,
                                            skip_types=())
            except Exception as e:  # noqa: BLE001
                stats["errors"].append({"page": pg["rel"], "block": bid, "error": str(e)})
                continue
            if not gvs:
                continue
            anchor = gvs[0]
            # Al COS només hi va l'embed de l'àncora: fora defs de pestanyes
            # apilades (run anterior) i de gràfics.
            drop_ids = ({g["id"] for g in gvs_all} | {g["id"] for g in gvs}) - {anchor["id"]}
            before = new_content
            new_content = remove_view_defs(new_content, drop_ids)
            if anchor["id"] not in EMBED_RE.findall(new_content):
                new_content = append_embed(new_content, nvr.view_embed(anchor["id"]))
                log(f"[{tag}] {pg['rel']}: bloc {bid[:8]}… àncora nova al final")
            if new_content != before:
                page_changes += 1
                tabs = [g["name"] for g in gvs[1:]]
                log(f"[{tag}] {pg['rel']}: bloc {bid[:8]}… 1 embed + {len(tabs)} pestanyes"
                    + (f" ({', '.join(tabs)})" if tabs else ""))
            if args.apply:
                for gv in gvs:   # upsert totes (l'àncora porta `tabs`)
                    r = httpx.post(f"{api}/vault/views", headers=hdrs, json=gv, timeout=60)
                    r.raise_for_status()
                    stats["views_upserted"] += 1
                # esborra del registry les vistes de gràfic creades per error
                for gid in sorted({g["id"] for g in gvs_all} - {g["id"] for g in gvs}):
                    dr = httpx.delete(f"{api}/vault/views/{gid}", headers=hdrs, timeout=60)
                    if dr.status_code < 300:
                        stats["chart_views_deleted"] = stats.get("chart_views_deleted", 0) + 1
            else:
                stats["views_upserted"] += len(gvs)
        if new_content != content and args.apply:
            r = httpx.patch(f"{api}/vault/pages/{pg['id']}", headers=hdrs,
                            json={"content": new_content}, timeout=120)
            r.raise_for_status()
        stats["embeds_added"] += page_changes
        stats["pages"] += 1
        if state_path and args.apply:
            with state_path.open("a") as f:
                f.write(json.dumps({"id": pg["id"], "rel": pg["rel"], "added": page_changes}) + "\n")
        time.sleep(0.15)

    log("\n=== RESUM ===")
    log(json.dumps({k: v for k, v in stats.items() if k != "errors"}, ensure_ascii=False))
    if stats["errors"]:
        log(f"errors ({len(stats['errors'])}):")
        for e in stats["errors"][:20]:
            log(f"  {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
