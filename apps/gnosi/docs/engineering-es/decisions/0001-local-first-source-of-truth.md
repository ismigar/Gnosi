---
status: implemented
last_verified: 2026-08-02
source_paths:
  - backend/api/vault_routes.py
  - backend/config/paths_config.py
  - backend/data/management_db.py
tests:
  - backend/tests/test_safe_io.py
  - backend/tests/test_e2e_etag_concurrency.py
---

# ADR 0001: Markdown Vault como fuente de conocimiento de la verdad

- Estado: Aceptado
- Fecha de la decisión: 2026-08-02 (formalizado a partir de la arquitectura existente)

## Contexto

Gnosi necesita edición estructurada, búsqueda, traversal de gráficos, colaboración y automatización mientras preserva la propiedad del usuario y la interoperabilidad. Hacer una base de datos de aplicaciones la única representación crearía enlace y haría copias de seguridad de archivos ordinarias, sincronización y edición externa secundaria.

## Decisión

El conocimiento del usuario se almacena como Markdown, YAML front matter, y activos dentro de una bóveda controlada por el usuario. La aplicación de almacenamiento de bases de datos relacionales declara que no es la representación de conocimiento de autor.

## Consecuencias

- Los archivos permanecen inspeccionables y portátiles sin Gnosi.
- Los escritos requieren atomia, Etags, normalización de identidad y actualización de índices.
- Editores externos y proveedores de nube introducen la concurrencia y la disponibilidad
los fallos que los servicios deben tolerar.
- Las vistas de tipo base de datos son proyecciones sobre archivos, por lo que la evaluación mecanografiada y
la coherencia del registro son responsabilidades de aplicación.
- SQLite y secretos permanecen locales sólo porque tienen diferente durabilidad
y semántica de sincronización.

## alternativas rechazadas

- SQL como la única tienda de conocimiento: transacciones más fuertes pero la pérdida de portátil
propiedad del archivo.
- Cloud SaaS como fuente obligatoria: colaboración centralizada más fácil, pero
incompatibilidad con la soberanía local-primera.
- Tratamiento de SQLite sincronizado como almacenamiento portátil: inseguro porque sincronización de archivos
no proporciona bloqueo de bases de datos ni replicación atómica.

## Impacto de la verificación

Las pruebas cubren viajes de Markdown, escrituras atómicas, conflictos de Etag, comportamiento de identificador y enlace, reconstrucciones de índices, contención de rutas, fallos del proveedor y aislamiento de datos locales.
