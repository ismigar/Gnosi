# Directiva: PDF Quote Capture (subratllats → cites al document)

> ID: PDF-QUOTE-CAPTURE-20260528
> Estat: Esquelet (component creat, cablejat al panell Vault pendent).
> Relacionada: `gnosi_native_reference_manager.md` (P5 — capacitats ja completes
> al refactor L1-L3 + PRs #240-#248), `zotero_reader_translation_contribution.md`.

---

## 1. Objectiu

Permetre que un subratllat al PDF (via visor zotero-reader integrat) es pugui
inserir al document Markdown del Vault com una **quote amb cita formatada**:

```markdown
> El text capturat de la anotació, exactament com l'usuari l'ha subratllat.
>
> — [@author2024], p. 47
```

Al render, `[@author2024]` es resol amb `CiteInline` com qualsevol altra cita,
i la cita queda lligada a la bibliografia del document automàticament.

## 2. Estat actual

**Ja existeix:**
- Visor PDF (zotero/reader vendor) integrat a `ZoteroReaderTab.jsx`.
- Persistència d'anotacions a `pdf_annotations` (SQLite via `/api/vault/pdf-annotations`).
- Format canonical Zotero (highlights amb `text`, `pageIndex`, `color`).
- Component nou **`PdfAnnotationsToCite.jsx`** (PR #249, *aquest commit*):
  - Llista les anotacions d'un PDF (per `source_uri`).
  - Botó "Copy as quote markdown" per cada anotació.
  - Posa al portaretalls la quote amb la cita resolta a la `citationKey` del Recurs.

**Falta cablejar:**

### A) Detecció del PDF associat a un Recurs

Cada pàgina de Recursos pot tenir un PDF associat al frontmatter via:
- `attachment_path: "/Users/.../Biblioteca/article.pdf"` (Phase 6)
- `URL: "file:///Users/.../Biblioteca/article.pdf"` (alternatiu)

Cal una funció helper (frontend) que llegeixi `metadata` i retorni
el `sourceUri` canonical:

```js
function getPdfSourceUri(metadata) {
    const attachment = metadata?.['attachment_path'] || '';
    if (attachment) return `file://${encodeURI(attachment)}`;
    const url = metadata?.['URL'] || '';
    if (url.startsWith('file://') && /\.pdf$/i.test(url)) return url;
    return null;
}
```

### B) Ubicació al UI del Vault

Tres opcions (decisió pendent):

1. **Panell Propietats del Recurs** — secció expandible "Subratllats del PDF"
   després de "Zotero Extras". Sempre visible si el Recurs té PDF.

2. **Pestanya al BlockEditor** — quan estàs editant un Recurs amb PDF,
   apareix una pestanya "Quotes" al costat de "Propietats". Més separat,
   menys clutter al panell principal.

3. **Sidebar global** — quan obres un document de notes que cita un Recurs,
   apareixen automàticament les quotes disponibles per cita. Més invasiu
   però redueix la barrera per usar-les.

Recomanació: **opció 1** com a primera entrega — mínim canvi al layout.

### C) Cablejat als components consumidors

Al `BlockEditor.jsx`, just després de `<ZoteroExtrasSection ...>`:

```jsx
import { PdfAnnotationsToCite } from './PdfAnnotationsToCite';

const sourceUri = getPdfSourceUri(metadata);
const citationKey = metadata?.['Citation Key'];

{sourceUri && (
    <PdfAnnotationsToCite
        sourceUri={sourceUri}
        citationKey={citationKey}
        readOnly={!isEditor}
    />
)}
```

### D) Refinements opcionals

- **Drag & drop**: arrossegar una quote directament al document en lloc
  de copy/paste. Necessita HTML5 drag API + dropzone al BlockEditor.
- **Subratllat sense text** (notes): el visor Zotero suporta anotacions
  de tipus `note` (icona, no highlight). El component les inclou si tenen
  `comment`; cal verificar a producció.
- **Citation Key amb localització de pàgina**: ara hardcoded a `p. {pageIndex+1}`.
  Si l'estil CSL té convencions diferents (pp., loc., chap.), caldria
  parametritzar. citeproc-js no suporta locator inline al `[@key]` —
  cal usar la sintaxi `[@key, p. 47]` que pandoc-citeproc sí entén.

## 3. Restriccions i edge cases

- **Sense PDF**: el component mostra un missatge informatiu en lloc d'amagar-se.
  Decisió: avisar perquè l'usuari sàpiga que pot afegir un PDF si vol quotes.
- **Anotacions sense text**: highlights estructurals (només quadre, sense
  text extret) s'ometen — no fan quote útil.
- **Multillinia**: si el text té salts de línia, el blockquote markdown
  conserva l'estructura amb `> ` a cada línia. Verificar a producció.
- **Privacy**: les anotacions són locals (SQLite). Cap cosa s'envia a un
  servidor extern.

## 4. Roadmap

| Pas | Què | Cost |
|---|---|---:|
| ✅ | Component `PdfAnnotationsToCite.jsx` | fet (PR #249) |
| ✅ | Helper `getPdfSourceUri(metadata)` (frontend) | fet |
| ✅ | Integració al BlockEditor (opció 1) | fet |
| ⏳ | Smoke test E2E: PDF → subratllar → quote → render | 1 hora |
| ⏸ | Drag & drop de quote al document | 1 dia |
| ⏸ | Suport `[@key, p. 47]` amb pandoc-citeproc | 1 dia |

**v1 funcional desplegada.** L'usuari pot veure els subratllats al panell
Propietats d'un Recurs amb PDF associat i copiar-los com a quote markdown
amb cita formatada.

## 5. Cicle d'aprenentatge

| Data | Aprenentatge | Solució |
|---|---|---|
| 2026-05-28 | El visor Zotero ja exposa annotacions canonical via endpoint propi; no cal reinventar el storage. | Component nou simplement consumeix `/api/vault/pdf-annotations`. |
