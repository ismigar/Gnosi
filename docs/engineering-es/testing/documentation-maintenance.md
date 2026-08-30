---
status: implemented
last_verified: 2026-08-20
source_paths:
  - pipeline/skills/technical_documentation/SKILL.md
  - pipeline/skills/technical_documentation/domains.json
  - pipeline/skills/technical_documentation/scripts/check_change_impact.py
  - pipeline/skills/technical_documentation/scripts/generate.py
  - pipeline/skills/technical_documentation/scripts/localize.py
  - mkdocs.yml
  - mkdocs-ca.yml
  - mkdocs-es.yml
  - mkdocs-fr.yml
tests:
  - pipeline/skills/technical_documentation/tests
---

# Mantenimiento de la documentación

## Revisión versus contenido generado

Las páginas revisadas explican intent, lindings, flows, invariants, failing comportment, security, operations, and verificement. Las páginas generadas enumeran hechos que pueden ser extraídos de manera fiable: módulos, decoradores de rutas, referencias de entornos, rutas de frontend, exportaciones, pruebas y paquetes de habilidades de tiempo de ejecución.

No ponga reclamaciones arquitectónicas en el generador basándose sólo en nombres. No duplique manualmente una tabla de API de 400 operaciones en una guía revisada.

## Flujo de trabajo estándar

Desde `Gnosi/`:

```bash
python pipeline/skills/technical_documentation/scripts/generate.py
python pipeline/skills/technical_documentation/scripts/generate.py --check
python pipeline/skills/technical_documentation/scripts/validate.py
python pipeline/skills/technical_documentation/scripts/localize.py --check
mkdocs build --strict
mkdocs build --strict --config-file mkdocs-ca.yml
mkdocs build --strict --config-file mkdocs-es.yml
mkdocs build --strict --config-file mkdocs-fr.yml
```

Entonces servir o abrir `site/engineering`, navegar por las páginas modificadas, inspeccionar tablas y diagramas, y verificar la consola del navegador.

## Acceso público

El portal canónico se publica en `https://gnosi.temenosismael.org/engineering/`. Las exportaciones privadas de monorepo `monorepo/` a la raíz del público `ismigar/Gnosi` repositorio. Eso hace `monorepo/.github/workflows/documentation-pages.yml` fuente del público `.github/workflows/documentation-pages.yml` flujo de trabajo de despliegue.

En cada impulso relevante al público `main` smart, el flujo de trabajo verifica los catálogos generados y los espejos localizados, valida la trazabilidad, construye los portales de MkDocs en inglés, catalán, español y francés en modo estricto, y publica el `site/` árbol a través de GitHub Páginas. Publicar el padre `site/` el directorio conserva el `/engineering/` Segmento URL.

La barra lateral global de Gnosi enlaza con la misma dirección canónica. La etiqueta está localizada en catalán, inglés, español y francés y el portal se abre fuera del árbol de rutas de la aplicación.

## Metadatos de página

Cada página revisada de Markdown declara:

```yaml
status: implemented
last_verified: YYYY-MM-DD
source_paths:
  - backend/path/to/source.py
tests:
  - backend/tests/test_behavior.py
```

Los estados permitidos son `implemented`, `partial`, `experimental`, `planned`, y `deprecated`Una página marcada `implemented` debe describir el comportamiento actual. Un diseño planificado no debe aparecer bajo un encabezado implementado.

## Cobertura de dominios

`domains.json` Cada entrada enlaza una guía de dominio con los globs de origen, los globs de prueba y las directivas privadas pertinentes. `covered` sólo cuando la guía revisada y las coincidencias fuente existen. Cero pruebas son visibles y requieren una decisión de prueba deliberada.

## Lo que requiere una actualización

- Una ruta nueva o eliminada, página del navegador, modelo, nombre de configuración o tiempo de ejecución
habilidad: regenerar catálogos.
- Un cambio invariante, límite de confianza, ciclo de vida o propietario del almacenamiento: actualizar el
revisión de la arquitectura / guía de dominio.
- Un nuevo proveedor o dependencia de implementación: actualizar las páginas de dominio y operaciones.
- Un nuevo fallo o restricción de recuperación: actualizar la directiva primero, luego
promover un conocimiento estable en el portal.
- Una decisión arquitectónica duradera: añadir un ADR.

## Puerta de impacto CI

La puerta de documentación de solicitud de retiro está diseñada para cambios que pueden alterar un límite del sistema o un contrato operativo. Cubre APIs y servicios de backend, integraciones, código de ejecución nativo y de escritorio, archivos de implementación y autenticación de frontend, enrutamiento, proveedores y código de aplicación-shell.

Los cambios de rutina en los componentes de interfaz, página, estilo y prueba no requieren una edición de documentación de prosa cuando el contrato existente sigue siendo exacto. Todavía requieren documentación cuando cambian un invariante, límite de confianza, ciclo de vida, propietario de almacenamiento, restricción de fallo, u otro hecho duradero del sistema.

Tras el traslado, el gate protege `frontend/src/app/`,
`frontend/src/features/auth/`, `frontend/src/shared/auth/`,
`frontend/src/shared/routing/`, `frontend/src/shared/ui/layout/`, el proveedor
API y los hooks de autenticación compartidos, y `frontend/feature-public-entries.json`.
Se conservan las rutas sensibles antiguas para detectar eliminaciones y renombrados.
Los cambios solo en `*.test.*`, `*.spec.*`, `__tests__/`, `tests/` y CSS
siguen exentos. Trasladar UI ordinaria no la convierte en código de alto impacto.
Los cambios sensibles siguen requiriendo evidencia documental en inglés;
los espejos revisados en catalán, español y francés mantienen las mismas rutas técnicas.
Las fixtures sintéticas históricas pueden conservar rutas antiguas; se añaden
regresiones de las rutas nuevas sin presentar las fixtures como código actual.

## Validación anti-duelo

El validador comprueba que se generaron avisos, metadatos, rutas de origen/prueba, enlaces internos, guías de dominio requeridas, rutas absolutas locales y material secreto obvio. `generate.py --check` compara independientemente la salida comprometida con el árbol actual. `localize.py --check` requiere paridad de árboles en catalán, español y francés. MkDocs valida en los cuatro portales enlaces de navegación y documentación.

Las guías revisadas se encuentran en cada portal. El francés mantiene catálogos de fuentes generados deterministas en inglés canónico porque los nombres de ruta, identificadores de código y descripciones de fuentes extraídas son evidencia de referencia en lugar de prosa revisada; su navegación y portal circundante siguen localizados.

Estos controles no pueden probar la semántica de prosa. Los evaluadores deben comparar las afirmaciones con la fuente y pruebas vinculadas.
