# Directiva: valor del filtre coherent amb el tipus de camp

## Objectiu
Al modal "Edita la vista de BD" (PageViewModal, pestanya **Filtres**), el control
del **valor** ha de casar amb el tipus del camp seleccionat. L'usuari va reportar
que `Arxivar` (un checkbox sí/no) oferia un input de text lliure ("this o valor"),
que no té sentit.

## Abast
- Toca NOMÉS el control de **valor** (no la llista d'operadors).
- Tipus amb control dedicat i **autocontingut** (sense dades extra):
  - `checkbox` → un **checkbox** (igual que el camp), amb etiqueta Marcat/Sense marcar → emet `"true"`/`"false"`. Default `'false'` (no buit) perquè la comparació booleana casi també els buits. (Un desplegable de 3 estats era una complicació innecessària.)
  - `number` → `<input type="number">`.
  - `date`/`datetime` → `<input type="date">` (o `datetime-local`).
  - `relation` → `RelationValuePicker` (ja existia).
  - resta (`text`, `status`, `select`, `multi_select`, `url`, `period`…) → text (com abans).

## Restriccions / Casos límit (apreses)
- **`select`/`status`/`multi_select` NO porten `options` al registre** (`/api/vault/registry`
  torna `options:null`); per oferir-ne un desplegable caldria replicar la càrrega de
  `/api/graph` (cf. memòria `feedback_graph_field_default_typed_control`). → De moment
  es deixen com a text per no mostrar un desplegable buit.
- **Els checkbox es desen com a booleà** (`true`/`false`); un camp **sense marcar
  sovint és absent** (metadata sense la clau), no `false` explícit.
- Hi ha **DOS motors de filtre** i tots dos han de tractar el booleà igual:
  - Frontend viu: `utils/vaultFilters.js` → `matchesFilters` (sense info de tipus).
  - Backend snapshot: `services/view_snapshot.py` → `apply_filter` (port 1:1).
  - Problemes previs: `equals "false"` no casava files sense valor (unset → `''`); i el
    backend feia `str(True)`→`"True"` i comparava **sense `lower()`** → `equals "true"` fallava.
- **Solució**: quan el valor del filtre és exactament `"true"`/`"false"`, `equals`/`not_equals`
  comparen amb coerció booleana (paritat amb `rule_engine._is_truthy_checkbox`:
  truthy = `{true,1,yes,si,sí,done,checked,completat}`; buit/0/false = no marcat).
  No afecta cadenes literals "true"/"false" (mateix resultat) ni altres valors.

## QA
- Build frontend net.
- `equals true` mostra només marcats; `equals false` mostra no-marcats **incloent els sense valor**.
- Verificar al navegador amb el camp `Arxivar` de la taula Àrees.
