---
status: implemented
last_verified: 2026-08-02
source_paths:
  - backend/models/management.py
  - backend/config/app_config.py
  - backend/services/context_vars.py
  - backend/services/workspace_service.py
tests: []
---

# Terminología

| Término | Significado técnico |
| --- | --- |
| Vault | Directorio cuyos archivos Markdown y recursos forman un espacio de conocimiento. |
| Página | Documento Markdown con frontmatter YAML y un `id` estable. |
| Base de datos o tabla | Vista estructurada de páginas, normalmente delimitada por una carpeta y un esquema, en lugar de una tabla SQL independiente. |
| Vista | Proyección guardada de una base de datos: tipo, filtros, orden, agrupación, campos y estado de la disposición visual. |
| Registro | Metadatos gestionados por Gnosi que describen bases de datos, vistas, esquemas o catálogos. |
| Metadatos sidecar | Datos internos de `.gnosi` asociados al contenido, pero separados intencionalmente de los campos Markdown escritos por el usuario. |
| Base de datos de gestión | Estado SQLite exclusivamente local para identidades, espacios de trabajo, membresías, acceso al vault, tokens y enlaces compartidos. |
| Datos locales | Bases de datos, cachés, índices, secretos, registros, salidas y puntos de control de cada instancia. No deben sincronizarse con la nube. |
| Modo personal | Modo predeterminado de un solo usuario que omite la autenticación salvo que se exija explícitamente. |
| Modo de organización | Modo autenticado con membresía de espacio de trabajo y roles ordenados. |
| Espacio de trabajo | Límite administrativo que agrupa miembros y vaults registrados. |
| Habilidad de ejecución | Capacidad documentada de la aplicación situada en `pipeline/skills/`; no es un plugin para un agente de desarrollo. |
| Herramienta | Operación que un agente puede invocar, posiblemente descubierta a través de MCP o generada localmente. |
| MCP | Model Context Protocol, utilizado para descubrir e invocar herramientas externas para agentes. |
| Directiva | Memoria de ingeniería que describe un procedimiento, decisión, incidente, restricción o plan de implementación. |
| Referencia generada | Documentación determinista derivada del código fuente actual sin importar módulos del entorno de ejecución. |
| Fuente de verdad | Datos cuya pérdida no puede repararse a partir de otra representación autoritativa. |
| Datos derivados | Caché o índice que se puede reconstruir de una fuente de verdad. |
| Proveedor de archivos | Adaptador del sistema de archivos local o respaldado por la nube, para operaciones como la hidratación y las comprobaciones de disponibilidad. |
| Servidor de traducción | Sidecar de Zotero que convierte páginas web e identificadores en metadatos de referencia normalizados. |
| PAT | Token de acceso personal; la base de datos de gestión almacena únicamente su hash y un prefijo para mostrarlo. |

## Límites de nomenclatura

Los identificadores históricos como `vault`, `DIGITAL_BRAIN_VAULT_PATH` y algunas claves de integración heredadas con el prefijo Temenos siguen siendo contratos de compatibilidad. La terminología pública del producto utiliza Gnosi y Knowledge donde las migraciones han finalizado. Los identificadores no se renombran solo para uniformar la terminología de la documentación.
