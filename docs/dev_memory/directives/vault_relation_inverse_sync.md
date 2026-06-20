# Directiva: Sincronització de relacions inverses al Vault

## Problema (diagnòstic 2026-06-20)

Les relacions entre taules del Vault són **bidireccionals a l'esquema** però el
backend **NO sincronitza els dos costats**. El `PATCH /api/vault/pages` fa
`metadata.update(...)` i prou: no propaga el canvi a la pàgina de l'altre costat
(`vault_routes.py` ~6752-7002). No existeix `related_property_id` ni cap job de
sincronització.

Conseqüència: una pàgina d'Àrea pot llistar registres al seu camp **directe**
(p.ex. `📀 Recursos`) que NO tenen l'àrea al seu camp **invers** (`📀 Àrees`).
Les vistes incrustades filtren pel camp **invers** (`{field:"📀 Àrees",
value:"this"}` → resol a l'`host_page_id`, vegeu `view_snapshot.py:apply_filter`),
així que **surten buides** encara que el camp directe estigui ple.

Cas detectat: àrea «(Auto)cura i cultiu interior»
(`1d2268e5-2714-8000-a413-c23a457bc7de`): 4 Recursos + 2 Extractes als camps
directes, **0** registres amb l'invers cap a ella → vistes buides. Sistèmic:
totes les àrees tenen desincronització en algun grau (Notes/Extractes invers
buit a gairebé totes).

## Model de dades (registry `BD/vault_db_registry.json`)

- Camps `type:"relation"` tenen `relation_database_id` (taula destí) i
  `cardinality`. **No** tenen `related_property_id` → l'aparellament
  directe↔invers és **per taula destí**.
- Els noms al registry de la taula **Àrees** van SENSE prefix (`Recursos`,
  `Extractes`); al **frontmatter / response** (`by-table`) van amb prefix i
  emojis (`📀 Recursos`, `📀 🗒️ Extractes`). Les altres taules ja porten el `📀`
  al registry (`📀 Àrees`, `📀 Àrea`). → Per aparellar, **normalitzar** el nom
  (treure emojis/espais inicials, minúscules).
- Format canònic d'un ítem de relació al `.md`: `'[[Títol|<id>]]'`
  (`services/relation_links.py`). `parse_frontmatter` retorna **ids nets**;
  `save_page_md` → `decorate_relation_wikilinks` decora `id → [[Títol|id]]`.

### Parells directe→invers amb dades (Àrees)
| Camp directe (Àrea) | Taula destí | Camp invers |
|---|---|---|
| `📀 Recursos` | Recursos `8c80f2a8…` | `📀 Àrees` |
| `📀 🗒️ Extractes` | Cervell `431979bd…` | `📀 Àrea` |
| `📀 Projectes` | Projectes `8e8d3c8d…` | `📀 Àrea` |

**Ambigus → EXCLOURE:** `Experiència professional` i `Titulacions` apunten
TOTES DUES a `102268e5…baaffee` (no es pot triar invers sense
`related_property_id`); `Subàrees` és auto-relació (Àrees→Àrees). Tots buits als
camps directes → no perdem res excloent-los.

## Procediment de sincronització (directe → invers)

Eina: `pipeline/sandbox/sync_inverse_relations.py` (idempotent).

1. **Dry-run per defecte.** Llegeix `by-table` d'Àrees i de cada taula destí
   (ids nets, response names). Per cada parell ben definit (taula destí amb UN
   sol camp invers cap a Àrees), per cada àrea i cada registre del seu camp
   directe: si `area_id NOT IN registre[camp_invers]` → apunta el canvi.
   Agrupa per registre. Imprimeix recompte i mostra exacta.
2. **Backup** (en `--apply`): `tar` de les carpetes destí a
   `~/.gnosi-local/backups/<ts>/` ABANS d'escriure.
3. **Aplica** via `PATCH /api/vault/pages/{registre_id}` amb
   `{camp_invers: [unió ids nets]}`. **Seqüencial** (no concurrent → no esgota
   el QueuePool). El backend decora i manté índexs. Escriure al vault **no**
   dispara el reload d'uvicorn (vigila el codi, no el vault).
4. **Refresc**: `POST /api/vault/refresh-view-snapshots` per re-materialitzar els
   snapshots dels `.md` de les àrees (el frontend en viu ja resol amb `by-table`,
   cache 5 min; el backend per mtime, TTL 60s).
5. **Verifica**: re-llegir `by-table`; per cada àrea `invers ⊇ directe`.

## Restriccions / Edge cases

- **NO treure mai** del camp invers: només afegir (respecta many-to-many; un
  recurs pot pertànyer a diverses àrees). Direcció única: directe→invers.
- **Només parells amb camp invers únic.** Si la taula destí té 0 o >1 camps cap
  a Àrees → SALTAR i avisar (no endevinar).
- **Idempotent**: re-llegir `by-table` fresc cada execució; si l'id ja hi és, no
  tocar. Córrer-lo dos cops no fa res la segona.
- **No tocar YAML a mà**: sempre via PATCH (format/sidecar/decoració garantits
  pel backend). Tocar el `.md` directament arrisca diffs espuris si el `yaml.dump`
  divergeix.
- Materialitzar OneDrive abans (en natiu es llegeix al host; el PATCH ja
  materialitza on-access). Comprovar backend viu (`/api/health`) abans.

## FET: sincronització automàtica al backend (PATCH/POST)

`_propagate_relation_inverse` (`vault_routes.py`) propaga, en background, els
canvis dels camps de relació al camp INVERS de l'altre costat. Enganxat al PATCH
(diff `original_metadata_snapshot` vs metadata nou) i al POST (old buit → tot
altes). Lògica pura a `services/relation_sync.py` (`relation_changes`,
`resolve_inverse_relation`). Escriu amb `save_page_md` directe (no via endpoint)
→ cap recursió. Idempotent. Gestiona ambigus (salta). Tests: `test_relation_sync.py`.

## FET: relacions per ESQUEMA, no pel prefix `📀` (refactor 2026-06-20)

**Problema:** renomenar una columna de relació traient el `📀` del `name` (passa
a àlies) trencava TOT el maneig de relacions, perquè el codi identificava els
camps pel prefix `📀` (`is_relation_key = key.startswith("📀")`). Símptomes: la
metadata servia wikilinks en lloc d'ids (el `strip` no reconeixia el camp) i els
filtres de vista no casaven → **totes les vistes per àrea buides**.

**Solució:** reconèixer els camps de relació per l'ESQUEMA (`type=="relation"`,
nom + àlies), amb el prefix `📀` només com a fallback retrocompatible.
- `relation_links.py`: `is_relation_key(key, relation_keys=None)` +
  `relation_keys_from_table(table)` (nom + àlies dels camps `type=relation`);
  `strip_relation_wikilinks(metadata, relation_keys=None)`.
- `vault_routes.py`: `parse_frontmatter` resol `relation_keys` de la taula de la
  pàgina (`_relation_keys_for_metadata`) i les passa al `strip`; `save_page_md`
  usa `relation_keys_from_table` per al `decorate`; `_inverse_relation_frontmatter_key`
  casa per nom normalitzat (no pel `📀`).
- `relation_sync.relation_changes`: detecta camps per nom normalitzat de l'esquema
  + fallback `📀`.
- `view_snapshot.apply_filter` + `DbViewEmbed.applyFilter` (frontend):
  `_meta_value_for_field`/`metaValueForField` resolen el field del filtre per nom
  normalitzat → un filtre guardat amb el nom antic (`📀 Àrees`) casa amb la
  metadata nova (`Àrees`).
- `graph_service._add_structural_edges`: arestes de relació per esquema +
  `strip_item` als valors.
- `PageHoverCard.visibleProps` (frontend): oculta relacions per valor (uuid/
  wikilink), no només pel prefix `📀`.

**Tests:** `test_view_filter_rename.py`, `test_relation_sync.py`,
`test_relation_wikilinks.py` (casos amb i sense `📀`). E2E validat amb el `.md`
real: `parse_frontmatter` torna ids nets per a columnes renomenades i el filtre
`📀 Àrees==this` casa.

**Regla:** qualsevol codi nou que detecti camps de relació ha d'usar
`is_relation_key(key, relation_keys)` amb les `relation_keys` de l'esquema, MAI
només `startswith("📀")`.
