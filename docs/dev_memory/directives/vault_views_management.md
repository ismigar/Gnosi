# Directive: Vault Views Management

This directive defines how data views (tables, galleries, kanbans, timelines) should be implemented and maintained in the Gnosi Vault, ensuring consistency in filtering, sorting, and searching.

## View Implementation Protocol

### 1. Unified Data Logic (`useVaultViewData`)
All views must use the `useVaultViewData` hook to process notes. No ad-hoc filtering or sorting logic should be implemented within the view components.

**View configuration fields:**
- `filters`: Object with `conjunction` ('and'|'or') and `conditions` (array of conditions or groups).
- `sorts`: Array of objects `{ field, direction }`.
- `search`: String for global textual search.
- `visibleProperties`: Array of property names to display.

### 2. View Toolbar (`VaultViewToolbar`)
Each view must display a header or toolbar containing:
- A search input that filters in real-time across all visible properties (or title/content).
- A quick access button to open/close the filter panel.
- An indicator of how many filters and sorts are active.

### 3. Persistent Configuration
- View configurations are stored in `vault_db_registry.json` via the `/api/vault/views` endpoint.
- In the case of embedded views (`InlineDatabase` in `BlockEditor`), configurations are stored as block attributes to allow page-specific custom views.

## Restrictions and Special Cases
- **Search**: Must be "fuzzy" or at least case-insensitive across the note's title and metadata.
- **Dates**: Date sorting must account for ISO formats and missing values (keeping empties at the end).
- **Relations**: Relation filtering must allow the special value `{{self}}` to filter notes that link to the current page (Backlinks).
- **Visual Consistency**: Embedded views must have the same appearance and functionality as full-screen views in the Dashboard.

## Validation
Before considering a view complete, verify:
1. That the search works correctly in both table and gallery views.
2. That adding a filter from the configuration modal applies it immediately and saves it.
3. That multi-column sorting prioritizes fields according to the order defined in the `sorts` array.

## Edge Cases / Regressions (carrera registre↔esquema)

- **Recàrrega (Cmd+R) sobre `/vault/table/:id` → no es renderitza cap columna.**
  L'efecte de `VaultDashboard` que sincronitza la URL amb l'estat NO ha de
  seleccionar la taula fins que `registry.tables` la contingui.
  - **No fer:** actuar quan `registry.tables` és truthy. Arrenca com a `[]`
    (array buit = truthy), així que en una recàrrega l'efecte s'executa abans que
    `/api/vault/registry` resolgui.
  - **Causa:** `handleTableSelect` fixa `activeTableId` però el guard de registre
    (`registry.tables.find(...)`) falla amb el registre buit i **no crida
    `setSchema`**. Quan el registre carrega i l'efecte es re-executa, el guard
    `activeTableId !== tableId` ja és fals → `handleTableSelect` no es torna a
    cridar → `schema` queda `{}` → `dynamicColumns` buit.
  - **Fer:** `if (!registry.tables?.some(t => t.id === tableId)) return;` abans de
    seleccionar, perquè esquema + vista inicial es resolguin en una sola passada
    amb dades completes.

- **Ordenar per una columna poc poblada amaga les files amb contingut
  ("no es veuen els adjunts").** La vista principal de Recursos tenia
  `sort = { field: "Adjunts", direction: "asc" }`. Com que `''` < qualsevol
  ruta a `localeCompare`, les ~115 files amb Adjunts buit suraven al capdamunt i
  les 178 amb fitxers quedaven a les posicions 116–293, que la virtualització
  (batch de 50) ni arribava a carregar → semblava que els adjunts no es
  renderitzaven (de fet el renderitzat era correcte).
  - **Causa:** el comparador de `useVaultViewData` aplicava la direcció (`asc`/
    `desc`) també als valors buits, en comptes de fixar-los sempre al final.
  - **Fer:** els buits van SEMPRE al final, independentment de `direction` (com a
    Notion). Generalitza a TOTS els camps el que ja es feia per a dates:
    `const aEmpty = aVal.trim() === ''; if (aEmpty || bEmpty) { if (aEmpty && bEmpty) continue; return aEmpty ? 1 : -1; }`
    abans de la comparació numèrica/locale.
  - **Diagnòstic:** quan "falta" contingut a una taula, comprova primer
    `activeView.sort` (via fiber: `memoizedProps.activeView`) abans de sospitar
    del renderitzat; el comptador "N registres" segueix dient el total perquè el
    sort no filtra, només reordena.
