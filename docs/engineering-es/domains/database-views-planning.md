---
status: implemented
last_verified: 2026-08-28
source_paths:
  - backend/domains/vault/tables/catalogs
  - backend/domains/vault/tables/formula_recalculation.py
  - backend/domains/vault/tables/rules
  - backend/domains/vault/views/filters.py
  - backend/domains/vault/views/row_resolution.py
  - backend/domains/vault/views/snapshot_markup.py
  - backend/domains/vault/views/snapshot_materialization.py
  - backend/domains/vault/views/sorting.py
  - backend/api/vault_views_routes.py
  - backend/api/planning_routes.py
  - backend/services/option_catalogs.py
  - backend/services/rule_engine.py
  - backend/services/view_snapshot.py
  - backend/services/planning_engine.py
  - backend/services/planning_scheduler.py
  - frontend/src/components/Vault/VaultTable.jsx
  - frontend/src/pages/ProjectPlanningPage.jsx
tests:
  - backend/tests/test_database_rules_views_domain_contract.py
  - backend/tests/test_rule_engine_derived_order.py
  - backend/tests/test_rollup_percent_checked_parity.py
  - backend/tests/test_option_catalogs.py
  - backend/tests/test_vault_formula_recalculation_domain_contract.py
  - backend/tests/test_view_snapshot.py
  - backend/tests/test_view_filter_rename.py
  - backend/tests/test_planning_engine.py
  - backend/tests/test_planning_agent_tools.py
  - backend/tests/test_planning_scheduler.py
  - backend/tests/test_project_planning.py
  - tests/e2e/tests/e2e/dashboards.spec.ts
---

# Opiniones de base de datos y planificación de proyectos

## Modelo estructurado de conocimientos

Una base de datos Gnosi es un esquema y una capa de vista sobre páginas, normalmente enraizada en una carpeta Vault. La materia frontal de la página contiene valores de registro. Los datos del registro definen tipos de campos, configuraciones de vistas, fórmulas, versiones, relaciones, opciones, configuración de visualización y acciones.

Al menos una vista principal es una invariante. Rutas de inicio y de reparación en tiempo de lectura restauran cuando el legado o la interrupción escribe dejan una tabla sin una vista válida.

## Ver tubería

```mermaid
flowchart LR
    Pages["Registros de marcaje"] --> Schema["Esquema tecleado"]
    Schema --> Derived["Fórmulas y rollos"]
    Derived --> Filter["Filtros tecleados"]
    Filter --> Sort["Tipo estable"]
    Sort --> Group["Agrupación"]
    Group --> Projection["Campos visibles y distribución"]
    Projection --> Table["Tabla / galería / tablero / calendario / cronología"]
```

Los valores tipográficos deben compararse como su tipo de campo declarado. La entrada de texto por sí sola no puede representar cada valor de filtro; los campos fecha, casilla de verificación, número, relación, selección y multivalor se normalizan a través de operadores con conocimiento de campo.

La evaluación de campo derivado tiene un orden explícito. Fórmulas que dependen de valores brutos que se ejecutan antes de las rerollups que se resuelven las relaciones agregadas, y fórmulas dependientes sin permitir que los ciclos se repitan indefinidamente. Las representaciones de backend y frontend deben acordar la veracidad de la casilla de verificación, porcentajes, valores vacíos e identificadores de opciones.

`tables/formula_recalculation.py` serializa por tabla los cambios entre
registros. Las solicitudes concurrentes se fusionan en una pasada pendiente; se
recalculan todas las filas visibles y sólo tras una escritura correcta se
actualizan el índice de páginas y la caché de respuestas.

El comportamiento canónico de las bases de datos se divide por responsabilidad.
`tables/rules/` gestiona fórmulas, rollups, consultas y automatizaciones;
`tables/catalogs/` gestiona opciones, roles semánticos y el catálogo global de
estados; y los módulos pequeños de `vault/views/` gestionan snapshots, filtros,
ordenación y joins. `rule_engine.py`, `option_catalogs.py` y `view_snapshot.py`
siguen siendo fachadas compatibles y conservan las costuras de prueba tardías.

## Evolución del esquema y condición

Las revisiones de esquemas protegen a un cliente de guardar una lista de campos más antigua sobre una más reciente. Renombrar un campo actualiza filtros, tipos, fórmulas, acciones y referencias de vista guardada. Renombrar una tabla detecta colisiones de nombres de archivos de carpetas planas antes de mover contenido.

Las registros se escriben atómicamente y se actualizan después de cambios en los metadatos por lotes. Las instantáneas en cacheado se invalidan cuando cambian los registros de origen o la revisión del esquema.

La edición masiva de campos, la promoción de Zotero Extras y la aplicación de
plantillas comparten un servicio tipado de mutación de páginas. Cada registro
comprueba el ETag opcional, actualiza el índice después de escribir e informa de
omisiones, conflictos y errores sin interrumpir las demás filas.

Los estados introducidos por reglas de acción se persisten de forma idempotente
desde el dominio de tablas. Un error del registro queda anotado y no hace fallar
la acción original.

La frontera HTTP de Planning está tipada estrictamente y conserva el contrato
OpenAPI congelado. La resolución del vault activo falla explícitamente cuando
no hay uno seleccionado, y la materialización de recurrencias consume de forma
acotada las ocurrencias RRULE, preservando identificadores estables y ETags.

## Planificación de proyectos

La planificación consume campos de tareas estructurados y produce un horario autorizado en lugar de duplicar la lógica de programación en la interfaz de usuario. El motor normaliza dependencias, calendarios, duraciones, limitaciones, recursos, plazos, progreso y dirección de programación. Luego calcula fechas, holgura, tareas críticas, advertencias y asignaciones de recursos.

El motor determinista separa la normalización de hechos, el paso hacia delante
por tarea, los diagnósticos de restricciones, el índice de sucesores, el paso
inverso de holguras, la colocación ALAP y la serialización. Los hechos persistidos
no se mutan y los errores recuperables conservan horarios parciales con diagnósticos.

La interfaz representa el resultado y los controles de edición. No recomputa de forma independiente la semántica de ruta crítica. Los horarios en cacheado están keyed por estado de entrada relevante y viven en datos locales, no en los registros de origen de la bóveda.

## Comportamiento de fallo

- Las fórmulas no válidas devuelven un error de campo controlado en lugar de abortar el
respuesta de la tabla.
- Las relaciones rotas siguen siendo visibles como valores no resueltos cuando es posible.
- Las vistas perdidas desencadenan una reparación determinista de la vista principal.
- Los ciclos de planificación, las limitaciones imposibles o los calendarios que faltan producen
diagnósticos y resultados parciales cuando sea seguro.
- Una revisión de esquema obsoleta devuelve un conflicto y requiere recarga/fusión.

## Enfoque de verificación

Prueba de paridad de filtro tecleado, conflictos de revisión de esquemas, renombrados de campos y tablas, orden de fórmulas/rollups, sincronización de relaciones, clasificación de instantáneas, acciones de catálogo de opciones, restricciones de programación, rutas críticas y renderizado del panel E2E.
