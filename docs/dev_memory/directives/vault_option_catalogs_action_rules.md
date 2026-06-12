# Directiva: Catàlegs d'opcions (Idioma/Estat/Tags) i regles d'acció

> **Estat:** IMPLEMENTADA (fases 1–3, 2026-06-12) — pendent d'executar la migració del registry després del merge (§5). L'editor de regles a la UI (fase 3 opcional) queda per fer. Decisions d'Ismael a §9; lliçons d'implementació a §6 bis.
> **Origen:** Idioma, Estat i Tags són (multi)select genèrics. Es vol: valors predeterminats gestionables (afegir/eliminar/renombrar opcions) i que les accions (traduir, publicar a XXSS, Drupal) respectin i actualitzin l'Estat — traduir → original «Traduït» + traducció «A revisar»; si està en esborrany, botó Traduir desactivat amb el motiu visible.

## 1. Objectiu i abast

Tres potes, incrementals:

- **A. Catàleg d'opcions ric** per als tres tipus que ja en tenen (`select`, `multi_select`, `status`): opcions amb color i, per a `status`, grups (Inicial / En curs / Final) i opció per defecte. Gestió completa des de la UI: crear, renombrar, eliminar amb reassignació, reordenar.
- **B. Rols semàntics de camp** (`language`, `status`, `tags`) perquè les accions trobin els camps pel rol i no per heurístics de nom.
- **C. Regles d'acció** declaratives per taula: condicions per habilitar una acció (amb motiu per al tooltip) i efectes sobre l'Estat en completar-se.

**Resposta a «cal un tipus nou?»:**

| Camp | Decisió |
|---|---|
| Estat | Tipus `status` — **ja existeix** a `OPTION_FIELD_TYPES`; s'enriqueix (grups, default, catàleg estricte), no es crea de zero |
| Tags | **No cal tipus nou**: `multi_select` + catàleg explícit + colors ÉS el tipus tags. Opcional: etiqueta cosmètica «Etiquetes» al picker de tipus, mateix tipus subjacent |
| Idioma | `select` amb catàleg fix de llengües + rol semàntic `language` |

## 2. Estat actual (verificat al codi, 2026-06-12)

| Fet | On |
|---|---|
| 18 tipus de camp; `status` ja existeix; `OPTION_FIELD_TYPES = {select, multi_select, status}` | `frontend/src/components/Vault/SchemaConfigModal.jsx:55` |
| `config.options` = array de **strings** («CA»); si falta, les opcions es deriven dels valors existents; sense colors per opció (color per tema global) | `SchemaConfigModal.jsx` (OptionsEditor), `schemaUtils.js:144-187` |
| L'OptionsEditor ja fa crear/renombrar/eliminar/reordenar; creació inline a la cel·la; `removeOptionEverywhere` en eliminar | `SchemaConfigModal.jsx:114-216`, `VaultTable.jsx:1314+` |
| Traduir escriu `translation_lang`, `translation_origin_id`, `translation_stale` i el camp d'idioma de la traducció (`language_field_assignment`); **no toca cap Estat** | `vault_routes.py` (/skills/translate-row), `translation_helpers.py` |
| El camp d'idioma es troba per **heurístic de nom** («Idioma», «lang»…) | `translation_helpers.detect_record_source_lang` |
| Botons d'acció: **amagats o mostrats** per booleans ad-hoc (`isTranslatableTable`, `isDrupalSyncTable`, `isSocialPublishTable`); mai «desactivat + motiu» | `VaultTable.jsx:2497-2552` |
| Publicar XXSS escriu només a la taula «Publicacions Socials» (amb Estat propi: esborrany → … → publicada); no toca el registre origen | `social_store.py`, `social_routes.py` |
| Drupal sync escriu `drupal_uuid/nid/url`; no toca Estat | `vault_routes.py:12172+` |
| Ja hi ha un **rule_engine** per taula al registry: fórmules, rollups i automations amb trigger `property_change` | `backend/services/rule_engine.py` |

## 3. Model de dades (registry)

### 3.1 Opcions riques (retrocompatible)

- `config.options` accepta DOS formats: string llegat («CA») i objecte `{name, color?, group?}`. Normalitzador a la lectura (string → `{name}`) als dos costats (backend i frontend); escriptura sempre en format nou. Un registry vell ha de seguir carregant sense migrar.
- Extres per a `status`: `config.option_groups` (per defecte: Inicial · En curs · Final) i `config.default_option` (s'aplica en crear un registre si el camp arriba buit).
- `status` és **catàleg estricte**: sense creació inline d'opcions des de la cel·la (com Notion). `select`/`multi_select` mantenen la creació inline actual.
- **Catàlegs compartits amb nom** (decisió §9.2): bloc `option_catalogs` a l'arrel del registry — `{ "tags-generals": [ {name, color}, … ] }` — i als camps `config.catalog_ref: "tags-generals"` en comptes de `config.options`. Diverses taules referencien la mateixa llista sense reescriure-la; editar el catàleg en un lloc actualitza pertot. Un camp té `options` locals O `catalog_ref`, mai els dos; el normalitzador resol la referència a la lectura. La gestió (crear catàleg compartit, «convertir opcions locals en catàleg compartit») viu a l'editor d'opcions.

### 3.2 Rols semàntics

- `config.role: language | status | tags` (mateix patró que el `config.translatable` existent). Únic per taula i rol.
- Les accions resolen el camp pel rol; **fallback** als heurístics de nom actuals si cap camp té rol (compatibilitat total amb taules no migrades).
- La migració assigna rols automàticament per nom: Idioma → language, Estat → status, Tags/Etiquetes → tags.

### 3.3 Regles d'acció (per taula)

Bloc nou `table.action_rules`, **separat** de `table.automations`. Frontera: les automations reaccionen a canvis de dades (`property_change`); les action_rules governen accions explícites de botó — guarda prèvia amb motiu + efectes posteriors, també sobre el registre creat (cosa que el model d'automations no contempla).

```json
"action_rules": {
  "translate_row": {
    "requires": [
      { "role": "status", "not_in": ["Esborrany"], "reason": "No es pot traduir si està en esborrany" }
    ],
    "effects": {
      "source":  [ { "role": "status", "set": "Traduït" } ],
      "created": [ { "role": "status", "set": "Esborrany" } ]
    },
    "on_stale": [ { "target": "translations", "role": "status", "set": "Esborrany" } ]
  },
  "sync_drupal":    { "requires": [ { "role": "status", "not_in": ["Esborrany"], "reason": "No es pot sincronitzar un esborrany" } ],
                      "effects":  { "source": [ { "role": "status", "set": "Publicat a Drupal" } ] } },
  "publish_social": { "requires": [ { "role": "status", "not_in": ["Esborrany"], "reason": "No es pot publicar un esborrany" } ],
                      "effects":  { "source": [ { "role": "status", "set": "Publicat a XXSS" } ] } }
}
```

- Valors per **nom d'opció** (coherent amb la persistència per nom del vault); per a `status` també s'admet `in_group` / `not_in_group`.
- **Seed-on-enable** (decisió §9, esmena d'Ismael): activar una funcionalitat a la configuració de camps afegeix *en aquell moment* les opcions corresponents al catàleg del camp amb rol `status` (si n'hi ha) **i** fa el seed del bloc d'action_rules corresponent:
  - Marcar el primer camp `translatable` → opció «Traduït» (grup En curs) + bloc `translate_row`.
  - Activar el sync amb Drupal → opció «Publicat a Drupal» (grup Final) + bloc `sync_drupal`.
  - Activar la publicació a XXSS → opció «Publicat a XXSS» (grup Final) + bloc `publish_social`.
  Els blocs són editables a mà al registry; editor a la UI queda per a la fase 3.

## 4. Comportament

### 4.1 Traduir

1. **Frontend**: el botó Traduir passa de «amagat» a **visible però desactivat** quan `requires` falla, amb tooltip = `reason`. L'avaluació es fa al client amb l'schema + metadata que ja té (utilitat mirall de la del backend, com ja passa amb la detecció d'idioma).
2. **Backend**: els endpoints `/skills/translate-row|rows|page` revaliden `requires` (mai confiar només en el client) → 409 amb `{reason}`. En bulk: les files bloquejades se salten amb motiu per fila a la resposta; el lot no avorta.
3. **Efectes en èxit**: original → Estat «Traduït»; cada traducció creada O actualitzada → Estat «Esborrany» (+ Idioma destí, que ja s'assigna avui). «Esborrany» fa de «pendent de revisió»: la salvaguarda de publicar bloqueja automàticament traduccions no revisades; quan Ismael la revisa, la passa a «Revisat».
4. **Obsolescència**: quan l'original canvia i es marca `translation_stale` a les filles (mecanisme existent, `_propagate_translation_staleness`), la regla `on_stale` també les torna a «Esborrany». Default ON (decisió §9.4).
5. **Robustesa**: si l'opció que una regla ha d'escriure no és al catàleg, el motor la **crea** (amb color automàtic) i ho deixa al log — una regla mai pot fallar per catàleg incomplet.

### 4.2 Gestió d'opcions (CRUD complet)

- L'OptionsEditor s'amplia amb: **color per opció** (paleta predefinida), **grup** (només status) i **comptador d'ús** (quantes files usen cada opció).
- **Eliminar una opció en ús**: diàleg amb dues sortides — buidar valors (comportament actual de `removeOptionEverywhere`) o **reassignar** a una altra opció. La reescriptura dels .md la fa el backend i retorna el recompte de fitxers tocats.
- **Renombrar una opció**: reescriptura eager dels .md afectats (els valors es guarden per nom). Endpoint dedicat amb report del recompte.

### 4.3 Publicar XXSS / Drupal (fase 3)

Mateixa mecànica: `requires` (no esborrany) + efecte source → «Publicat a Drupal» / «Publicat a XXSS» (decisió §9.3). En ser el camp Estat de valor únic, l'última acció mana (publicar a Drupal i després a XXSS deixa «Publicat a XXSS»); el rastre complet queda igualment a `drupal_uuid`/metadata social. La taula «Publicacions Socials» conserva intacte el seu cicle de vida propi (esborrany → programada → publicada…).

## 5. Migració (script idempotent)

`pipeline/scripts/migrate_option_catalogs.py` (mateixa casa que
`migrate_sidecar_metadata.py`) — dry-run per defecte, `--apply` per executar.
EXECUTAR-LA NOMÉS després del merge (§6: el normalitzador de lectura ha
d'arribar al mateix commit que la primera escriptura en format ric) i amb el
backend acabat de reiniciar després (cache de 30 s del registry):

1. Backup datat del registry al costat de l'original.
2. Per cada taula: camps de tipus opció **sense** `config.options` → deriva el catàleg dels valors existents (ordenat per freqüència) i l'escriu en format nou amb colors automàtics.
3. Camps anomenats Idioma/Estat/Tags (i sinònims): assigna `config.role`; «Estat» → `type: status` + grups per defecte + garanteix el catàleg seed (§9.1): «Esborrany» i «Revisat» sempre; «Traduït» si la taula és traduïble; «Publicat a Drupal» / «Publicat a XXSS» si té el sync/publicació actius.
4. Seed de `action_rules` (translate_row/sync_drupal/publish_social) segons les funcionalitats actives de cada taula.
5. **No toca cap frontmatter** (els valors són noms i no canvien) → reversible revertint el type/config al registry.

## 6. Restriccions / Edge Cases

- **No fer `restart` per canvis .py** → cal rebuild del backend (vegeu `environment_integrity.md`).
- **Renombrar/eliminar opcions reescriu N fitxers .md** al vault (OneDrive): sempre via backend (escriptures atòmiques existents). Recordar l'incident post-migració (eco de OneDrive reinjectant còpies velles amb ids duplicats hores després): no encadenar-ho amb altres migracions massives el mateix dia.
- **No esborrar silenciosament opcions que usen les regles**: si «Traduït»/«Publicat a Drupal»/«Publicat a XXSS» (o «Esborrany», que usen els `requires`) desapareixen del catàleg, el motor les recrea (4.1.5), però la UI ha d'avisar en eliminar-les («aquesta opció l'usa la regla translate_row»).
- **No duplicar motors**: action_rules NO és un trigger nou d'automations; conviuen amb frontera clara. Si més endavant es vol unificar, automations podria guanyar un trigger `action`, però no en aquesta fase.
- Les **traduccions** (files amb `translation_lang`) segueixen sense botó Traduir (comportament actual; es manté).
- **Registry compartit entre Macs** (OneDrive): el normalitzador de lectura ha d'arribar al mateix commit que la primera escriptura en format nou. Risc residual: l'altre Mac sense `git pull` llegint un registry ja escrit en format nou → degradació suau exigida (ignorar atributs desconeguts, mai crash).
- **`status` estricte vs valors històrics** fora de catàleg: la migració incorpora TOTS els valors existents al catàleg (no es perd res); la neteja la fa després l'usuari amb eliminar+reassignar.

## 6 bis. Lliçons d'implementació (2026-06-12)

- **No re-resoldre una pàgina per id just després d'un create**: l'efecte
  d'Estat sobre l'original (translate_row) feia `patch_page(item_id)` després
  de crear la filla i l'índex de pàgines podia estar a mig refrescar → 404 i
  la lògica anti-fantasmes bloquejava el rescan. Solució: escriure DIRECTE al
  `file_path` que el flux ja té (`_write_metadata_key_on_disk`, mateix patró
  que el flag d'obsolescència).
- **Bug preexistent corregit**: `_propagate_translation_staleness` comparava
  els camps traduïbles només per `id` (`fld_*`), però el frontmatter
  persisteix per NOM → mai detectava canvis i les traduccions no es marcaven
  obsoletes. Ara compara per id + nom + àlies.
- **Heurístic de rol restringit per tipus**: un camp «Estat» de tipus `text`
  (el cicle de vida propi de «Publicacions Socials») NO és un camp d'estat
  semàntic — el dry-run de la migració li estava fent seed. El fallback per
  nom només aplica a select/status (status, language) i multi_select (tags);
  el rol explícit `config.role` no té restricció.
- **Catàlegs compartits: renombrar/eliminar no suportat encara** — la
  reescriptura de files és per-taula i un catàleg compartit pot abastar-ne
  diverses; l'editor ho refusa amb un toast. Afegir opcions, colors i
  reordenar sí que funcionen (PUT del catàleg).
- **`buildPayload` fa round-trip del config**: el modal reconstruïa el config
  des de zero i hauria esborrat `role`/`option_groups`/`catalog_ref` (i
  qualsevol clau futura) a cada desat. Ara arrenca del config cru i només
  reescriu les claus que la UI gestiona. El backend, a més, preserva els
  `aliases` per property a l'upsert (es perdien a cada desat del modal).
- **El modal fa un autosave en obrir-se** (preexistent, no introduït aquí):
  el flag `skipNextAutosaveRef` es consumeix un render abans d'hora. És
  idempotent i, després del merge, té l'efecte col·lateral benigne de
  normalitzar el catàleg de la taula al format ric al primer obrir.
- **E2E aïllat al contenidor**: TestClient SENSE context manager (no dispara
  el lifespan → ni scheduler ni MCP) + `DIGITAL_BRAIN_VAULT_PATH=/tmp/testvault`
  + `GNOSI_LOCAL_DATA=/tmp/testdata`. MAI reutilitzar `/tmp/testdata` entre
  execucions amb el vault recreat: el cache d'índex persistit queda enverinat
  (entrades amb ids vells als mateixos paths) i `find_page_path` torna fals
  negatius. Vegeu `backend/tests/test_e2e_option_catalogs.py`.

## 7. QA (gates, segons protocol)

1. Build frontend net + rebuild backend sense errors.
2. E2E (API amb `X-User-ID: ismael-legacy`):
   - Registre «Esborrany» → botó Traduir desactivat amb tooltip; POST directe a `/skills/translate-row` → 409 amb motiu.
   - Registre «Revisat» → traduir a EN → original «Traduït»; filla nova «Esborrany» amb Idioma EN.
   - Editar el cos de l'original → filla marcada stale i Estat torna a «Esborrany».
   - Eliminar una opció en ús amb reassignació → recompte correcte i cap .md amb el valor vell.
   - Registry llegat (options com a strings) carrega i es mostra igual que abans.
3. Captures: botó desactivat amb tooltip + editor d'opcions amb colors/grups/ús.

## 8. Fases

| Fase | Contingut | Toca |
|---|---|---|
| 1 | Opcions riques (model + normalitzador, colors/grups/default a la UI, ús + reassignació en eliminar, renombrar amb reescriptura) + script de migració | registry, `SchemaConfigModal`, `VaultTable`, `vault_routes` |
| 2 | Rols semàntics + motor `action_rules` + integració a Traduir (disabled+tooltip, 409, efectes, bulk per fila, on_stale) | `translation_helpers`, `vault_routes`, `VaultTable`, `TranslateLanguagesModal` |
| 3 | Estendre a publicar XXSS i Drupal + (opcional) editor de regles a la UI | `social_routes`, sync Drupal, `SchemaConfigModal` |

## 9. Decisions preses (Ismael, 2026-06-12)

1. **Catàleg seed d'Estat**: «Esborrany» (Inicial) · «Revisat» (En curs) sempre, a tot camp amb rol status; «Traduït» (En curs) s'hi afegeix a les taules traduïbles; «Publicat a Drupal» / «Publicat a XXSS» (Final) a les que tenen la funcionalitat activa. No existeixen «Redactat» ni «A revisar»: una traducció nova o obsoleta cau a «Esborrany» (= pendent de revisió) i «Revisat» és l'estat que posa Ismael en revisar-la.
2. **Tags**: multi_select enriquit + **catàlegs compartits amb nom** (`option_catalogs` al registry + `config.catalog_ref` al camp), perquè diverses taules comparteixin la mateixa llista sense reescriure-la per taula (§3.1).
3. **Efecte de publicar**: source → «Publicat a Drupal» (sync Drupal) i «Publicat a XXSS» (publicació social), automàtic en èxit (§4.3).
4. **on_stale**: default ON; el destí és «Esborrany» (adaptació del mecanisme aprovat al catàleg nou).
