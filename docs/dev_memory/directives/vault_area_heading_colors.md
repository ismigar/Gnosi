# Directiva: Fons de color a les capçaleres de les pàgines d'Àrea

## Objectiu
A totes les pàgines de la taula **Àrees**, cada secció (capçalera `#`…`######`)
porta un color de fons fix segons el seu títol, perquè totes les àrees
comparteixen la mateixa estructura. És **purament visual**: no es toca el
contingut Markdown de la nota (cf. `feedback_content_storage_markdown`).

## Mapatge títol → color
| Capçalera (tolera accents/ortografia ca/es i wikilinks) | Color |
|---|---|
| Formació | blau |
| Experiència professional | rosa |
| Competències | marró |
| Desenvolupades | verd |
| A desenvolupar | vermell |
| Com contribueixen a … (telos) | groc |
| Recursos | gris |
| Projectes | morat |
| Notes i extractes | taronja |

## Implementació
- `frontend/src/components/Vault/areaHeadingColors.js`: `normalizeHeadingText`
  (treu wikilinks/accents/puntuació) + `areaHeadingColorKey` (match per prefix).
- `frontend/src/components/Vault/BlockEditor.jsx` (`EditorInner`):
  - `isAreaPage` = `metadata.table_id` resol a una taula amb nom normalitzat `arees`.
  - Efecte que injecta un `<style data-gnosi-area-headings>` amb regles
    `.bn-block[data-id="…"] > .bn-block-content { background: var(--area-<color>) }`,
    calculades des de `editor.document` (recursiu pels `children` de columnes),
    recalculades a `editor.onChange`.
- `frontend/src/index.css`: variables `--area-*` (variant clara + `.dark`).

## Restriccions / Edge cases (per què aquest disseny)
- **NO mutar el DOM de ProseMirror** (setAttribute/classList sobre `.bn-block*`):
  PM vigila el seu DOM, detecta la mutació externa, redibuixa el node i esborra
  la marca → bucle de ~46 redibuixats/s (agreujat per les vistes incrustades
  `gnosi_view` que recreen els nodes germans durant la càrrega).
- **NO usar decoracions de PM** (`Decoration.node/inline`, atribut o classe):
  BlockNote renderitza els blocs amb node-views de React que ignoren les
  decoracions externes (`props.decorations` s'invoca però no s'apliquen al DOM).
- **NO usar el `backgroundColor` natiu del bloc**: el markdown-mapper el
  serialitza com `<div style="background-color:…">`, embrutant el Markdown.
- **Sí**: `<style>` injectat indexat pel `data-id` (UUID estable que PM posa al
  `.bn-block` i preserva entre redibuixats), calculat des del MODEL. Cap mutació
  del DOM de PM → cap bucle; data-id estable → fons estable. Escapar el data-id
  amb `CSS.escape`.

Memòria relacionada: `feedback_blocknote_dom_styling`.
