# DIRECTIVE: VAULT_TABLE_ENHANCEMENTS

> ID: 2026-02-27
> Associated Script: monorepo/apps/gnosi/frontend/src/components/Vault/VaultTable.jsx
> Status: ACTIVE

---

## 1. Objectives and Scope

Millorar l'experiència d'usuari i la potència de processament de dades dins de la vista de taula del Vault.

- **Main Objective:** Implementar edició en línia, capçaleres fixes, agregacions i suport per fórmules.
- **Success Criteria:** L'usuari pot editar cel·les sense obrir la nota, veure totals al peu, i les capçaleres es mantenen fixes.

## 2. Input/Output (I/O) Specifications

### Inputs
- `notes`: Array d'objectes nota amb metadades.
- `schema`: Configuració dels tipus de propietat per columna.
- `templates`: Llista de plantilles disponibles.

### Outputs
- Crides a `save_page` (API) per actualitzar metadades en edició en línia.
- Crides a `create_page` amb `template_id` per a nous registres.

## 3. Logical Flow (Algorithm)

1. **Sticky Header:** Aplicar classes CSS `sticky` i `top-0` amb un `z-index` superior a `thead`.
2. **Inline Editing:**
    - Detectar clic en cel·la (excloent el títol si es prefereix obrir).
    - Canviar el node de text per un component d'entrada (`input`, `select`, `datepicker`).
    - En perdre el focus (`onBlur`) o prémer `Enter`, validar el canvi.
    - Capturar el valor i cridar l'API `PUT /api/vault/pages/{id}` actualitzant només el camp afectat dins del bloc de metadades.
3. **Aggregations:**
    - Calcular sumes, mitjanes i comptatges dinàmicament sobre l'array `sortedNotes`.
    - Renderitzar un `tfoot` al final de la taula.
4. **Keyboard Shortcuts:**
    - Afegir un `EventListener` global per a `Cmd+O` que obri la nota seleccionada (requereix sistema de selecció de fila).
5. **Formulas:**
    - Si el `schema` indica una formula, el frontend hauria de calcular el valor visualment o el backend hauria de processar-lo en el moment de desar.

## 4. Tools and Libraries

- **React Hooks:** `useState`, `useEffect`, `useMemo`, `useCallback`.
- **Lucide React:** Icones per a les accions.
- **Tailwind CSS:** Per al posicionament `sticky` i estils premium.

## 5. Restrictions and Edge Cases

- **Concurrency:** Si dos usuaris editen cel·les diferents de la mateixa nota, l'últim en desar guanya (overwrite total del fitxer .md). *Nota futura: Implementar patch parcial d'atributs.*
- **Tipus de dades:** Les dates han de ser normalitzades abans de desar-se al frontmatter YAML.
- **Performance:** Amb taules de >1000 files, l'scroll pot ser lent si no s'usa virtualització (no aplicada encara).

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 27/02 | Header disappear on horizontal scroll | `sticky` header needs `left-0` for the first column and base `bg` to avoid transparency. | Use `bg-slate-50` and ensure `z-index` covers body rows. |

## 7. Examples of Use

```javascript
// Exemple d'edició en línia
const handleCellBlur = (noteId, field, newValue) => {
  const updatedNote = { ...note, metadata: { ...note.metadata, [field]: newValue } };
  api.savePage(noteId, updatedNote);
};
```
