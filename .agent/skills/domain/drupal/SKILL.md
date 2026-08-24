---
name: drupal
description: Gestión y mantenimiento del servidor Drupal (Deploy, Update, Drush Remote)
---

# Skill: Gestión de Servidor Drupal

## Objetivo
Estandarizar las operaciones de mantenimiento y despliegue en el servidor Drupal de producción, superando las barreras de autenticación interactiva (`suweb`).

## Protocolo de Acceso Remoto Agéntico

Para evitar la intervención manual en comandos que requieren escalada de privilegios (`suweb`), se ha desarrollado un agente basado en `pexpect`.

### Herramienta Principal
- **Agente**: `scripts/remote_agent.py`
- **Tests**:
  - `tests/test_drupal_auth.py`
- **Clase**: `DrupalRemoteAgent`

### Dependencias
```bash
pip install -r requirements.txt
```

### Uso Básico
```python
from pipeline.skills.drupal.scripts.remote_agent import DrupalRemoteAgent
agent = DrupalRemoteAgent()
agent.run_command("drush cr")
```

### Credenciales Requeridas (.env_shared)
```bash
SSH_HOST=midominio.com
SSH_USER=miusuario
SSH_KEY_PATH=/ruta/a/id_ed25519 (o SSH_PASSWORD)
SSH_SUWEB_PASSWORD=micontraseñasuweb
DRUPAL_PATH=/home/usuario/webapps/web
```

## Operaciones Estándar (SOPs)

### 1. Limpiar Caché
Ejecutar siempre tras cambios de código o configuración.
```bash
python pipeline/skills/drupal/scripts/remote_agent.py exec "drush cr"
```

### 2. Despliegue de Módulos Custom
Usar el script estandarizado: `scripts/deploy_module.py`
Este script:
1. Lee rutas locales y remotas.
2. Sube archivos via SCP.
3. Mueve a destino final (con `suweb`).
4. Ejecuta `drush cr`.

Para nuevos módulos, adaptar las rutas en el script o parametrizarlo.

### 3. Actualización del Core (Update)
Usar el script consolidado `scripts/update_core.py`
**Pasos que realiza:**
1. `composer require ...` (con versiones fijadas, e.g. `^10.6`)
2. `drush updb -y`
3. `drush cr`

### 4. Local staging clone

Use `scripts/local_staging.py` to maintain a loopback-only production clone for
Drupal upgrade rehearsals without consuming hosting database quota.

```bash
python3 .agent/skills/domain/drupal/scripts/local_staging.py refresh
python3 .agent/skills/domain/drupal/scripts/local_staging.py harden
python3 .agent/skills/domain/drupal/scripts/local_staging.py rotate_credentials
python3 .agent/skills/domain/drupal/scripts/local_staging.py start
python3 .agent/skills/domain/drupal/scripts/local_staging.py verify
python3 .agent/skills/domain/drupal/scripts/local_staging.py stop
```

The helper requires Homebrew PHP 8.4, Composer, and MariaDB 11.4. Its ignored
runtime lives under `.local/drupal-staging/`. Use `--reuse-code` during a retry
when the downloaded code archive has already passed validation, and add
`--reuse-database` or `--reuse-site` only when those earlier phases completed
before a later step failed.

Run the deterministic two-stage Drupal 11 rehearsal only against that ignored
clone:

```bash
DRUPAL_LOCAL_STAGE_ROOT="$PWD/.local/drupal-staging" \
  python3 .agent/skills/domain/drupal/scripts/upgrade_local_to_drupal11.py
```

The upgrade helper refuses any site root outside the configured local staging
directory, verifies the isolation overrides, preserves translated menu URLs and
block configuration counts, and leaves maintenance mode disabled after all
Composer, database, entity, and plugin-discovery checks pass.

### 5. Retirar módulos custom obsoletos

Ejecutar `scripts/retire_unused_modules.php` mediante `drush php:script` mientras el
código de los módulos todavía exista. El script desinstala de forma idempotente
`n8n_helper` y `notion_bridge`. Reconstruir la caché y verificar el sitio antes de
eliminar sus directorios del servidor.

## Restricciones y Troubleshooting (Aprendizaje Continuo)

- **Timeouts**: `composer` es lento. Configurar timeout de `run_command` a 600s+.
  Desde CLI, usar `exec --timeout 900 "composer ..."`; el timeout predeterminado de 30 segundos interrumpe Composer antes de que termine.
- **Prompt Matching**: El script busca prompts específicos (`$`, `#`, `ismigar@`, `root@`). Si el prompt del servidor cambia, actualizar `remote_agent.py`.
- **ModSecurity/WAF**: La API estándar de Drupal bloquea `PATCH`. Usar endpoints custom POST (ver `n8n_interaction.md`).
- **Archivos PHP fuera de Drupal**: No publicar redirects como scripts PHP bajo `web/` → el `.htaccess` de Drupal bloquea los PHP adicionales con `403` → usar un `index.html` estático con `meta refresh` y `window.location.replace()`.
- **Subidas con `suweb`**: `upload_file()` puede copiar correctamente el archivo y fallar al borrar el temporal de `/tmp` porque pertenece al usuario SSH inicial → verificar siempre el destino, ajustar el grupo a `ismigar-web` y eliminar el temporal en una sesión sin `suweb`.
- **Nombre del entorno**: El agente busca `.env_shared` en los directorios padre, por lo que puede ejecutarse directamente desde cualquier subdirectorio del repositorio.
- **Detección del prompt SSH**: No buscar caracteres sueltos como `$`, `%` o `>` → aparecen en comandos y salidas normales y hacen que el agente cierre la sesión antes de tiempo → usar un patrón de prompt anclado a una línea completa `usuario@host:ruta$`.
- **Fallos remotos**: No imprimir la salida solo cuando el código es cero → oculta el diagnóstico de Composer y Drush → mostrar la salida redactada tanto en éxito como en error y propagar el código de salida.
- **Salida sensible de Drush**: No ejecutar ni registrar `drush status --format=json` sin filtrado → incluye `db-password` en algunas versiones → pedir solo campos concretos y mantener la redacción defensiva de credenciales en `remote_agent.py`.
- **Volcados SQL**: No usar una ruta relativa con `drush sql:dump --result-file` → Drush puede resolverla desde el document root y dejar el respaldo fuera de la carpeta esperada → usar una ruta absoluta privada y verificar el `.sql.gz` con `test -s` antes de actualizar.
- **Scaffold con `sites/default` protegido**: `composer require` puede actualizar paquetes y el lock, pero terminar con error al reemplazar `default.settings.php` si el directorio tiene modo `555` → cambiar temporalmente solo el directorio a `755`, ejecutar `composer install`, restaurar `555` y volver a verificar versión y bootstrap.
- **Versión segura real**: No desactivar `audit.block-insecure` ni fiarse de una página de versiones cacheada → una versión publicada puede haber quedado afectada por avisos posteriores → consultar las versiones actuales con Composer y dejar que el bloqueo de seguridad rechace las vulnerables.

## Troubleshooting Avanzado (Crisis Management)

### ServiceNotFoundException tras Update
Si tras actualizar el core/módulos, Drupal lanza excepciones fatales (y cierra conexión SSH/MCP) por servicios faltantes (ej: `token.entity_hooks`):
1. **Diagnóstico**: `drush php:eval "print \Drupal::service('nombre.servicio') ? 'OK' : 'FAIL';"`
2. **Resolución**: actualizar o parchear el módulo propietario del servicio. No inyectar
   servicios dummy desde un módulo ajeno: puede ocultar incompatibilidades y romper la
   compilación del contenedor tras una actualización.
3. **Limpieza**: usar `drush cr` para reconstruir el contenedor y volver a comprobar el
   servicio real.

### Error MCP: "RpcResponseFactory returned invalid output data"
Este error indica que la validación JSON Schema de las respuestas MCP está fallando.

**Diagnóstico**:
1. Inyectar logging en `RpcResponseFactory.php`:
   ```php
   file_put_contents('/tmp/mcp_debug.log', "DATA: " . print_r($data, TRUE), FILE_APPEND);
   ```
2. Buscar `COMPLIANCE FAILED` en el log para ver el error exacto.

**Causa Común**: Plugins de `ai_agents` o `mcp` con `inputSchema` vacío (debe tener `'type' => 'object'`).

**Solución Aplicada** (centralizada en `ToolsList.php`):
```php
// Normalize inputSchema to ensure it always has 'type' => 'object'
$normalizedInputSchema = $tool->inputSchema;
if ($normalizedInputSchema instanceof \stdClass) {
  $normalizedInputSchema = (array) $normalizedInputSchema;
}
if (empty($normalizedInputSchema) || !is_array($normalizedInputSchema) || !isset($normalizedInputSchema['type'])) {
  $normalizedInputSchema = array_merge(['type' => 'object'], is_array($normalizedInputSchema) ? $normalizedInputSchema : []);
}
```

**Archivos Parcheados**:
- `web/modules/contrib/mcp/src/Plugin/McpJsonRpc/ToolsList.php` - Fix centralizado
- `web/modules/contrib/jsonrpc/src/Shaper/RpcResponseFactory.php` - Logging de debug

> **ADVERTENCIA**: Estos son parches en módulos contrib. Si se actualizan estos módulos con `composer`, los parches se perderán. Considerar crear un patch file o reportar upstream.
