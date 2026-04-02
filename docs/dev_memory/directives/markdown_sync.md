# Directiva: Sincronització de Markdown Enriquit (Markdown Sync)

## Objectiu
Mantenir la compatibilitat total entre l'editor de blocs (Gnosi) i els editors de text pla (Obsidian), permetent alhora funcionalitats avançades de disseny (Notion-like) i facilitant el processament per part de LLMs.

## Protocol de Conversió (Mapper)

### 1. De Blocs a Markdown (Exportació)
- **Text Estàndard**: Utilitzar Markdown pur (`#`, `*`, `-`, `1.`, etc.).
- **Estils Inline**: 
  - Colors: Utilitzar `<span style="color: [color]">text</span>`.
  - Backgrounds: Utilitzar `<span style="background-color: [color]">text</span>`.
- **Contenidors (Columnes, Toggles)**:
  - Utilitzar la sintaxi `:::` (Directives tipus Markdown-it/Markdoc).
  - Exemple de columnes:
    ```markdown
    :::column-list
    :::column
    Contingut col 1
    :::
    :::column
    Contingut col 2
    :::
    :::
    ```
- **Bases de Dades / Vistes**:
  - Utilitzar blocs de codi amb l'identificador `gnosi-database`.
  - Exemple:
    ```markdown
    ```gnosi-database
    { "table_id": "articles", "view": "kanban" }
    ```
    ```

### 2. De Markdown a Blocs (Importació)
- L'editor ha de parsejar el fitxer `.md` en carregar-lo.
- Si troba un JSON (per retrocompatibilitat), l'ha de carregar normalment.
- Si troba Markdown pur o enriquit, ha d'utilitzar el parser per reconstruir els objectes de bloc de BlockNote.

## Restriccions i Edge Cases
- **Lossless vs Lossy**: En convertir a Markdown, alguns metadades de l'editor de blocs es poden perdre si no s'especifiquen clarament. Cal prioritzar la legibilitat del text.
- **IDs de Blocs**: Si l'editor necessita IDs únics per cada bloc, aquests s'han de guardar com a atributs HTML o comentaris si es vol mantenir la sincronització de comentaris/converses per bloc.
- **LLM**: El format `:::` és molt fàcil d'entendre per a models tipus Gemini/Claude/GPT, ja que delimita clarament les estructures.

## Flux de Treball
1. L'usuari edita a Gnosi.
2. Gnosi converteix els blocs a Markdown Enriquit.
3. El backend rep i guarda el `.md`.
4. Si l'usuari edita el `.md` a Obsidian i torna a Gnosi, Gnosi ha de ser capaç de reinterpretar el contingut.
