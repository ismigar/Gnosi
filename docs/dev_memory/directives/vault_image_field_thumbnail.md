# Directiva: Camps d'imatge per nom → miniatura (taula + detall)

## Objectiu
Un camp de tipus `text` el NOM del qual sembla una imatge (Imatge, Cover, Foto,
Thumbnail, Imagen…) i el VALOR del qual és una ruta/URL d'imatge servible s'ha de
renderitzar com a **miniatura amb previsualització en hover** i **comportar-se
igual** a la cel·la de taula (`VaultTable`) i al panell de propietats del registre
(`BlockEditor`). En edició, clicar la miniatura obre el selector d'imatge.

## Punt de partida (bug)
`VaultTable.isImageField` tenia una guarda que excloïa QUALSEVOL camp amb tipus
declarat al schema (`schema[field] !== ''`), pensada per a "Imatge Alt Text".
Però "Imatge" també és de tipus `text` → quedava exclòs i es mostrava la ruta com
a **text cru** tant a la taula com al detall. El `BlockEditor`, a més, no tenia
cap detecció d'imatges: el caient (text/number/date) renderitzava un `<input>`.

Verificat al navegador (2026-05-31): la columna "Imatge" mostrava `Articles/x.jpg`
com a text als 19 registres; el detall, un input buit.

## Disseny

### Detecció pel NOM — `isImageFieldName(name)` (compartit)
A `frontend/src/lib/fileResource.js` (al costat de `toAssetPreviewUrl`). **Font
única** perquè taula i detall no divergeixin (era el requisit explícit de
"comportar-se igual"):
- Exclou noms amb `\balt\b|\btext\b|\bcaption\b|\bpeu\b|\bllegenda\b|\bleyenda\b|descrip`
  → "Imatge Alt Text" (prosa) NO és imatge.
- Després casa `/(image|imatge|cover|thumbnail|thumb|foto|imagen)/i`.

### Value-gate (la vora esmolada)
La detecció pel nom NO basta: la decisió final de mostrar miniatura comprova que
el VALOR resol a una imatge servible amb `toAssetPreviewUrl(valor)` (extensió
d'imatge + `toServedAssetUrl` → `/api/vault/assets/<path>`). Així:
- "Imatge" amb `Articles/x.jpg` → miniatura.
- Un camp imatge buit → afordament "+ Imatge" (només a edició) que obre el selector.
- "Imatge Alt Text" → exclòs pel nom; a més el seu valor (prosa) no resoldria.

### Tipus
La inferència pel nom només s'aplica a camps `text` (o sense tipus). Un
number/date/select/url/relació mai és imatge inferida:
- `VaultTable.isImageField`: `if (fieldType && fieldType !== 'text') return false;`
- `BlockEditor`: `(!prop.type || prop.type === 'text') && isImageFieldName(prop.name)`.

### Edició = selector (paritat)
Tots dos usen `InsertContentModal` (pestanyes Vault/Disc/Puja/URL), `fileField:null`,
valor únic (reemplaça). En inserir es desa la ruta relativa amb
`servedUrlToVaultPath(result.url)` (inversa de `toServedAssetUrl`: treu el prefix
`/api/vault/assets/`). A la taula ho fa `openMediaPicker` (ja existia); al detall
s'ha afegit una 2a instància d'`InsertContentModal` amb estat `imagePickerProp`.

## Fitxers crítics
| Path | Canvi |
|---|---|
| `frontend/src/lib/fileResource.js` | NOU `isImageFieldName`, `servedUrlToVaultPath` |
| `frontend/src/components/Vault/VaultTable.jsx` | `isImageField` value-/type-gatejat via `isImageFieldName` (elimina guarda massa àmplia) |
| `frontend/src/components/Vault/BlockEditor.jsx` | miniatura `ImageHoverPreview` al caient de propietats + 2a `InsertContentModal` (`imagePickerProp`) |

## Restriccions / Edge-cases (memoritzar)
- **No reescriure la guarda sense el value-gate**: si es marca un camp com a
  imatge sense comprovar el valor, un camp text mal anomenat mostraria "+ Imatge"
  en comptes del seu text. El render de taula ho value-gateja (`getImagePreviewUrlFromValue`);
  el detall amb `toAssetPreviewUrl`.
- **No duplicar la regex**: qualsevol vista nova (galeria/feed) que mostri imatges
  per nom ha d'importar `isImageFieldName`, no recrear la regex.
- **Ruta desada = relativa al vault** (`Articles/x.jpg`), no la URL `/api/...`.
- "Imatge URL" (XXSS) és tipus `url` → branca `url`, no afectat.

## QA (fet 2026-05-31, navegador HTTPS)
- Taula: columna "Imatge" → `<img>` d'assets amb `naturalWidth>0` (carreguen);
  "Imatge Alt Text" → text. Sense regressió a date/select/multi_select.
- Detall: "Imatge" → miniatura clicable; clic obre InsertContentModal (tanca amb
  Esc sense canviar dades); "Imatge Alt Text" → input text.
- `vite build` net (14.7s); ESLint sense errors nous als 3 fitxers.
- Nota d'entorn: el dev server és **HTTPS** a 5173 (veure memòria `feedback_dev_server_https`).
