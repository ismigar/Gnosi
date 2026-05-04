# DIRECTIVE: VAULT_SLASH_COMMANDS_MANAGEMENT

> ID: 2026-03-18
Associated Script: N/A (Frontend Integration) Last Update: 2026-03-18
Status: ACTIVE

---

## 1. Objectives and Scope

*   **Main Objective:** Ensure that the BlockNote editor in the Gnosi Vault correctly displays and executes all database-related slash commands (Table, List, Kanban, etc.).
*   **Success Criteria:** Typing `/` in the editor shows a menu with "Base de dades" and specific view types (Taula, Llista, etc.) that, when selected, insert a functional `inline_database` block.

## 2. Input/Output (I/O) Specifications

### Inputs
- **Source Files:**
    - `monorepo/apps/gnosi/frontend/src/components/Vault/BlockEditor.jsx`: Main editor component.
    - `monorepo/apps/gnosi/frontend/src/components/Vault/slashMenuUtils.js`: Catalog of available commands.
    - `monorepo/apps/gnosi/Library/CloudStorage/OneDrive-UNED/Gnosi/vault_db_registry.json`: Source of truth for existing tables.

### Outputs
- **Functional UI:** A working slash menu with categorized items.

## 3. Logical Flow (Algorithm)

1.  **Registry Loading:** The editor must receive the `registry` and `allTables` from the parent context.
2.  **Custom Block Registration:** The `inline_database` block must be registered in the BlockNote schema using `BlockNoteSchema.create` or handled via a custom `BlockSpec`.
3.  **Slash Menu Generation:** 
    - Use `getDefaultReactSlashMenuItems(editor)` as the base.
    - Append items generated from `buildSlashCommandCatalog()` in `slashMenuUtils.js`.
    - Map each item's `onItemClick` to `editor.insertBlock` with `type: "inline_database"` and relevant props (`database_table_id`, `viewType`, etc.).
4.  **Filtering:** The `getItems` function of `SuggestionMenuController` must filter based on both title and aliases.

## 4. Tools and Libraries

- **BlockNote SDK (@blocknote/react, @blocknote/core)**: Version 0.47.1+.
- **Lucide React**: For menu icons.

## 5. Restrictions and Edge Cases

- **Block Insertion:** Do not use `insertOrUpdateBlockForSlashMenu` to insert generic paragraphs if the intent is to create a database view.
- **Context Availability:** Ensure `VaultEditorContext` provides all necessary methods (`onCreateRecord`, `onEditSchema`) to the `InlineDatabase` component.
- **Registry Sync:** If the registry is empty, show a fallback message or a "Create Table" action.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 18/03 | Desaparición de comandos BD | Comandos hardcodeados insuficientes y falta de registro de bloque. | Reintegrar `slashMenuUtils.js` y registrar `inline_database` block. |
| 04/04 | Menú `/` sin comandos útiles y `[[` sin sugerencias | `buildSlashCommandCatalog` invocado sin contexto (`allTables`, `editor`) y filtrado no defensivo sobre `item.title`; no había `SuggestionMenuController` para enlaces wiki. | Pasar contexto explícito al catálogo, filtrar por `title/aliases` de forma segura y añadir controlador `[` para sugerencias de notas internas con inserción de `[[Nota]]`. |
| 05/04 | No se podía enlazar rápidamente una nota inexistente | El menú de sugerencias solo listaba notas ya creadas, sin acción de alta contextual | Añadir acciones “Crear al Wiki” y “Crear a taula X” desde sugerencias de `[[...]]` y `![[...]]`, creando la página y enlazándola automáticamente. |

## 8. Pre-Execution Checklist

- [x] Verify current BlockNote version (0.47.1).
- [x] Confirm existence of `InlineDatabase` component.
- [ ] Ensure `slashMenuUtils.js` is imported in `BlockEditor.jsx`.

## 9. Post-Execution Checklist

- [ ] Verify `/taula`, `/llista`, etc. appear in the menu.
- [ ] Verify selection inserts a placeholder `InlineDatabase` block.
- [ ] Confirm clicking "Triar taula" works and updates the block correctly.
