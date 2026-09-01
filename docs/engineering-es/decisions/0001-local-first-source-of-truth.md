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

# ADR 0001: El vault Markdown como fuente de verdad del conocimiento

- Estado: Aceptado
- Fecha de la decisión: 2026-08-02 (formalizado a partir de la arquitectura existente)

## Contexto

Gnosi necesita edición estructurada, búsqueda, recorrido del grafo, colaboración y automatización, preservando la propiedad del usuario y la interoperabilidad. Utilizar una base de datos de la aplicación como única representación generaría dependencia de ella y relegaría las copias de seguridad de archivos ordinarios, la sincronización y la edición externa a un papel secundario.

## Decisión

El conocimiento del usuario se almacena como Markdown, frontmatter YAML y recursos dentro de un vault controlado por el usuario. Las bases de datos relacionales almacenan estado de la aplicación que no representa el conocimiento escrito por el usuario. Los índices y cachés derivados del contenido del vault pueden reconstruirse.

## Consecuencias

- Los archivos permanecen inspeccionables y portátiles sin Gnosi.
- Las escrituras requieren atomicidad, ETags, normalización de identidad y actualización de índices.
- Los editores externos y los proveedores de nube introducen fallos de concurrencia
  y disponibilidad que los servicios deben tolerar.
- Las vistas de tipo base de datos son proyecciones sobre archivos; la evaluación
  tipada y la coherencia del registro son responsabilidad de la aplicación.
- SQLite y los secretos permanecen exclusivamente en el almacenamiento local porque
  tienen una semántica distinta de durabilidad y sincronización.

## Alternativas rechazadas

- SQL como único almacén de conocimiento: transacciones más robustas, pero pérdida
  del control sobre archivos portátiles.
- SaaS en la nube como fuente obligatoria: colaboración centralizada más sencilla,
  pero incompatible con la soberanía local-first.
- Tratar SQLite sincronizado como almacenamiento portátil: es inseguro porque la
  sincronización de archivos no proporciona bloqueos de base de datos ni replicación atómica.

## Impacto de la verificación

Las pruebas cubren ciclos de lectura y escritura de Markdown, escrituras atómicas, conflictos de ETag, comportamiento de identificadores y enlaces, reconstrucción de índices, confinamiento de rutas, fallos de proveedores y aislamiento de datos locales.
