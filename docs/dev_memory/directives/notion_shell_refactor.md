# Directiva: Refactorització Interfície Estil Notion

L'objectiu d'aquesta directiva és establir els principis de disseny i implementació per replicar l'experiència d'usuari de Notion dins del Digital Brain Vault.

## Principis de Disseny (SOP)

1. **Hierarchy & Shell**:
   - Tota la navegació principal resideix en una **Sidebar** col·lapsable a l'esquerra.
   - El contingut central és una **Pàgina de Blocs** amb amples marges laterals (configurable a "Full width").
   - La capçalera de la pàgina és minimalista i conté exclusivament breadcrumbs, el botó de preferit (estrella) i accions de pàgina (més opcions).

2. **Content Flow**:
   - Una nota és inicialment una pàgina en blanc.
   - Les metadades (propietats) no han d'ocupar espai visual per defecte si no s'han definit, imitant el botó "Add property" de Notion.
   - Les bases de dades (Taules, Taulers) s'han de tractar com a **blocs inseribles** dins del flux de text (`/table`, `/board`).

3. **Interactivitat**:
   - Implementar el menú de comandos `/` per a la inserció ràpida de blocs.
   - El redimensionament d'imatges i l'arrossegament de blocs (drag & drop) han de ser natius de l'editor.

## Restriccions i Advertències

- **No duplicar navegació**: Si hi ha una sidebar, els menús superiors de navegació de carpetes han de desaparèixer per evitar redundància.
- **Idempotència de metadades**: La modificació del layout de metadades (de card a llista tipus Notion) no ha de trencar la compatibilitat amb el frontmatter de Markdown existent.
- **Estils**: Utilitzar una paleta de colors neta, amb blancs trencats, grisos suaus i tipografies modernes (Inter, system fonts).

## Procés d'Implementació

1. **Shell Integration**: Crear el contenidor principal amb `Sidebar` i `Main`.
2. **Favorite Logic**: Implementar el sistema de marcatge de notes favorites al frontmatter.
3. **Block Discovery**: Expandir els `CustomBlocks` de BlockNote per integrar les vistes de base de dades existents (`VaultTable`, `VaultKanban`).
