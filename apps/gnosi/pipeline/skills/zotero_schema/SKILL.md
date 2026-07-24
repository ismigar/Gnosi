# SKILL: Zotero Schema

Font de veritat dels **tipus d'ítem i camps** de Gnosi, derivada del
data schema oficial de Zotero. Gnosi NO depèn de l'app Zotero; només
incorpora el seu `schema.json` (data factual del data model) per evitar
mantenir a mà els mapejos Zotero↔CSL i les traduccions a múltiples idiomes.

> ID: ZOTERO-SCHEMA-20260528
> Stack: Python 3.10+ (stdlib only), Node (no cal)
> Pinned version: `42` · commit `62e983a2e575fe9b9a3677ad7c9772080b67a1e4` (2026-03-16)
> Source: https://github.com/zotero/zotero-schema

---

## Què genera

A partir de [`schema.json`](./schema.json) (pinned al repo, mai descarregat
en runtime), el build emet:

| Fitxer generat | Importat des de |
|---|---|
| `backend/services/zotero_schema.py` | `vault_routes.py` (substitueix `_RECURSOS_TYPE_TO_CSL` hardcoded) |
| `frontend/src/components/Vault/zoteroSchema.js` | `cslEngine.js` (substitueix `ITEM_TYPE_MAP` hardcoded) |

Constants exposades (mateixos noms a Py i JS):

- `SCHEMA_VERSION` — versió del schema (`42` actualment)
- `SCHEMA_SOURCE_SHA` — primers 16 chars del SHA-256 del fitxer pinned
- `ALL_ITEM_TYPES` — llista alfabètica dels 40 tipus (`book`, `journalArticle`, `preprint`, `dataset`, ...)
- `ZOTERO_TO_CSL_TYPE` — `{zoteroType: cslType}` (p.ex. `'book' → 'book'`, `'journalArticle' → 'article-journal'`)
- `ZOTERO_TYPE_LABELS` — `{locale: {zoteroType: label_traduit}}` per a `ca-AD`, `es-ES`, `en-GB`, `en-US`
- `LABEL_TO_ZOTERO_TYPE` — invers de l'anterior, per resoldre frontmatters que desin labels traduïts en lloc de claus canòniques

---

## Comandes

```bash
# Regenerar constants des del schema.json local (idempotent, determinista)
python3 pipeline/skills/zotero_schema/scripts/build_constants.py

# Actualitzar schema.json a l'última versió de zotero/zotero-schema
python3 pipeline/skills/zotero_schema/scripts/refresh_schema.py

# Actualitzar a un commit concret (per a hotfix o downgrade controlat)
python3 pipeline/skills/zotero_schema/scripts/refresh_schema.py --ref <SHA>
```

Després de `refresh_schema.py`, **sempre cal** executar `build_constants.py`
i actualitzar la línia "Pinned version" d'aquest mateix `SKILL.md`.

---

## Validació

`backend/tests/test_zotero_schema.py` comprova en CI:

1. **Idempotència del build:** regenerar amb el schema actual produeix
   exactament el mateix output que el commitat (no canvis sense saber-ho).
2. **Coherència Py↔JS:** `ALL_ITEM_TYPES` i les claus de `ZOTERO_TO_CSL_TYPE`
   són idèntiques als dos fitxers generats.
3. **Cobertura:** tots els valors d'`Item Type` que apareixen al Vault
   actual són resolubles via `ZOTERO_TO_CSL_TYPE` directe o via
   `LABEL_TO_ZOTERO_TYPE['ca-AD']`.

Si Zotero canvia el format de `schema.json`, el test (1) peta. Si la
cobertura cau (perquè un usuari ha posat un valor lliure al frontmatter),
el test (3) llista els valors orfes.

---

## Restriccions i edge cases

- **Llicència:** el repo `zotero/zotero-schema` no declara LICENSE
  explícita. El schema és representació factual del data model (no
  copyrightable per si mateix). Atribuïm la font al header dels fitxers
  generats. Si Zotero clarifiqués la llicència en el futur, revisar.
- **Determinisme del build:** claus ordenades alfabèticament. Diff
  estable entre commits encara que canviï l'ordre intern del JSON.
- **Pinning estricte:** la versió s'actualitza només via `refresh_schema.py`
  + commit explícit. Mai descàrrega remota en runtime ni en CI.
- **Múltiples CSL per Zotero:** alguns tipus Zotero apareixen sota més
  d'un `csl.types` (rar). El build agafa el primer alfabètic i emet
  warning per stderr. Vegis logs si l'usuari nota cites estranyes.
- **Locales mancants:** si el schema deixa sense traduir un tipus en
  algun locale, el label cau a la clau canònica anglesa.
- **Frontmatter heretat:** moltes pàgines del Vault desen labels
  catalans ("Article de revista acadèmica") en lloc de claus canòniques
  ("journalArticle"). `LABEL_TO_ZOTERO_TYPE['ca-AD']` resol aquests
  casos sense necessitat de migrar frontmatters.

---

## Cicle d'aprenentatge

| Data | Aprenentatge | Solució |
|---|---|---|
| 2026-05-28 | Hardcoded `ITEM_TYPE_MAP` + `_RECURSOS_TYPE_TO_CSL` a dos llocs (Py i JS); nous tipus Zotero no apareixien automàticament; risc de drift. | Skill `zotero_schema` (aquesta): font única commitada del schema oficial, build determinista cap a Py + JS. |
