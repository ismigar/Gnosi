# Directiva: Substitució de Nodes de Notion a n8n

## 1. Objectiu
Traslladar la lògica d'automatització que actualment depèn de Notion cap al ecosistema local del Digital Brain, substituint els triggers i les accions de n8n per crides a l'API pròpia i l'ús de fitxers Markdown.

## 2. Anàlisi de Workflows Actuals

### Sincro Publicacions Notion -> Temenos (ID: `P7PTDH3uqldJn62X`)
*   **Triggers Actuals**: 4 nodes `notionTrigger` (Articles, Dissenys, Recursos, Col·laboradores) que fan polling cada minut.
*   **Accions Clau**:
    *   `GetOriginalChildBlocks`: Obté el contingut en format blocs.
    *   `Create...Translations`: Crea pàgines de traducció a Notion.
    *   `Update...Translation`: Actualitza l'estat i les dates a Notion.
    *   `AppendNotionBlocks`: Injecta blocs traduïts.
    *   `Create a database page` (XXSS): Popula la "base de dades" de xarxes socials.

### Social Media Poster (ID: `mq7a87jtpocdw34o`)
*   **Trigger**: Webhook (`social-post-v2`) enviat des del backend.
*   **Estat**: Ja està parcialment desacoblat de Notion, però la font de dades dels posts sovint prové de la sincronització anterior.

## 3. Estratègia de Substitució

### Triggers (Notion -> Webhook Push)
En lloc de fer polling a Notion, el Digital Brain notifica a n8n quan una nota es crea o es desa.
*   **Mecanisme**: El backend (`vault_routes.py`) ja té la funció `trigger_n8n_webhook`.
*   **Endpoint n8n**: `POST http://n8n:5678/webhook/vault-update`
*   **Payload**: Conté l'esdeveniment, el nom del fitxer i part del contingut.
*   **Implementació**: Configurar el node `Webhook` a n8n per rebre aquestes notificacions i filtrar pel "path" (directori) per saber a quina "base de dades" pertany la nota.

### Accions (Notion Node -> HTTP Request)
Totes les operacions de CRUD es realitzaran contra l'API del backend:
*   **Crear**: `POST /api/vault/pages`
*   **Actualitzar**: `PATCH /api/vault/pages/{id}`
*   **Llegir**: `GET /api/vault/pages/{id}`
*   **Cercar**: `GET /api/vault/pages` (amb filtres de metadades o carpeta).

### Gestió de Contingut (Blocs -> Markdown)
*   La substitution elimina la necessitat de demanar blocs a Notion.
*   La lògica de `notionBlocksToHtml&MD` es pot simplificar per processar directament el Markdown del fitxer lloc o utilitzar el parser ja existent si es vol mantenir la compatibilitat amb blocs Markdown.

## 4. Protocol de Migració (Pas a Pas)

1.  **Registre de Taules**: Afegir les bases d'articles, dissenys, etc., a `vault_db_registry.json`.
2.  **Preparació del Backend**: Assegurar-se que el `trigger_n8n_webhook` inclou prou metadades per diferenciar entre una nota personal i un article per publicar.
3.  **Redisseny de Workflows**:
    *   Substituir el Trigger de Notion per un Webhook.
    *   Substituir els nodes Notion per nodes `HTTP Request` apuntant al `host.docker.internal:5002`.
    *   Adaptar els nodes `Code` per llegir propietats del YAML frontmatter en lloc de l'objecte `properties` de Notion.
4.  **Consolidació de XXSS**: Moure la base de dades de XXSS al Vault local i fer que el "Social Media Poster" llegeixi directament d'aquí via API.

## 5. Restriccions i Riscos
*   **UUIDs**: Cal mantenir la consistència entre els IDs de les notes locals i les referències a Drupal per no duplicar contingut.
*   **Sincronització inicial**: Cal assegurar-se que totes les notes actuals de Notion estiguin correctament descarregades al Vault abans d'apagar els triggers de Notion.
