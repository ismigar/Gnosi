# Directiva: Format de moneda / número / data (global + per camp)

## Objectiu
Permetre definir **moneda, format de número i format de data** com a **defaults globals** (a Settings, al costat de l'idioma) i **sobreescriure'ls per camp** al editor d'esquema, i aplicar-ho als camps `number`/`date`/`datetime`/`period` de la taula del Vault i de les propietats de pàgina.

Model triat: **híbrid amb prioritat per camp** → `config.format` del camp **mana**; si no n'hi ha, s'usa el default global; si tampoc, el locale de la interfície.

## Estat actual (punt de partida)
- **Els settings globals JA existeixen** a `/api/config` → `settings.language` (`'ca'`), `settings.currency` (`'EUR (€)'`), `settings.decimal_symbol` (`','`), `settings.week_start`. La UI ja hi és a `GlobalSettingsModal.jsx` (pestanya "Idioma i Regió", ~línies 1544-1553, constants `CURRENCIES`/`DECIMAL_SYMBOLS` a 27-28). **Però no s'apliquen enlloc.**
- **Persistència i reactivitat**: `/api/config` (GET amb cache a `lib/cachedJson.js`; POST des dels modals) + event `gnosi:config-changed` via `lib/configEvents.js` (`emitConfigChanged()` / `useConfigChanged(cb)`). Aquest és el patró a seguir per llegir settings a tota l'app (NO localStorage; vegeu `useTheme` només com a patró d'event, no de storage).
- **Números**: avui es mostren **en cru** — no hi ha `case 'number'` al `switch` de `renderCellContent` (`VaultTable.jsx`), cauen al `default` (~línia 2082: `<span>{value}</span>`). Les agregacions (~2103) usen `.toLocaleString()` sense moneda.
- **Dates**: la taula usa `i18n.language` amb opcions fixes (`VaultTable.jsx` ~1971 i ~1983 per `period`). `VaultDateProperty.jsx:53` té **`'ca-ES'` hardcoded** (bug a corregir: ha d'usar el locale/format triat).
- **Config per camp**: el `config` viu a `schema[\`${field}_config\`]` (`getFieldConfig`, `schemaUtils.js`) i és **extensible**; s'edita a `SchemaConfigModal.jsx` (mateix patró que `button_action`, `translatable`, etc.) i es desa via POST `/api/vault/schema`.

## Disseny

### 1. Model de dades del format
**Global** (a `settings`, dins `/api/config`):
- `currency`: ja existeix (`'EUR (€)'`). **Cal parsejar-ne el codi ISO** (`'EUR'`) per a `Intl` (mapa o agafar el prefix de 3 lletres).
- `decimal_symbol`: ja existeix (`','`/`'.'`).
- **NOU** `date_format`: `'locale' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'` (default `'locale'`).

**Per camp** (`config.format`, opcional):
- number: `{ kind: 'number' | 'currency' | 'percent', decimals?: number, currency?: 'EUR'|'USD'|… }`.
- date/datetime: `{ dateFormat?: 'locale'|'DD/MM/YYYY'|… }`.

### 2. `formatUtils.js` (nou, helpers PURS i testejables)
Al costat de `cellGridUtils.js`. Sense React, amb args explícits (per a tests deterministes):
- `formatNumber(value, opts)` → `Intl.NumberFormat`. `opts = { kind, decimals, currencyCode, locale }`. `currency` → `style:'currency'`; `percent` → mostra el valor **tal qual** amb sufix `%` (NO `style:'percent'`, que multiplica per 100 — documentar-ho); `number` → separadors de milers + decimals. Si `value` no és numèric → torna el valor cru.
- `formatDate(value, opts)` → `opts = { dateFormat, type, locale }`. `'locale'` → `Intl.DateTimeFormat(locale)`; els formats explícits es construeixen amb components locals (no UTC) per no desplaçar el dia (vegeu [[vault_table_cell_grid]], mateix risc de TZ). Invàlida → valor cru.
- `parseCurrencyCode('EUR (€)')` → `'EUR'`.
- `resolveFieldFormat(fieldConfig, globalSettings)` → fusiona override de camp sobre defaults globals.

> **Separadors decimals i `Intl`**: `Intl.NumberFormat` deriva els separadors del **locale**, no accepta un símbol decimal arbitrari. Per honorar `decimal_symbol` sense lluitar amb `Intl`, mapar-lo a un locale de formatació (`','` → p. ex. `'ca-ES'`/`'de-DE'`; `'.'` → `'en-US'`) en lloc de fer post-replace fràgil. Documentar aquesta decisió.

### 3. `useLocaleSettings()` (nou hook)
Llegeix `/api/config` (via `cachedJson`), exposa `{ locale, currencyCode, decimalSymbol, dateFormat }` derivats de `settings`, i refetcha amb `useConfigChanged`. És la font única per als components de render (taula, propietats). Alternativa acceptable: passar-ho com a prop des d'un pare que ja té `config` (Dashboard/VaultShell), per no multiplicar fetchs — decidir segons on penja `VaultTable`.

### 4. Aplicació al render (prioritat camp → global → locale)
- **VaultTable**:
  - Afegir `case 'number'` a `renderCellContent` → `formatNumber(value, resolveFieldFormat(getFieldConfig(schema,field), settings))`. **Només per a la VISUALITZACIÓ**; l'`<input>` d'edició segueix amb el número cru (no reformatar mentre s'edita).
  - `date`/`datetime`/`period` (~1971/1983) → `formatDate(...)` amb el format resolt.
  - Agregacions (~2103) → `formatNumber` amb el format de la columna (sum/avg/min/max en la moneda/decimals del camp).
- **VaultDateProperty.jsx:53** → substituir `'ca-ES'` pel locale/format resolt (mantenir el parseig d'entrada DD/MM/YYYY tolerant).
- **Propietats de pàgina** (`BlockEditor.jsx`): aplicar el format a la **visualització** (mode viewer i, si escau, quan l'input no té focus). Els inputs editables es queden amb el valor cru en edició (toc més lleuger; pot ser una 2a fase).

### 5. UI
- **Global** (`GlobalSettingsModal`): la UI de moneda/decimal ja hi és; afegir-hi el selector de **format de data** i assegurar que els tres es desen a `settings` i emeten `emitConfigChanged()`.
- **Per camp** (`SchemaConfigModal`): quan el tipus és `number` → controls `kind` (número/moneda/percentatge) + decimals + moneda; quan és `date`/`datetime` → selector de format. Desar dins `config.format`. Seguir el patró dels controls existents.

## Emmagatzematge (CRÍTIC)
- Els camps `number` es desen com a **Number** cru (com ara); el format és **només de presentació**. Mai desar la cadena formatada.
- Les dates es desen en **ISO**; el format és només de presentació.
- Canviar el format global o del camp **no** reescriu cap dada: només canvia com es mostra.

## Restriccions / Edge-cases (memoritzar)
- `currency` ve com `'EUR (€)'` → parsejar a codi ISO abans d'`Intl`.
- `percent`: el valor es desa tal com és (p. ex. `25` = 25%); es mostra amb `%` sense multiplicar ×100.
- **No reformatar mentre s'edita** (evita problemes de cursor/caret i parseig); formatar només la cel·la en mode lectura.
- `formatNumber`/`formatDate` han de ser **resilients**: valor no numèric / data invàlida → mostrar el cru, mai "NaN"/"Invalid Date".
- Tests de `formatUtils` amb `locale` **explícit** als args (les sortides d'`Intl` depenen de l'entorn) per ser deterministes.
- Coherència amb l'enganxat: el porta-retalls i la coerció ([[vault_table_cell_grid]]) treballen amb el valor **cru** (ISO/Number), no amb el formatat.

## QA
- `npm run build` net + ESLint sense errors nous.
- Unit tests de `formatUtils` (number/currency/percent/date amb locale fix).
- Navegador (ara que és a `main`, el dev server 5173 ho serveix): número en moneda a la taula, override per camp, canvi global reflectit en viu (event `gnosi:config-changed`), dates en el format triat, i que **editar** un número/data segueix funcionant amb el valor cru.
