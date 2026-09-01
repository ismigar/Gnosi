# Kit de publicación comunitaria de Gnosi

[English](community-release.md) · [Català](community-release.ca.md) · [Español](community-release.es.md) · [Français](community-release.fr.md)

Estos textos están preparados para adaptarlos o publicarlos. Sustituye solo el
contexto opcional entre corchetes y conserva el aviso de beta y versiones sin
firmar.

## Anuncio principal

### Gnosi: de la fuente al manuscrito, con el conocimiento siempre tuyo

Construí Gnosi porque mi flujo de investigación estaba repartido entre Notion,
Obsidian y Mendeley. Notion me aportaba bases de datos y vistas de proyecto,
Obsidian me aportaba Markdown y un grafo de conocimiento, y Mendeley gestionaba
las referencias. Las mismas fuentes e ideas tenían que existir en varios
lugares, mientras años de trabajo dependían de productos cerrados y políticas
que yo no controlaba.

Gnosi es mi respuesta de código abierto: un espacio de investigación
local-first que conecta referencias, evidencias de PDF, EPUB y webs, notas,
vistas estructuradas, un grafo de conocimiento y citas verificables. El
conocimiento subyacente sigue estando en archivos Markdown y YAML normales.

El flujo principal es deliberadamente sencillo:

1. Captura o importa una fuente.
2. Lee y conserva la evidencia exacta y la procedencia.
3. Conecta las notas de lectura en tu propia síntesis.
4. Cita el resultado en Gnosi, Word o LibreOffice.

La aplicación de escritorio está disponible para macOS, Windows y Linux.
Todavía es beta y las versiones actuales no están firmadas; lee el aviso de
instalación en la página de la versión. Gnosi también puede ejecutarse de forma
nativa o mediante el despliegue Docker compatible.

Descarga: https://github.com/ismigar/Gnosi/releases/latest

Código y documentación: https://github.com/ismigar/Gnosi

Si lo pruebas, me interesa especialmente saber dónde se rompe esta cadena:
instalación, importación de fuentes, trazabilidad de la evidencia, síntesis o
cita.

## Publicación breve para redes

He creado Gnosi para dejar de duplicar la investigación entre Notion, Obsidian
y Mendeley. Conecta fuentes → evidencias → notas → citas, manteniendo el
conocimiento en archivos Markdown/YAML locales. Código abierto, local-first,
escritorio y autoalojamiento. Las versiones beta todavía no están firmadas.

https://gnosi.temenosismael.org/index.es.html

## Publicación para comunidades de investigación

### Un espacio local-first y de código abierto para investigar de la fuente al manuscrito

Gnosi puede resultar útil si tu flujo real atraviesa un gestor de referencias,
una libreta Markdown, tablas de proyecto y Word o LibreOffice.

Combina importación mediante DOI, ISBN, arXiv, PMID, BibTeX y RIS, lector
PDF/EPUB, anotaciones que preservan la evidencia, notas Markdown conectadas,
vistas de base de datos tipadas, grafo de conocimiento, citas CSL y complementos
para Word y LibreOffice. La IA es opcional y puede utilizar proveedores locales
o en la nube; la procedencia sigue visible.

El proyecto tiene licencia AGPL-3.0-or-later y el Vault sigue siendo un conjunto
de archivos normales. Una plantilla oficial firmada muestra el flujo en
castellano, catalán e inglés sin exigir ningún proveedor de IA.

Es una herramienta personal compartida con la comunidad, no una pretensión de
sustituir todos los sistemas de investigación. Agradeceré comentarios basados
en una fuente y un texto reales.

Proyecto: https://github.com/ismigar/Gnosi

## Petición de feedback

Gracias por probar Gnosi. Cuatro respuestas concretas resultan más útiles que
una valoración general:

1. ¿Has podido instalarlo y abrirlo?
2. ¿Has podido incorporar una fuente real?
3. ¿Has podido volver desde una nota de lectura o síntesis hasta la evidencia?
4. ¿Has podido insertar o exportar la cita?

Indica el sistema operativo, el paso que te ha bloqueado y qué esperabas que
ocurriera. No adjuntes nunca material de investigación privado a una incidencia
pública.

Incidencia de feedback: https://github.com/ismigar/Gnosi/issues/new?labels=feedback&title=%5BFeedback%5D%20Mi%20primer%20flujo%20con%20Gnosi

## Preguntas frecuentes

### ¿Gnosi es otro clon de Notion u Obsidian?

No. Sus ideas de editor, bases de datos y grafo forman parte del origen, pero el
recorrido principal de Gnosi es la cadena de investigación que lleva desde una
fuente y una evidencia exacta hasta una síntesis conectada y una cita
verificable.

### ¿Sustituye a Zotero o Mendeley?

Gnosi tiene un gestor de referencias nativo y captura web compatible con
Zotero, pero también permite el intercambio abierto mediante BibTeX y RIS. El
objetivo es eliminar duplicidades y preservar la interoperabilidad, no convertir
bibliotecas existentes en rehenes de un formato nuevo.

### ¿Es obligatorio utilizar IA?

No. La plantilla de investigación y el flujo principal desde la fuente hasta la
cita funcionan sin ningún proveedor de IA. Cuando se activa, la IA puede
utilizar modelos locales o en la nube.

### ¿Dónde se guardan los datos?

El Vault es una carpeta con Markdown, YAML y archivos normales. Los índices
locales reconstruibles mejoran la velocidad, pero no son la fuente de verdad.

### ¿Está preparado para un grupo de investigación?

El modo personal es el recorrido principal más maduro. Existen el modo de
organización, los roles y la presencia en directo, pero la edición colaborativa
en tiempo real todavía está en una fase inicial. Prueba el uso en grupo antes de
confiarle trabajo compartido crítico.

### ¿Por qué macOS muestra un aviso al abrir la aplicación?

Las versiones beta actuales no están firmadas. Utiliza clic derecho → Abrir en
el primer inicio y verifica que la descarga proceda de la página oficial de
GitHub Releases. La firma y la notarización siguen pendientes.
