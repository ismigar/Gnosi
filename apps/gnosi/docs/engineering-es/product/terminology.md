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

| Plazo | Significado de ingeniería |
| --- | --- |
| Bóveda | Un directorio cuyos archivos y activos Markdown forman un espacio de conocimiento. |
| Página | Un documento de marcado con YAML en el frente y un estable `id`. |
| Base de datos o cuadro | Una vista estructurada sobre páginas, normalmente dirigida a una carpeta y esquema en lugar de una tabla SQL separada. |
| Ver | Proyección guardada de una base de datos: tipo, filtros, orden, agrupación, campos y estado de diseño. |
| Secretaría | Metadatos gestionados por Gnosi que describen bases de datos, vistas, esquemas o catálogos. |
| Metadatos de Sidecar | Interno `.gnosi` datos asociados con el contenido pero separados intencionalmente de los campos Markdown de los usuarios. |
| Base de datos de gestión | Estado SQLite solo para identidades, espacios de trabajo, membresías, acceso a la bóveda, tokens y enlaces compartidos. |
| Datos locales | Bases de datos, cachés, índices, secretos, registros, salidas y puntos de control por cada instalación. No debe sincronizarse en la nube. |
| Modo personal | Modo de usuario único predeterminado con autenticación omitido a menos que se requiera explícitamente. |
| Modo de organización | Modo autenticado con membresía de espacio de trabajo y roles ordenados. |
| Espacio de trabajo | Límite administrativo que agrupa a los miembros y bóvedas registradas. |
| Competencia en el tiempo de ejecución | Capacidad de aplicación documentada en virtud de `pipeline/skills/`; no es un plugin de agente de desarrollo. |
| Herramienta | Una operación llamada disponible para un agente, posiblemente descubierta a través de MCP o generada localmente. |
| MCP | Modelo de protocolo contextual, utilizado para descubrir e invocar herramientas de agentes externos. |
| Directiva | Memoria de ingeniería que describe un procedimiento, decisión, incidente, restricción o plan de implementación. |
| Referencia generada | Documentación determinista derivada de la fuente actual sin importar el tiempo de ejecución. |
| Fuente de la verdad | Datos cuya pérdida no puede ser reparada desde otra representación autorizada. |
| Datos derivados | Caché o índice que se puede reconstruir de una fuente de verdad. |
| Proveedor de archivos | Adaptador para el comportamiento local o del sistema de archivos respaldado por la nube, como controles de hidratación y disponibilidad. |
| Servidor de traducción | Zotero sidecar que traduce páginas web e identificadores en metadatos de referencia normalizados. |
| PAT | Token de acceso personal; la base de datos de gestión almacena sólo su prefijo de hash y visualización. |

## Límite de designación

Identificadores históricos como: `vault`, `DIGITAL_BRAIN_VAULT_PATH`, y algunas claves de integración prefijadas por Temenos legados siguen siendo contratos de compatibilidad. El lenguaje de producto público utiliza Gnosi y Knowledge donde las migraciones han completado. Los identificadores no se renombran simplemente para hacer la terminología de la documentación uniforme.
