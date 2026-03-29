# Memòria/Directiva de Gestió de Vistes del Vault

Aquesta directiva defineix com s'han d'implementar i mantenir les vistes de dades (taules, galeries, kanbans, timelines) al Vault de Gnosi, assegurant consistència en el filtratge, l'ordenació i la cerca.

## Protocol d'Implementació de Vistes

### 1. Lògica de Dades Unificada (`useVaultViewData`)
Totes les vistes han d'utilitzar el hook `useVaultViewData` per processar les notes. No s'ha d'implementar lògica de filtratge o ordenació ad-hoc dins dels components de vista.

**Camps de configuració de vista:**
- `filters`: Objecte amb `conjunction` ('and'|'or') i `conditions` (array de condicions o grups).
- `sorts`: Array d'objectes `{ field, direction }`.
- `search`: String per a la cerca textual global.
- `visibleProperties`: Array de noms de propietats a mostrar.

### 2. Toolbar de Vista (`VaultViewToolbar`)
Cada vista ha de mostrar una capçalera o línia d'eines que contingui:
- Un input de cerca que filtri en temps real sobre totes les propietats visibles (o el títol/contingut).
- Un botó d'accés ràpid per obrir/tancar el panell de filtres.
- Un indicador de quants filtres i ordenacions hi ha actius.

### 3. Configuració Persistent
- Les configuracions de vista s'emmagatzemen al `vault_db_registry.json` a través de l'endpoint `/api/vault/views`.
- En el cas de les vistes incrustades (`InlineDatabase` a `BlockEditor`), les configuracions es guarden com a atributs del bloc per permetre vistes personalitzades per pàgina.

## Restriccions i Casos Particulars
- **Cerca**: Ha de ser "fuzzy" o almenys case-insensitive sobre el títol i les metadades de la nota.
- **Dates**: L'ordenació de dates ha de tenir en compte els formats ISO i la falta de valors (mantenint els buits al final).
- **Relacions**: El filtratge per relacions ha de permetre el valor especial `{{self}}` per filtrar notes que enllacen a la pàgina actual (Backlinks).
- **Consistència Visual**: Les vistes incrustades han de tenir la mateixa aparença i funcionalitat que les vistes a pantalla completa del Dashboard.

## Validació
Abans de donar per bona una vista, cal verificar:
1. Que el cercador funciona correctament tant en taula com en galeria.
2. Que en afegir un filtre des del modal de configuració, aquest s'aplica immediatament i es guarda.
3. Que l'ordenació per múltiples columnes prioritza els camps segons l'ordre definit a l'array de `sorts`.
