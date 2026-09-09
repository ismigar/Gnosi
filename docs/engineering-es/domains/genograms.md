---
status: implemented
last_verified: 2026-09-08
source_paths:
  - backend/domains/genograms
  - frontend/src/features/genograms
  - frontend/src/shared/api/genograms.ts
  - backend/services/builtin_plugins.py
  - frontend/src/features/vault/views/VaultViewBody.tsx
  - frontend/src/features/vault/views/db-view-embed/useEmbedDerived.ts
tests:
  - backend/tests/test_genograms.py
  - backend/tests/test_genograms_api.py
  - frontend/src/features/genograms/genograms.test.tsx
  - frontend/src/features/genograms/export.test.ts
  - frontend/src/features/vault/view-config/page-view-modal/useViewAppearance.genogram.test.tsx
---

# Genogramas

El plugin integrado opcional `genograms` mantiene una red familiar compartida en cada Vault. Actívalo en Configuración → Plugins → Genogramas y pulsa **Prepara las tablas**. Se crean la base de datos Genogramas, las tablas Personas y Relaciones, sus vistas tabulares principales y una vista Genograma inicial. Los nombres siguen el idioma de la interfaz: catalán, castellano, inglés o francés. Repetir la preparación reutiliza los identificadores de tablas y campos y recupera los campos obligatorios que falten.

Selecciona una persona de referencia en el dibujo. Por defecto se incluyen dos generaciones de ascendientes, una de descendientes, los hermanos de la persona de referencia y las parejas inmediatas. La expansión de parejas no recorre toda su familia. Las inclusiones, exclusiones y filtros habituales de la tabla delimitan la red visible. La búsqueda resalta nombres sin filtrar el dibujo. Se indica el número de conexiones ocultas y no se inventan filiaciones entre las personas que siguen visibles.

## Registros y validación

Las personas y relaciones siguen siendo registros Markdown normales con campos YAML con nombre y cuerpo de nota. Los campos se reconocen por identificadores estables: cambiar su nombre o el de la tabla no rompe el adaptador. Las opciones se guardan con el nombre traducido de la tabla y la API las normaliza a códigos estables. Los identificadores son independientes de los nombres, que pueden repetirse. Las fuentes enlazan a registros del Vault; las personas también admiten etiquetas.

Las fechas parciales conservan su precisión original (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`) con indicadores de aproximación separados. Las fechas desconocidas quedan vacías. Un registro gestacional puede convertirse en persona sin cambiar su identidad. Los nacimientos múltiples comparten un grupo. Uniones, filiaciones dirigidas y relaciones emocionales tienen identidad propia; cada filiación puede referenciar una unión concreta. La ausencia de vínculo emocional significa que no está documentado. Se conservan las fechas, pero esta versión no reconstruye estados históricos.

Las escrituras Markdown y los movimientos a la papelera comparten validaciones con el editor visual. Un bloqueo de archivo por Vault y otro dentro del proceso serializan la validación y escritura entre procesos locales del servidor. Se mantienen las protecciones ETag. Se rechazan autorrelaciones, referencias inexistentes, duplicados, uniones incompatibles y ciclos de filiación. Se admiten antepasados compartidos y ciclos de pareja o emocionales. Las relaciones vacías son borradores y aparecen como incidencias hasta completar sus extremos. Las contradicciones de fechas generan avisos. Antes de eliminar un registro referenciado deben resolverse sus relaciones; no hay eliminación en cascada.

Las consultas leen las dos carpetas de la red sin depender de un índice asíncrono. Las relaciones modificadas externamente que no sean válidas generan incidencias y se excluyen del dibujo; la lectura no repara archivos. Los archivos ilegibles bloquean las modificaciones hasta resolver la incidencia, porque no se puede validar una red incompleta.

## Vistas y dibujo

El objeto versionado `genogram` del registro de vista guarda la referencia, profundidades, inclusiones, etiquetas, capas y coordenadas manuales. El mismo componente sirve para tablas, paneles y notas. Copiar una vista a una nota conserva las opciones. Mover un símbolo solo modifica esa vista. Los datos se comparten entre vistas; desactivar el plugin conserva tablas y configuraciones y muestra su estado desactivado en las vistas gráficas.

La disposición se calcula en un proceso separado del navegador. La filiación determina los niveles; las parejas solo se alinean cuando no contradice la ascendencia. Las parejas y los nacimientos múltiples se agrupan, y los hermanos se ordenan por nacimiento u orden explícito. Cada persona aparece una vez. Los vínculos emocionales no afectan a las posiciones. Las coordenadas manuales prevalecen hasta pulsar **Reorganiza**. Las revisiones y la cancelación por Vault descartan cargas, respuestas de disposición y guardados obsoletos.

El dibujo es SVG monocromo con símbolos geométricos y patrones de línea diferenciados. La leyenda solo incluye las convenciones utilizadas. El repertorio se basa en la [simbología de GenoPro](https://genopro.com/genogram/symbols/) y sus [vínculos emocionales](https://genopro.com/genogram/emotional-relationships/). La leyenda identifica el símbolo neutro con rombo e interrogante y las adaptaciones monocromas. Las ramas complejas pueden ajustarse manualmente.

## API y exportación

- `POST /api/vault/genograms/prepare`: preparación idempotente, reservada a editores.
- `POST /api/vault/genograms/graph`: resuelve opciones guardadas o locales, normaliza y valida la red y devuelve identificadores visibles, incidencias y correspondencias de campos.
- Las altas y modificaciones utilizan las API normales de páginas del Vault y ETag.

Las exportaciones parten del SVG visible, con título, fecha de generación y leyenda si está activada. Nombres completos, iniciales o alias solo afectan a la representación. Se eliminan atributos interactivos y resaltados de selección. El SVG incorpora los estilos. El PNG utiliza fondo blanco y resolución doble, reducida proporcionalmente si supera 32 megapíxeles o 16.000 píxeles por lado, sin recortar el dibujo.

La conversión PDF carga localmente jsPDF y [svg2pdf.js](https://github.com/yWorks/svg2pdf.js/), incorpora Liberation Sans y admite A4/A3, orientación vertical u horizontal y ajuste a página o mosaico. La licencia de las fuentes se incluye en los recursos de la funcionalidad. La conversión no requiere servicios externos ni IA.

## Verificación

Las pruebas del servidor cubren preparación y modificaciones en Vaults temporales, ciclos y cambios simultáneos, campos renombrados, ETag, conversión de gestaciones, desactivación del plugin y archivos externos incorrectos. Las pruebas de interfaz cubren disposición determinista, antepasados compartidos, parejas de generaciones distintas, posiciones manuales, simbología perinatal, privacidad de exportación y opciones de vistas insertadas.

La prueba PDF ejecuta los conversores reales, comprueba las fuentes incorporadas y un mosaico de nueve páginas y solo sustituye la geometría de texto que falta en jsdom. La revisión en navegador cubre edición sin abandonar la vista, selección de líneas, arrastre, estabilidad de la capa emocional y ocultación y restauración de personas.

Un conjunto determinista mide la disposición de 200 personas y 500 relaciones. El límite de 1,5 segundos detecta regresiones; no es una promesa para todos los dispositivos ni una medida completa de representación. Las redes grandes deben consultarse por foco y ramas. La API no trunca registros silenciosamente.

GEDCOM, reconstrucción temporal, condiciones clínicas estructuradas y ecomapas quedan para futuras ampliaciones.
