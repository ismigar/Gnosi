---
status: implemented
last_verified: 2026-08-02
source_paths:
  - pyproject.toml
  - uv.lock
  - mkdocs.yml
  - pipeline/skills/technical_documentation/SKILL.md
  - pipeline/skills/technical_documentation/scripts/generate.py
tests:
  - pipeline/skills/technical_documentation/tests
---

# ADR 0002: Documentación revisada y referencia generada del código fuente

- Estado: Aceptado
- Fecha de la decisión: 2026-08-02

## Contexto

Gnosi tiene cientos de módulos de backend y frontend y una memoria extensa de su implementación. Un único archivo de arquitectura mantenido manualmente no puede enumerar la API, la configuración, los componentes, las pruebas y las habilidades actuales sin quedar desactualizado. Una prosa completamente generada sería exhaustiva, pero no podría explicar la intención y correría el riesgo de convertir nombres en afirmaciones falsas.

## Decisión

Mantener un único portal de ingeniería MkDocs en el árbol autoritativo de la aplicación. Las páginas revisadas por personas describen el propósito, la arquitectura, el comportamiento de los dominios, la seguridad, las operaciones y las decisiones. Un generador determinista basado en la biblioteca estándar produce los catálogos del código fuente. Las páginas generadas se incluyen en los commits y se comprueban en CI.

El generador realiza una inspección estática y nunca importa la aplicación ni lee configuración/secretos locales.

## Consecuencias

- Los ingenieros pueden navegar desde la intención hasta el código fuente exacto y las pruebas.
- Los diffs generados revelan cambios en las interfaces y capacidades expuestas durante la revisión.
- La asignación de responsabilidades por dominio sigue manteniéndose manualmente en `domains.json`.
- Los revisores siguen verificando el sentido de la prosa; la automatización comprueba
  la trazabilidad, no la corrección de las explicaciones humanas.
- Las dependencias de documentación utilizan el grupo opcional `docs` de
  `pyproject.toml` y el `uv.lock` compartido, no un archivo de requisitos ni
  un entorno separado. Generar catálogos no importa la pila ML de la aplicación.

## Alternativas rechazadas

- Un manual monolítico: navegación deficiente, conflictos de revisión y rápida desactualización.
- Solo docstrings: insuficientes para explicar los flujos entre componentes y las
  decisiones operativas.
- Importar FastAPI en cada compilación de la documentación: efectos secundarios,
  dependencias del host, carga de secretos e inicialización de bases de datos.
- No incluir los archivos generados en los commits: los cambios quedan ocultos en la revisión de código.

## Impacto de la verificación

La CI ejecuta las pruebas unitarias del generador, comprueba si los archivos generados están desactualizados, valida el portal y compila MkDocs en modo estricto. La QA en el navegador verifica el portal renderizado y los diagramas Mermaid.
