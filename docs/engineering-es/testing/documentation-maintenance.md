---
status: implemented
last_verified: 2026-08-20
source_paths:
  - pipeline/skills/technical_documentation/SKILL.md
  - pipeline/skills/technical_documentation/domains.json
  - pipeline/skills/technical_documentation/scripts/check_change_impact.py
  - pipeline/skills/technical_documentation/scripts/generate.py
  - pipeline/skills/technical_documentation/scripts/localize.py
  - pipeline/skills/technical_documentation/scripts/reviewed_contracts.py
  - mkdocs.yml
  - mkdocs-ca.yml
  - mkdocs-es.yml
  - mkdocs-fr.yml
  - scripts/check_public_pipeline.py
  - pipeline/README.md
tests:
  - pipeline/skills/technical_documentation/tests
  - pipeline/tests/test_public_pipeline.py
---

# Mantenimiento de la documentación

## Herramientas públicas y privadas

Gnosi es el repositorio fuente público canónico. La configuración de máquina,
las copias de seguridad, Drupal y el mantenimiento de vaults personales pertenecen
a un repositorio privado separado, nunca a una exportación pública en espejo. Las versiones históricas revisadas se conservan
con hashes antes de retirarlas; esta limpieza no reescribe el historial ni elimina
datos de usuario o servicios instalados.

`pnpm check:pipeline` comprueba nombres y modos del índice Git, incluidos los
archivos ignorados añadidos explícitamente. Rechaza paquetes privados conocidos,
cachés, datos, archivos de entorno y enlaces a código externo. Hay que preparar
las eliminaciones revisadas en el índice antes de comprobarlo: una eliminación
no añadida al índice sigue siendo pública en él. El checker solo lee metadatos. No ejecuta
habilidades ni lee secretos; no sustituye una auditoría completa de secretos o
portabilidad.

Tras preparar el índice, `pnpm typecheck:pipeline` ejecuta mypy estricto sobre
todos los archivos Python públicos del pipeline, incluidos tests y directorios
ignorados. No excluye directorios; si no hay fuentes o falta un archivo, falla.
CI lo ejecuta además de la comprobación del backend. No ejecuta proveedores ni
migraciones.

La traducción, las notificaciones, el soporte de servicios auxiliares del host, la
publicación social y la planificación del backend mantienen sus contratos.
El orquestador de desarrollo retirado y las instrucciones personales de publicación
no son dependencias de ejecución. La clasificación de habilidades públicas se
comprueba contra los paquetes reales.

Ejecute `pnpm check:pipeline:structure` tras preparar el índice para limitar cada
módulo Python indexado a 800 líneas y la complejidad ciclomática a 15, incluidos
tests y archivos ignorados. Rechaza fuentes ausentes o externas; las exclusiones
locales de Ruff y los comentarios de supresión no permiten evitarlo. Este modo
explícito lee código; el control predeterminado solo lee metadatos. CI ejecuta los tres controles.

El generador separa primitivas comunes, descubrimiento de API, métricas del backend,
modelos de datos, rutas frontend, configuración e inventarios en módulos independientes.
`generate.py` conserva la orquestación CLI, los diagnósticos de cobertura y las
importaciones explícitas de compatibilidad. Las pruebas de extracción preservan
los nueve catálogos; la generación estática no importa la aplicación ni ejecuta proveedores.

## Contenido revisado y generado

Las páginas revisadas explican la intención, los límites, los flujos, las
invariantes, el comportamiento ante errores, la seguridad, las operaciones y
la verificación. Las páginas generadas enumeran hechos extraíbles del código:
módulos, decoradores de rutas, referencias a variables de entorno, rutas del
frontend, exportaciones, pruebas y paquetes de habilidades de ejecución.

No deduzca decisiones arquitectónicas solo a partir de nombres. No duplique
manualmente una tabla de 400 operaciones de la API dentro de una guía.

## Flujo de trabajo estándar

Desde `Gnosi/`, ejecute el control completo antes de preparar el cambio final
en el índice y repítalo después. La segunda ejecución no debe generar diferencias:

```bash
uv run --group docs python pipeline/skills/technical_documentation/scripts/pre_pr.py --base-ref origin/main
```

Pasos individuales de diagnóstico con el mismo entorno Python:

```bash
python pipeline/skills/technical_documentation/scripts/generate.py
python pipeline/skills/technical_documentation/scripts/localize.py --generated-only
python pipeline/skills/technical_documentation/scripts/generate.py --check
python pipeline/skills/technical_documentation/scripts/validate.py
python pipeline/skills/technical_documentation/scripts/localize.py --check
mkdocs build --strict
mkdocs build --strict --config-file mkdocs-ca.yml
mkdocs build --strict --config-file mkdocs-es.yml
mkdocs build --strict --config-file mkdocs-fr.yml
```

Después, sirva o abra `site/engineering`, recorra las páginas modificadas,
inspeccione tablas y diagramas y compruebe la consola del navegador.

## Acceso público

El portal canónico se publica en `https://gnosi.temenosismael.org/engineering/`.
El repositorio público `ismigar/Gnosi` lo construye directamente mediante
`.github/workflows/documentation-pages.yml`; ningún espejo reescribe el código fuente.

Con cada cambio relevante enviado a la rama pública `main`, el workflow verifica
catálogos y versiones localizadas, valida la trazabilidad, construye los cuatro
portales MkDocs en modo estricto y publica `site/` en GitHub Pages. Publicar
el directorio padre `site/` conserva el segmento `/engineering/` de la URL.

La barra lateral de Gnosi enlaza con esa dirección. Su etiqueta está traducida
a los cuatro idiomas y el portal se abre fuera de las rutas internas de la app.

## Metadatos de página

Cada página Markdown revisada declara:

```yaml
status: implemented
last_verified: YYYY-MM-DD
source_paths:
  - backend/path/to/source.py
tests:
  - backend/tests/test_behavior.py
```

Los estados permitidos son `implemented`, `partial`, `experimental`, `planned`
y `deprecated`. Una página marcada `implemented` debe describir el comportamiento
actual, no un diseño pendiente de implementar.

## Cobertura de dominios

`domains.json` es el mapa de responsabilidades revisado. Cada entrada relaciona
una guía con patrones de archivos fuente, patrones de pruebas y directivas
privadas. La cobertura generada solo indica `covered` cuando existen la guía
y los archivos fuente correspondientes. La ausencia de pruebas se muestra
explícitamente y exige una decisión consciente.

## Cuándo actualizar la documentación

- Añadir o retirar una ruta, pantalla, modelo, variable de configuración o
  habilidad: regenere los catálogos.
- Cambiar una invariante, límite de confianza, ciclo de vida o responsable de
  los datos: actualice la guía de arquitectura o dominio.
- Añadir un proveedor o dependencia de despliegue: actualice las guías de
  dominio y operaciones.
- Descubrir un error o restricción de recuperación: actualice primero la
  directiva y lleve el conocimiento consolidado al portal.
- Tomar una decisión arquitectónica duradera: añada un ADR.

## Control de impacto en CI

El control documental de las PR cubre cambios que pueden alterar un límite
del sistema o un contrato operativo: API y servicios del backend, integraciones,
ejecución nativa y de escritorio, despliegue, autenticación, enrutamiento,
proveedores y estructura principal del frontend.

Los cambios ordinarios de componentes, pantallas, estilos o pruebas no exigen
modificar la prosa si el contrato sigue siendo exacto. Sí lo exigen si alteran
una invariante, la seguridad, el ciclo de vida, la propiedad de los datos,
la recuperación u otro hecho duradero del sistema.

Tras el traslado, el control protege `frontend/src/app/`,
`frontend/src/features/auth/`, `frontend/src/shared/auth/`,
`frontend/src/shared/routing/`, `frontend/src/shared/ui/layout/`, el proveedor
API y los hooks de autenticación compartidos, y `frontend/feature-public-entries.json`.
Las rutas sensibles antiguas se reconocen en eliminaciones y renombrados.
Los cambios solo en `*.test.*`, `*.spec.*`, `__tests__/`, `tests/` y CSS
siguen exentos. Trasladar UI ordinaria no la convierte en código de alto impacto.
Los cambios sensibles requieren documentación en inglés; las versiones catalana,
española y francesa conservan las mismas rutas técnicas. Las fixtures históricas
pueden mantener rutas antiguas; añada regresiones para las rutas nuevas sin presentar
aquellas fixtures como ubicaciones actuales del código.

## Validación contra divergencias

El validador comprueba avisos de generación, metadatos, rutas de código y pruebas,
enlaces internos, guías requeridas, rutas absolutas locales y posibles secretos.
`generate.py --check` compara los archivos versionados con el código actual.
`localize.py --check` exige la paridad de los árboles catalán, español y francés
y protege el contenido técnico de las guías revisadas: frontmatter exacto,
número de apariciones de cada fragmento de código inline, bloques de ejemplo,
identificadores, flechas y orden de Mermaid, destinos de enlaces y URL.
La prosa, las etiquetas de diagramas y los fragmentos de encabezados traducidos
pueden variar; cambiar identificadores, órdenes o rutas de código produce un
fallo que indica la página y la categoría sin mostrar los valores del documento.
Esta comprobación de solo lectura no inicializa ningún modelo de traducción.
MkDocs en modo estricto valida navegación y enlaces en los cuatro portales.

Las guías revisadas están traducidas en todos los portales. Los catálogos generados
traducen los encabezados conocidos y las etiquetas fijas de forma determinista
al catalán, español y francés. Las celdas derivadas del código, los identificadores,
las rutas y el código permanecen idénticos byte a byte al inglés.
`localize.py --generated-only` los actualiza sin modelos ni imports
de la aplicación. No utilice traducción automática completa para regenerarlos.

Estos controles no prueban que la prosa sea correcta: hay que comparar las
afirmaciones con el código y las pruebas enlazadas.
