# Directiva: Catàlegs d'opcions (Idioma/Estat/Tags) i regles d'acció

> **Estat:** PROPOSTA — pendent de validació d'Ismael (2026-06-12)
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
      "created": [ { "role": "status", "set": "A revisar" } ]
    },
    "on_stale": [ { "target": "translations", "role": "status", "set": "A revisar" } ]
  },
  "sync_drupal":    { "requires": [ { "role": "status", "not_in": ["Esborrany"], "reason": "No es pot sincronitzar un esborrany" } ] },
  "publish_social": { "requires": [ { "role": "status", "not_in": ["Esborrany"], "reason": "No es pot publicar un esborrany" } ],
                      "effects":  { "source": [ { "role": "status", "set": "Publicat" } ] } }
}
```

- Valors per **nom d'opció** (coherent amb la persistència per nom del vault); per a `status` també s'admet `in_group` / `not_in_group`.
- **Seed per defecte** del bloc `translate_row` quan una taula esdevé traduïble (en marcar el primer camp `translatable`). Editable a mà al registry; editor a la UI queda per a la fase 3.

## 4. Comportament

### 4.1 Traduir

1. **Frontend**: el botó Traduir passa de «amagat» a **visible però desactivat** quan `requires` falla, amb tooltip = `reason`. L'avaluació es fa al client amb l'schema + metadata que ja té (utilitat mirall de la del backend, com ja passa amb la detecció d'idioma).
2. **Backend**: els endpoints `/skills/translate-row|rows|page` revaliden `requires` (mai confiar només en el client) → 409 amb `{reason}`. En bulk: les files bloquejades se salten amb motiu per fila a la resposta; el lot no avorta.
3. **Efectes en èxit**: original → Estat «Traduït»; cada traducció creada O actualitzada → Estat «A revisar» (+ Idioma destí, que ja s'assigna avui).
4. **Obsolescència**: quan l'original canvia i es marca `translation_stale` a les filles (mecanisme existent, `_propagate_translation_staleness`), la regla `on_stale` també les torna a «A revisar». Activable per regla; default ON.
5. **Robustesa**: si l'opció que una regla ha d'escriure no és al catàleg, el motor la **crea** (amb color automàtic) i ho deixa al log — una regla mai pot fallar per catàleg incomplet.

### 4.2 Gestió d'opcions (CRUD complet)

- L'OptionsEditor s'amplia amb: **color per opció** (paleta predefinida), **grup** (només status) i **comptador d'ús** (quantes files usen cada opció).
- **Eliminar una opció en ús**: diàleg amb dues sortides — buidar valors (comportament actual de `removeOptionEverywhere`) o **reassignar** a una altra opció. La reescriptura dels .md la fa el backend i retorna el recompte de fitxers tocats.
- **Renombrar una opció**: reescriptura eager dels .md afectats (els valors es guarden per nom). Endpoint dedicat amb report del recompte.

### 4.3 Publicar XXSS / Drupal (fase 3)

Mateixa mecànica: `requires` (p. ex. no esborrany, o `in_group: Final` per publicar) + efecte opcional source → «Publicat». La taula «Publicacions Socials» conserva intacte el seu cicle de vida propi (esborrany → programada → publicada…).

## 5. Migració (script idempotent a pipeline/sandbox)

`migrate_option_catalogs.py` — dry-run per defecte, `--apply` per executar:

1. Backup datat del registry al costat de l'original.
2. Per cada taula: camps de tipus opció **sense** `config.options` → deriva el catàleg dels valors existents (ordenat per freqüència) i l'escriu en format nou amb colors automàtics.
3. Camps anomenats Idioma/Estat/Tags (i sinònims): assigna `config.role`; «Estat» → `type: status` + grups per defecte + garanteix que «Esborrany», «Traduït» i «A revisar» existeixen si la taula és traduïble.
4. Seed de `action_rules.translate_row` a les taules traduïbles.
5. **No toca cap frontmatter** (els valors són noms i no canvien) → reversible revertint el type/config al registry.

## 6. Restriccions / Edge Cases

- **No fer `restart` per canvis .py** → cal rebuild del backend (vegeu `environment_integrity.md`).
- **Renombrar/eliminar opcions reescriu N fitxers .md** al vault (OneDrive): sempre via backend (escriptures atòmiques existents). Recordar l'incident post-migració (eco de OneDrive reinjectant còpies velles amb ids duplicats hores després): no encadenar-ho amb altres migracions massives el mateix dia.
- **No esborrar silenciosament opcions que usen les regles**: si «Traduït»/«A revisar» desapareixen del catàleg, el motor les recrea (4.1.5), però la UI ha d'avisar en eliminar-les («aquesta opció l'usa la regla translate_row»).
- **No duplicar motors**: action_rules NO és un trigger nou d'automations; conviuen amb frontera clara. Si més endavant es vol unificar, automations podria guanyar un trigger `action`, però no en aquesta fase.
- Les **traduccions** (files amb `translation_lang`) segueixen sense botó Traduir (comportament actual; es manté).
- **Registry compartit entre Macs** (OneDrive): el normalitzador de lectura ha d'arribar al mateix commit que la primera escriptura en format nou. Risc residual: l'altre Mac sense `git pull` llegint un registry ja escrit en format nou → degradació suau exigida (ignorar atributs desconeguts, mai crash).
- **`status` estricte vs valors històrics** fora de catàleg: la migració incorpora TOTS els valors existents al catàleg (no es perd res); la neteja la fa després l'usuari amb eliminar+reassignar.

## 7. QA (gates, segons protocol)

1. Build frontend net + rebuild backend sense errors.
2. E2E (API amb `X-User-ID: ismael-legacy`):
   - Registre «Esborrany» → botó Traduir desactivat amb tooltip; POST directe a `/skills/translate-row` → 409 amb motiu.
   - Registre «Redactat» → traduir a EN → original «Traduït»; filla nova «A revisar» amb Idioma EN.
   - Editar el cos de l'original → filla marcada stale i Estat torna a «A revisar».
   - Eliminar una opció en ús amb reassignació → recompte correcte i cap .md amb el valor vell.
   - Registry llegat (options com a strings) carrega i es mostra igual que abans.
3. Captures: botó desactivat amb tooltip + editor d'opcions amb colors/grups/ús.

## 8. Fases

| Fase | Contingut | Toca |
|---|---|---|
| 1 | Opcions riques (model + normalitzador, colors/grups/default a la UI, ús + reassignació en eliminar, renombrar amb reescriptura) + script de migració | registry, `SchemaConfigModal`, `VaultTable`, `vault_routes` |
| 2 | Rols semàntics + motor `action_rules` + integració a Traduir (disabled+tooltip, 409, efectes, bulk per fila, on_stale) | `translation_helpers`, `vault_routes`, `VaultTable`, `TranslateLanguagesModal` |
| 3 | Estendre a publicar XXSS i Drupal + (opcional) editor de regles a la UI | `social_routes`, sync Drupal, `SchemaConfigModal` |

## 9. Decisions obertes (cal validació d'Ismael)

1. **Catàleg seed d'Estat** — proposta: Esborrany (Inicial) · Redactat (En curs) · Traduït (En curs) · A revisar (En curs) · Publicat (Final). Noms exactes? A totes les taules traduïbles o només Articles?
2. **Tags**: multi_select enriquit (recomanat) o tipus propi `tags`?
3. **Efecte de publicar**: source → «Publicat» per defecte a XXSS i/o Drupal, o només manual?
4. **on_stale → «A revisar»**: default ON?
