---
name: n8n
description: Interacción programática y gestión de n8n (Listar, Backup, Test)
---

# Skill: Interacción con n8n

> **Status:** ACTIVE
> **Associated Scripts:** `scripts/*.py`

## 1. Objetivo
Establecer un estándar para interactuar programáticamente con la instancia de n8n del Gnosi.

## 2. Prerrequisitos
Las siguientes variables de entorno deben estar definidas (preferiblemente en `.env.shared`):

- `N8N_BASE_URL`: URL base de la instancia n8n (ej. `http://localhost:5678/api/v1`).
- `N8N_API_KEY`: Clave de API válida.

## 3. Uso y Scripts Disponibles

Las siguientes utilidades están disponibles en `scripts/`:

### Test de Conexión
Verifica conectividad básica y conteo de workflows.
```bash
python pipeline/skills/n8n/scripts/test_connection.py
```

### Listar Workflows
Muestra una tabla detallada con ID, estado (Activo/Inactivo) y nombre de todos los workflows.
```bash
python pipeline/skills/n8n/scripts/list_workflows.py
```

### Backup de Workflow
Realiza copias de seguridad de workflows específicos.
```bash
python pipeline/skills/n8n/scripts/backup_workflow.py --id <workflow_id>
```

## 4. Estándares de Implementación (Dev Memory)

### Carga de Configuración
Los scripts deben cargar las variables de entorno siguiendo la jerarquía del proyecto:
1. `.config/params.yaml` (si aplica)
2. `.env.shared` (raíz del workspace)
3. `.env` (local de la aplicación)

### Cliente HTTP
- Usar `requests` para Python.
- Configurar headers con `X-N8N-API-KEY`.

### Manejo de Errores
- **401 Unauthorized**: Verificar `N8N_API_KEY`.
- **ConnectionError**: Verificar si el contenedor Docker de n8n está corriendo.

## 5. Integraciones Específicas

### Drupal
- **Bloqueo WAF en PATCH**: El servidor web bloquea peticiones `PATCH` a la API JSON:API estándar.
- **Solución**: Usar endpoint personalizado `POST /custom/node-helper/update` (Módulo `n8n_helper`).
- **Solución**: Usar endpoint personalizado `POST /custom/node-helper/update` (Módulo `n8n_helper`).
- **Formato**: Requiere `?_format=json` en la URL y headers `Content-Type: application/json`.
- **Autenticación**: 
    - **Problema**: n8n puede fallar en enviar las credenciales "Basic Auth" estándar si el handshake falla o el payload es grande (Reactive Auth).
    - **Solución Recomendada**: Usar un Credential Type `Header Auth` (Generic Credential Type -> Header Auth).
        - Name: `Authorization`
        - Value: `Basic <Base64_User_Pass>`
    - Esto fuerza el envío del header (Preemptive Auth) de forma segura desde el Credential Store, sin hardcodearlo en el workflow.

### Connector importació Notion a HTML (Parsing)
- **Rich Text Handling**: Al procesar bloques de Connector importació Notion, no basta con leer `.plain_text` o `.content`.
- **Lógica Requerida**: Se debe iterar sobre el array `rich_text` y aplicar tags HTML según las `annotations`:
    - `bold` -> `<b>`
    - `italic` -> `<i>`
    - `underline` -> `<u>`
    - `strikethrough` -> `<s>`
    - `code` -> `<code>`
    - `href` (link) -> `<a href="...">`
- **Blocks**: Los bloques deben envolverse en sus tags semánticos (`<p>`, `<h2>`, etc.) antes de enviarse a Drupal.
- **Doble Rendering**: 
    - `PreparerBlocks` emite DOS campos: `content` (Texto plano para Connector importació Notion) y `content_html` (HTML para Drupal).
    - `DrupalPayloadPreparer` debe agregar todos los `content_html` de los items de entrada para formar el `body.value` de Drupal.
    - Esto evita ver tags HTML en Connector importació Notion y perder formato en Drupal.
- **Markdown Parsing**: `notionBlocksToHtml` ahora incluye un parser básico de Markdown en el helper `parseMarkdown` para soportar bloques que solo tengan campo `content` (sin `rich_text`).
- **URL Consistency**: Usar siempre el dominio canónico sin `www` (o con, pero consistente) en todos los nodos HTTP para evitar redirecciones que pierdan cabeceras de Auth (Error 401). En este caso: `https://temenosismael.org`.

### Lógica de Sincronización (Sync Logic)
- **CheckGlobalSync + IfNotExist**: Cuando se usa un Data Table para verificar existencia (Lookup):
    - `CheckGlobalSync` busca por ID de origen (ej. `notion_id`) y retorna el ID de destino (ej. `drupal_uuid`) si existe.
    - `IfNotExist` debe validar la clave de **DESTINO** (`drupal_uuid`), no la de origen.
    - **Patrón Correcto**: `IfNotExist` -> Condition: `drupal_uuid` Is Empty.
        - True (Empty) -> Create Node.
        - False (Not Empty) -> Update Node.

## 6. Dependencias
```bash
pip install -r requirements.txt
```
