# Directiu: Tipus de camp "Autoria"

> ID: AUTORIA-FIELD-20260520
> Estat: esborrany — pendent d'implementació i validació.
> Relacionat: `zotero_integration.md` (camp `creators`), motor CSL a `cslEngine.js`.

---

## 1. Objectiu

Introduir un tipus de camp del Vault `autoria` que emmagatzemi els autors com a
**llista ordenada d'objectes estructurats** `{ nom, cognom1, cognom2 }`, en lloc
d'un string lliure, per tal de generar citacions correctes i deterministes.

## 2. Motivació (causa arrel)

Avui els autors viuen com a **string lliure** a `metadata['Authors']` i es
parsegen amb una heurística a `parseAuthors`
(`monorepo/apps/gnosi/frontend/src/components/Vault/cslEngine.js:149-187`).

El propi comentari del codi admet que el cas de la coma és *"perillós"*
(`cslEngine.js:151-155`): no pot distingir de forma fiable

- `"Smith, A."` → un autor (Cognom, Inicial), de
- `"Margulis, Olendzenski"` → dos autors (dos cognoms).

Aquesta ambigüitat produeix citacions incorrectes. Un tipus estructurat
**elimina l'endevinalla a l'origen**: l'usuari declara els components del nom una
vegada i el motor CSL ja no ha d'inferir res.

## 3. Model de dades

- **Slug del tipus:** `autoria`.
- **Valor a `metadata`:** array **ordenat** (l'ordre d'autors és significatiu per
  citar) d'objectes:

  ```json
  [
    { "nom": "Lynn", "cognom1": "Margulis", "cognom2": "" },
    { "nom": "Dorion", "cognom1": "Sagan", "cognom2": "" }
  ]
  ```

- **Persistència:** transparent. `handleCellSave` envia el valor tal qual al
  PATCH (`VaultTable.jsx:726` → `body: { metadata: { [key]: newValue } }`) i el
  backend fa `metadata.update(...)`. Un array d'objectes es serialitza sol al
  frontmatter YAML niat. **No cal canvi de backend per a l'emmagatzematge**;
  només, si de cas, per a validació de tipus (avui inexistent).

- **NO afegir `autoria` a `TRANSLATABLE_FIELD_TYPES`** (`SchemaConfigModal.jsx:43`):
  és estructura, no text lliure traduïble.

## 4. Mapping a CSL (el punt que fa "citacions correctes")

CSL / citeproc-js **no té concepte de segon cognom**: només `family`, `given`
(+ partícules i sufix). Decisió normativa:

```
given  = nom
family = (cognom1 + " " + cognom2).trim()   // cognom compost en un sol camp
```

Així s'ordena i es mostra com una unitat ("Margulis Sagan, L."), comportament
correcte en català/castellà.

**Integració a `recursosPageToCsl` (`cslEngine.js`): IMPLEMENTAT.** En lloc de
passar l'schema, el camp `autoria` es detecta **per forma del valor**
(`findStructuredAuthors`): el primer valor de metadata que és un array d'objectes
amb claus `nom`/`cognom1`/`cognom2`. És independent del nom de columna (cosmètic)
i no necessita plumbing d'schema pels consumidors (`CiteInline`,
`BibliographyBlock` només passen `page.data`).

1. Si es detecta autoria estructurada → `structuredAuthorsToCsl` mapeja amb el
   mapping de dalt i **se salta `parseAuthors`**.
2. Si no → fallback a `parseAuthors(m['Authors'])` (string legacy).

## 5. Punts d'integració (frontend)

| Fitxer | Què tocar |
|---|---|
| `frontend/.../Vault/SchemaConfigModal.jsx:107-125` | Afegir `<option value="autoria">` a l'enum de tipus. |
| `frontend/.../Vault/VaultTable.jsx:1191` (zona edit) | Branca d'edició nova: component `AutoriaEditor` (anàleg a `InlinePillsPicker:10`, però cada pill té 3 subcamps + reordenació). |
| `frontend/.../Vault/VaultTable.jsx:1284` (switch display) | `case 'autoria':` que renderitzi pills "Nom Cognom1 Cognom2" i toleri array buit (el guard de `value === ''` a la línia 1238 **no** captura `[]`). |
| `frontend/.../Vault/cslEngine.js:189` | Branca structured→CSL (vegeu §4). |
| Autocompletar | Derivar suggeriments d'autors ja existents a la taula (dedup per `cognom1+cognom2+nom`); `getAvailableOptions:942` és per a strings, no serveix tal qual. |

## 6. Pla d'evolució

| Fase | Estat | Resum |
|---|---|---|
| 1. Tipus + editor + render | ✅ | Enum + i18n (ca/en/es/fr); `AutoriaEditor` (pills {nom,cognom1,cognom2}, ordenar, autocompletar); `case 'autoria'`. |
| 2. Integració CSL | ✅ | `findStructuredAuthors` + `structuredAuthorsToCsl` a `cslEngine.js`; detecció per forma del valor; fallback a `parseAuthors`. |
| 3. Migració | ✅ | `pipeline/sandbox/migrate_autoria.py`: dry-run per defecte, no destructiva, idempotent. **Apply EXECUTAT (2026-05-20)** sobre Recursos: type→`autoria`, 150 convertits, 125 ambigus deixats com a string ("-"), 28 buits. Backup a `autoria_backup_*.json`. |
| 4. Zotero Z→G autoria-aware | ✅ | `zotero_to_vault.py` escriu autors **estructurats** quan el camp de creators és tipus `autoria` (`firstName`→`nom`, `lastName`→`cognom1`, `cognom2` buit); fallback a string per a camps `text`/`rich_text`. G→Z no afectat (`creators` és READ_ONLY). Tests a `test_zotero_sync_scripts.py`. |

**Aprenentatges de la migració (self-correction):**
- **ORDRE DE DESPLEGAMENT (crític):** desplegar PRIMER el frontend (merge +
  rebuild/HMR a `~/Projectes/monorepo`), DESPRÉS executar la migració. La
  migració flipa la columna a type `autoria`; només el frontend nou sap
  renderitzar-lo. Si es migra contra l'app antiga, les cel·les convertides
  (arrays) cauen al render `default` i trenquen React.
- **APPLY canvia el `type` PRIMER.** Un array d'objectes en una columna `text`
  fa petar el render de React (objectes com a fills). Per això l'apply flipa
  el type a `autoria` abans de convertir cap valor.
- **Gate per ambigus:** apply avorta si queden valors ambigus (els amagaria com
  a "-"); cal `--force` per acceptar-ho conscientment. Els valors deixats com a
  string es preserven i segueixen citant via `parseAuthors`.
- **Heurística d'inicials:** un punt NO basta com a senyal d'inicials — les dades
  reals posen punt després del nom sencer ("Friedrich. Engels" = DOS autors).
  Cal exigir inicials d'una lletra ("A.", "J. R.") o un sol token.
- **Separadors d'autor fiables:** `;` i salt de línia. La coma és AMBIGUA (tant
  "Cognom, Nom" com "Autor1, Autor2") → només segura si va amb inicials/sol token.
- **Cognoms compostos** ("García Fernández", "Ortega y Gasset") van sencers a
  `cognom1`, `cognom2=""` (mai partim el cognom: no es pot saber de forma fiable;
  la citació surt igual de correcta).

**QA:** `npm run build` ✅ (0 errors). Prova interactiva al navegador **feta**
(2026-05-21, entorn HMR `~/Projectes/monorepo` + sessió autenticada): es va
detectar i corregir un **bug de layout** al panell de propietats (vegeu §7,
"Alçada de fila"). Mesures DOM post-fix: 0 solapaments entre files; fila
`autoria` creix a ~85px segons el nombre d'autors; etiqueta top-alineada.

## 7. Restriccions / edge cases

- **Array buit `[]`:** el guard `value === undefined||null||''` (`VaultTable.jsx:1238`)
  no el captura → el `case 'autoria'` ha de mostrar "-" explícitament.
- **Valors legacy string:** render i CSL han de tolerar un string (fallback) fins
  que la migració de Fase 3 s'hagi executat.
- **Ordre:** preservar sempre l'ordre de la llista; no és un set com `multi_select`.
- **CSL llegeix per clau, no per id:** `recursosPageToCsl` hardcoda noms
  (`'Authors'`, `'Citation Key'`, `'Any'`...). En afegir la detecció per tipus,
  no trencar la lectura de la resta de camps.
- **Alçada de fila al panell de propietats (BlockEditor):** la cel·la de valor
  del grid `grid-cols-[140px_1fr]` tenia alçada FIXA `h-8` (32px). Els editors
  **multi-línia** (`autoria`, i també `files`/`relation`/`multi_select` —
  `MultiSelectPills` fa `min-h-[42px]`) desbordaven i es **superposaven** amb les
  files veïnes. Fix (2026-05-21, `BlockEditor.jsx:3107` + etiqueta `:3101`): la
  cel·la de valor usa `min-h-[2rem] py-1` (creix amb el contingut) per a aquests
  tipus, i l'etiqueta `self-start` (top-alineada). Regla: qualsevol tipus de camp
  amb editor multi-línia NO pot anar en una cel·la d'alçada fixa.

## 8. Decisions obertes (a confirmar amb l'usuari)

1. **Rol del creador** (autor/editor/traductor): afecta cites com "(ed.)" i
   l'alineació amb Zotero. L'spec actual és estrictament `{nom, cognom1, cognom2}`;
   es deixa `rol` com a **extensió futura opcional** (default: autor) per no
   ampliar l'abast ara.
2. **Zotero `creators` és read-only i té un sol `lastName`** (regla 3 de
   `zotero_integration.md`): en l'import Z→G, `cognom2` quedarà buit. Limitació
   coneguda, no bloqueja les citacions (frontend/CSL).
3. **Camp destí:** ¿reconvertim la columna "Authors"/"Autors" existent a `autoria`,
   o creem un camp nou? Afecta la migració de Fase 3.

## 9. Fitxers crítics

| Path | Rol |
|---|---|
| `monorepo/apps/gnosi/frontend/src/components/Vault/SchemaConfigModal.jsx` | Enum de tipus de camp. |
| `monorepo/apps/gnosi/frontend/src/components/Vault/VaultTable.jsx` | Edició i render de cel·les per tipus. |
| `monorepo/apps/gnosi/frontend/src/components/Vault/cslEngine.js` | Mapping pàgina→CSL i generació de citacions. |
| `monorepo/apps/gnosi/frontend/src/components/Vault/BibliographyBlock.jsx` | Render de bibliografia (consumidor de CSL). |
