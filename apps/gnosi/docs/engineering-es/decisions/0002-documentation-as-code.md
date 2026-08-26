---
status: implemented
last_verified: 2026-08-02
source_paths:
  - mkdocs.yml
  - pipeline/skills/technical_documentation/SKILL.md
  - pipeline/skills/technical_documentation/scripts/generate.py
tests:
  - pipeline/skills/technical_documentation/tests
---

# ADR 0002: Documentación revisada más referencia de origen generada

- Estado: Aceptado
- Fecha de la decisión: 2026-08-02

## Contexto

Gnosi tiene cientos de módulos de backend y frontend y una memoria de implementación extensa. Un único archivo de arquitectura de mantenimiento manual no puede enumerar la API actual, configuración, componentes, pruebas y habilidades sin derivar. Prosa completamente generada sería exhaustiva pero no podría explicar la intención y se arriesgaría a convertir nombres en falsas afirmaciones.

## Decisión

Mantenga un portal de ingeniería MkDocs en el árbol de aplicaciones autorizado. Páginas revisadas por humanos con propósito propio, arquitectura, comportamiento de dominio, seguridad, operaciones y decisiones. Un generador de bibliotecas estándar determinista posee catálogos de fuentes. Las páginas generadas se comprometen y comprueban en CI.

El generador realiza una inspección estática y nunca importa la aplicación ni lee configuración/secretos locales.

## Consecuencias

- Los ingenieros pueden navegar desde la intención hasta la fuente exacta y las pruebas.
- Las diferencias generadas revelan cambios superficiales durante la revisión.
- La propiedad de dominio sigue siendo comisariada en `domains.json`.
- Los evaluadores aún verifican la semántica de prosa; la automatización comprueba la trazabilidad, no
la corrección de las explicaciones humanas.
- Las herramientas de documentación utilizan un archivo de requisitos aislado y no perturban el
ML de tiempo de ejecución conjunto de dependencia.

## alternativas rechazadas

- Un manual monolítico: mala navegación, revisión de conflictos y rápida deriva.
- Únicamente los documentos: insuficientes para los flujos transversales y operativos
decisiones.
- Importación de FastAPI en tiempo de ejecución para cada compilación de documentos: efectos secundarios, host
dependencias, carga secreta, e inicialización de bases de datos.
- Salida generada no comprometida: los cambios se vuelven invisibles en la revisión de código.

## Impacto de la verificación

CI ejecuta pruebas de unidades generadoras, comprobación de salida rancio, validación de portal y construcción estricta de MkDocs. El navegador QA verifica el portal renderizado y diagramas de Sirena.
