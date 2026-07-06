# Directiva: fer traduïbles els missatges d'UI escrits en dur (i18n)

**Objectiu:** cap text visible per l'usuari escrit en dur al frontend. Tot passa per
react-i18next amb claus als quatre `src/locales/{ca,en,es,fr}/translation.json`.

## Estat (2026-07-04)

Fets traduïbles fins ara:
- **Tanda 0 (patró de referència):** `components/NotionImportSettings.jsx` → `settings.notion.*`
  (93 claus); `components/VaultSwitcher.jsx` → `settings.vaults.*` (10 claus).
- **Tanda 2 — Modals del Vault (aquest PR):** `SchemaConfigModal.jsx`, `PageViewModal.jsx`,
  `InsertContentModal.jsx`, `ShareModal.jsx`, `TranslateLanguagesModal.jsx`,
  `RecurrenceChoiceModal.jsx`. ~355 claus noves per idioma (namespaces `view.*`, `insert.*`,
  `share.*`, `schema.*`, `calendar.*` de recurrència, `translate.lang_*`, i `common.*`/`errors.*`
  compartides). Build OK; QA al navegador en ca i en sense claus crues.
- **Tanda 4 (parcial) — Comentaris del Vault (2026-07-06):** `Vault/InlineComments.jsx`
  passat a `t()` (namespace nou `inline_comments.*`, reusant `common.cancel`); a més
  s'han afegit als 4 locales les claus `comments.*`, `errors.comment_*`/`comments_load` i
  `shell.view_comments` que `PageComments.jsx` i `InlineComments.jsx` ja invocaven amb
  `defaultValue` però no existien enlloc (21 claus/idioma). Comptador via `inline_comments.title`
  amb `{{count}}`. Build OK; QA aïllat (createRoot + `changeLanguage` als 4 idiomes) sense claus
  crues al DOM.

Queden ~740 línies amb text visible en dur repartides en ~110 fitxers (heurística per
caràcters accentuats dins de literals/JSX, comentaris exclosos; els textos sense accents
no hi compten, així que el total real és una mica més alt).

## SOP (el patró establert a NotionImportSettings)

1. **Namespace per pantalla/pestanya**: les claus van niades seguint la convenció existent
   (`settings.<pestanya>.*` per a pestanyes de Configuració; `view`, `insert`, `share`,
   `schema`, `table`, `editor`, `calendar`, etc. per a la resta — mira les claus arrel del
   `translation.json` de `ca`).
2. **Helper curt o `t()` directe**: si un component repeteix molt un namespace, definir un
   `tn(clau, opts)` que el prefixa. Als modals del Vault s'ha usat `t('view.…', 'default ca')`
   directe amb el valor català com a fallback in-line (llegible i resistent a claus absents).
3. **Interpolació, mai concatenació**: comptadors i noms van com a variables de la clau
   (`{{count}}`, `{{name}}`, `{{matched}}/{{unmatched}}`) perquè l'ordre pugui canviar per idioma.
4. **Plurals**: sufixos `_one` / `_other` amb `count` (p.ex. `schema.option_usage_*`,
   `schema.remove_option_in_use_*`, `view.usage_count_*`). Cridar `t('clau', { count })` SENSE el
   sufix; i18next tria la variant.
5. **Negretes o marques dins de frase**: component `Trans` amb la clau contenint `<b>…</b>` i el
   mapa de components. No trossejar la frase en claus separades (trenca l'ordre en altres idiomes).
6. **Els 4 idiomes alhora**: cada clau nova s'afegeix a ca, en, es i fr en el mateix canvi.
   El fallback és `en` (vegeu `src/i18n.js`), així que si en falta una es veu anglès, mai la clau.
7. **Inserció al JSON amb diff mínim**: afegir claus programàticament respectant les existents
   (no re-serialitzar amb un formatador que canviaria totes les línies) i validar que el JSON
   parseja abans d'escriure. Script d'ajuda: fusió idempotent que salta claus ja presents.

## Restriccions / Edge cases

- **No traduir valors desats, només etiquetes.** Els catàlegs d'opcions de select desen el
  NOM com a valor (vegeu memòria `feedback_rich_option_catalog_normalize`), i hi ha codi que
  compara strings. A `SchemaConfigModal` són **valors desats/comparats, mai i18n**:
  `SOCIAL_PUBLISH_COL = 'XXSS'`, `DRUPAL_NID_COL = 'Drupal NID'`, `DRUPAL_URL_COL = 'Drupal URL'`
  (el sync els busca pel nom; `RULE_PROTECTED_OPTIONS` conté 'Esborrany'/'Traduït'/…). Traduir-los
  trencaria la detecció en taules creades en un altre idioma. Igual amb els `value=` dels `<option>`
  (`'dayGridMonth'`, `'bar'`, `'count'`, `'YYYY-MM-DD'`): només es tradueix el TEXT de l'opció.
- **No tocar comentaris** en català: no són UI.
- **Textos d'error de handlers**: també van per `t()` (accessible des dels handlers), però el
  detall tècnic del backend s'hi concatena tal qual (`${t('insert.error')}: ${msg}`). Fallback
  genèric `errors.unknown`.
- **Dates**: `toLocaleDateString(i18n.language)` en lloc de `'ca-ES'` fix (ShareModal).
- **`markdown-mapper.js`, `formulaUtils.js`, `cslEngine.js` i similars**: molts strings són
  sintaxi de fitxer o dades (fences, noms de camps, CSL), no UI → revisar cas per cas.
- **QA**: `npm run build` + muntar cada modal aïllat al navegador (dev server del worktree via
  `createRoot` sobre imports Vite: `/@id/react`, `/@id/react-dom/client`, `/src/i18n.js`) i
  comparar el DOM en `ca` i `en` amb `i18n.changeLanguage()`. Comprovar que no es filtra cap clau
  crua (`/^(view|schema|insert|share|translate|calendar|common|errors|page_view)\.[a-z_]+/`).
  **Gotcha:** `SchemaConfigModal` es renderitza amb `createPortal(document.body)` → escanejar el
  `body`, no el host del `createRoot`.

## Inventari pendent (top, per línies de text visible)

| Fitxer | ~línies |
|---|---|
| components/GlobalSettingsModal.jsx | 84 |
| components/Vault/BlockEditor.jsx | 35 |
| pages/VaultDashboard.jsx | 25 |
| components/Vault/TldrawEditor.jsx | 25 |
| pages/MediaCenter.jsx | 20 |
| components/MeetingRecorder.jsx | 19 |
| pages/Dashboard.jsx | 18 |
| components/CommandPalette.jsx | 18 |
| components/Vault/CalendarSidebarRight.jsx | 17 |
| components/Vault/VaultTable.jsx | 14 |
| components/PluginsSettings.jsx | 12 |
| pages/CalendarPage.jsx | 11 |
| components/Vault/slashMenuUtils.js | 11 |
| components/Vault/DbViewEmbed.jsx | 11 |
| (+ ~95 fitxers més amb <10 línies) | |

**Pla per tandes** (cada tanda = 1 PR amb QA de les seves pantalles):
1. Configuració: GlobalSettingsModal + PluginsSettings + FilesystemPickerModal.
2. ~~Modals del Vault: SchemaConfigModal, PageViewModal, InsertContentModal, ShareModal,
   TranslateLanguagesModal, RecurrenceChoiceModal.~~ **FET (2026-07-04).**
3. Editors i pàgines: BlockEditor, TldrawEditor, VaultDashboard, Dashboard, MediaCenter,
   CommandPalette, MeetingRecorder.
4. Resta del Vault (VaultTable, DbViewEmbed, CalendarSidebarRight, slashMenuUtils…) i cua llarga.
