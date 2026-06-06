# Directiva: Sincronització Vault → Drupal (drupal_content_sync)

## Objectiu
Publicar files d'una taula del Vault com a **nodes de Drupal 10**
(`temenosismael.org`) i mantenir-les sincronitzades, amb mapatge camp-a-camp,
traduccions i identitat (nid/url) desada a la fila. Activable per taula.

## Arquitectura (clau: el WAF de Pangea bloqueja PATCH **i** DELETE)
| Operació | Mètode | Notes |
|---|---|---|
| Llegir tipus/camps | `GET /jsonapi/node_type/node_type`, `GET /jsonapi/field_config/field_config` | Descoberta. GET no bloquejat. |
| **Crear** node | `POST /jsonapi/node/<bundle>` | POST **no** bloquejat pel WAF (verificat). |
| **Actualitzar** node | `POST /custom/node-helper/update` `{uuid,type,attributes,relationships}` | Mòdul `n8n_helper` (esquiva el WAF). 404 si no existeix → caure a crear. |
| **Traduir** (crear/actualitzar) | `POST /custom/translation-helper/add` `{uuid,langcode,fields}` | Idempotent. Només atributs (text/cos). |
| Pujar imatge | `POST /jsonapi/node/<bundle>/<camp>` (binari) → file UUID | `Content-Disposition: file; filename="…"`. |
| Taxonomia | `GET/POST /jsonapi/taxonomy_term/<vocab>` | Resol per `filter[name]`, crea si falta. |

**Restricció verificada (2026-06-05):** el WAF retorna 403 a `DELETE /jsonapi/...`
i bloqueja `PATCH`. Per això **mai** s'actualitza ni s'esborra via JSON:API: les
actualitzacions van pels endpoints POST custom; els nodes de prova s'esborren per
`drush` (no per API).

## Codi
- Client: `monorepo/apps/gnosi/backend/services/drupal_sync_service.py`
  (`list_content_types`, `list_fields`, `create_node`, `update_node`,
  `add_translation`, `upload_image`, `resolve_or_create_term`,
  `markdown_to_full_html` via pandoc, `base_url`).
- Rutes + orquestració: `backend/api/vault_routes.py`
  (`GET /api/vault/drupal/content-types`, `/{bundle}/fields`,
  `POST /api/vault/skills/sync-drupal-row(+rows)`, `_do_sync_drupal_row`,
  `_drupal_build_fields`).
- Config UI: `frontend/src/components/Vault/SchemaConfigModal.jsx` (toggle +
  desplegable de tipus + editor de mapatge + pseudo-camp `__body__` per al cos);
  persistència a `pages/VaultDashboard.jsx`; flag `system` a `schemaUtils.js`.
- Botó per fila: `frontend/src/components/Vault/VaultTable.jsx` +
  `SyncDrupalModal.jsx`.

## Credencials
`DRUPAL_URL` (a `.env_shared`, amb www) + `DRUPAL_ROOT_USER` (`admin`) +
`DRUPAL_ROOT_PASSWORD`. Al host la contrasenya viu al keychain
(`drupal_root_password`); dins Docker, al magatzem de secrets muntat (`~/.gnosi`,
via `keychain_manager`). **El client normalitza la URL al host canònic sense
`www`**: el lloc fa 301 www→no-www i el redirect deixa caure el Basic-auth.

## Mapatge i tipus de camp
`drupal_field_mapping = { <propId|"__body__">: <camp_drupal> }`, desat a l'entrada
de la taula (`drupal_sync_enabled`, `drupal_bundle`, `drupal_field_mapping`).
- text/string/list_string/email → atribut string.
- integer/decimal → número.
- text_with_summary/text_long (p. ex. `body`) → `{value: <html>, format:'full_html'}`.
  El **cos de la pàgina** es mapa via `__body__`. Conversió Markdown→HTML amb
  pandoc: `-f markdown-smart` (no toca cometes/guions), `--shift-heading-level-by=1`
  (els títols del cos no fan `<h1>`, que ja és el títol del node), i els blocs
  `::: nom … :::` → `<div class="nom">`. **Abans** de pandoc, `_drupal_preprocess_md`
  resol els wikilinks `[[X]]` / `[[X|àlies]]` (a un enllaç del node si el target ja
  està sincronitzat —té `drupal_url`—, o a text pla si no) i treu els embeds `![[…]]`.
- entity_reference (p. ex. `field_tags`) → `taxonomy_term--<vocab>`; el vocabulari
  surt de `settings.handler_settings.target_bundles` (defecte `tags`). Crea termes
  que faltin.
- image/file (p. ex. `field_image`) → puja el fitxer i enllaça `file--file`. El
  camp imatge pot ser COMPOST `{src, alt, title, caption, credit}` (vegeu
  `fileResource.parseImageField`): `meta.alt`/`meta.title` surten del mapa (amb
  fallback de l'alt al títol de la fila); un string es tracta com `{src}`. La
  ruta relativa (p. ex. "Articles/x.jpg") es resol sota `<Vault>/Assets/`.

## Identitat i idempotència
- Ancorada per `drupal_uuid` (metadata oculta de la fila). nid/url es desen a dues
  **columnes reals** gestionades pel sistema ("Drupal NID" / "Drupal URL",
  `config.system: true`, read-only) i també a metadata oculta (`drupal_nid`,
  `drupal_url`).
- **Crear** un node fa el build complet (imatge/tags/cos) en l'idioma de la fila.
  **Actualitzar** un node existent toca NOMÉS el TEXT de l'idioma de la fila via
  `add_translation(uuid, langcode, {title, body})` — apunta al langcode correcte
  (no al per defecte) i **no re-puja la imatge**. Termes resolts-o-creats per nom.
- **Re-empènyer mèdia** (`push_media`, param de `sync-drupal-row`): en
  ACTUALITZAR, a més del text, torna a pujar i re-enllaça `field_image` (build
  `_drupal_build_fields(media_only=True)` → `update_node`). La imatge és un camp
  compartit entre traduccions → es fa **un sol cop** per al node. El
  `NodeController` (n8n_helper) aplica `relationships.field_image.data.meta.alt`
  a l'alt. Casella "Tornar a pujar la imatge" al `SyncDrupalModal` (només quan el
  node ja existeix; en crear, la imatge sempre s'inclou).
- **Abast del sync** (`scope`, param de `sync-drupal-row`): `"all"` (per defecte)
  sincronitza l'idioma de la fila + les traduccions (subitems) + les **files
  germanes** (altres registres amb el mateix `drupal_nid`, un per idioma);
  `"lang_only"` només l'idioma d'aquesta fila. Triable al modal `SyncDrupalModal`.
- **Guard de cos buit**: si el cos (markdown) de la fila és buit, NO s'envia el
  camp `body` → no s'esborra el cos a Drupal. Per omplir buits, porta el contingut
  de Drupal a Gnosi (HTML→MD) primer.

## Restriccions i casos límit (aprenentatge)
- **`article` té `field_image` OBLIGATORI** → sincronitzar un article **exigeix**
  mapar una imatge; si no, el create falla amb 422. (Altres tipus com `page`,
  `recurs` no en tenen.)
- **Traduccions**: el `TranslationController` fa `set()` genèric → només s'hi
  empeny text/cos. Tags i imatge són camps compartits (no traduïbles) a Drupal.
- **OneDrive online-only**: materialitzar (`_materialize_if_online_only`) la fila,
  els subitems i les imatges abans de llegir-los (errno 35 si no).
- **langcode**: `detect_record_source_lang` → ISO 2 lletres; si el tipus no està
  habilitat per a un idioma, Drupal torna 4xx → es reporta a `translations[].status`
  sense avortar.
- **Vocabularis**: a temenosismael.org només hi ha `tags`.

## Neteja de nodes de prova
DELETE per API està bloquejat. Esborra per `drush` (skill `.agent/skills/domain/drupal/`):
`drush entity:delete node <nid>` o `drush php:eval "Node::load(<nid>)->delete();"`.
Com que Claude Code no pot fer el diàleg del keychain per a l'SSH, delega la comanda
al Terminal de l'usuari.

## QA
Backend: provat dins `gnosi_backend` contra Drupal real (create/update/translate/
image/taxonomy + idempotència). Frontend: `npm run build` + navegador via
`javascript_tool` (screenshot/read_page peten en aquesta SPA). Els nodes de prova
es creen **despublicats** (`status:false`) i clarament etiquetats.
