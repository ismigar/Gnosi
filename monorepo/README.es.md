# Gnosi

[English](README.md) · [Català](README.ca.md) · [Español](README.es.md)

**De la fuente al manuscrito, con el conocimiento siempre tuyo.**

Gnosi es un espacio de investigación local-first y de código abierto. Conecta
referencias, evidencias de PDF, EPUB y webs, notas Markdown, estructura de
proyecto, grafos de conocimiento y citas verificables sin convertir un SaaS en
el propietario de tu trabajo.

> [!IMPORTANT]
> Gnosi utiliza archivos Markdown y YAML normales como fuente de verdad. Las
> notas siguen siendo legibles, portables, versionables y recuperables fuera de
> la aplicación.

## El flujo de investigación

1. **Captura o importa** — DOI, ISBN, arXiv, PMID, BibTeX, RIS, páginas web,
   PDF, EPUB, canales y otros materiales de investigación.
2. **Lee con evidencias** — conserva anotaciones y citas con procedencia de
   página, párrafo, capítulo, línea o marca temporal.
3. **Conecta y estructura** — transforma las notas de lectura en síntesis humana
   mediante wikienlaces, el grafo, bases de datos tipadas, tableros, calendarios
   y cronologías.
4. **Escribe y cita** — inserta citas activas en Word o LibreOffice y genera
   bibliografías mediante CSL/citeproc.

La IA puede ayudar a ingerir, buscar y organizar fuentes mediante modelos
locales o en la nube, pero es opcional. Gnosi diferencia las notas de lectura
con evidencias de las notas permanentes que expresan tus conclusiones.

## Por qué existe Gnosi

Gnosi nació como respuesta personal a un flujo fragmentado: Notion aportaba
bases de datos y vistas de proyecto; Obsidian aportaba Markdown y grafo;
Mendeley gestionaba referencias. Había que duplicar las mismas fuentes e ideas,
mientras años de conocimiento dependían de productos cerrados y políticas
cambiantes.

Gnosi reúne esa cadena en un sistema abierto. Se comparte como proyecto
comunitario, no como una empresa terminada ni como sustituto universal de todas
las herramientas.

## Capacidades principales

- Editor de bloques sobre Markdown y YAML portables.
- Bases de datos tipadas con relaciones, fórmulas, agregaciones y vistas guardadas.
- Grafo de conocimiento interactivo y sugerencias semánticas opcionales.
- Gestor de referencias nativo con captura compatible con Zotero y citas CSL.
- Lector PDF/EPUB integrado con anotaciones que preservan la evidencia.
- Complementos de citas para Word y LibreOffice.
- Planificación de investigación con dependencias, recursos, plazos y cronologías.
- Agentes multiproveedor, conectores y herramientas MCP con gobierno explícito.
- Modo personal local-first y modo de organización autoalojado opcional.

También existen correo, calendario, contactos, canales, traducción e
integraciones de publicación, pero el recorrido principal es la investigación:
fuente → evidencia → síntesis → cita.

## Prueba el espacio de investigación multilingüe

La plantilla oficial firmada muestra todo el recorrido en castellano, catalán e
inglés sin exigir ningún proveedor de IA ni cuenta externa.

1. Abre **Configuración → General → Archivos**.
2. En Vaults, elige **Desde el repositorio**.
3. Selecciona **Research Starter Workspace** y crea el Vault.
4. Abre la nota «Empieza aquí».

## Descarga la aplicación de escritorio

Descarga la versión más reciente para macOS, Windows o Linux desde
[GitHub Releases](https://github.com/ismigar/Gnosi/releases/latest). El backend
ya viene incluido y no es necesario configurar Python ni Node.

> [!WARNING]
> Las versiones de escritorio todavía son beta y no están firmadas. En macOS,
> usa clic derecho → Abrir la primera vez. Revisa las notas de la versión antes
> de utilizar Gnosi con la única copia de material importante.

## Autoalojamiento y contribuciones

Las órdenes siguientes son para desarrollo y autoalojamiento. La ejecución
nativa es la recomendada; Docker sigue siendo una opción compatible para
servidores.

### Requisitos

- Python 3.10+
- Node.js y npm
- Opcional: Docker para el despliegue en contenedores
- Opcional: Ollama u otro proveedor compatible para las funciones de IA

Inicializa el lector una sola vez:

```bash
git submodule update --init --recursive
sh apps/gnosi/sh/build-zotero-reader.sh
```

### Ejecución nativa

```bash
cd apps/gnosi
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.server:app --host 0.0.0.0 --port 5002 --reload
```

En otro terminal:

```bash
cd apps/gnosi/frontend
npm install
npm run dev
```

Abre `http://localhost:5173`.

### Ejecución con Docker (opcional)

```bash
cd apps/gnosi
docker compose up -d --build
```

## Arquitectura y documentación

- Aplicación: [`apps/gnosi/`](apps/gnosi/)
- Arquitectura: [`apps/gnosi/ARCHITECTURE.md`](apps/gnosi/ARCHITECTURE.md)
- Guía de contribución: [`apps/gnosi/CONTRIBUTING.md`](apps/gnosi/CONTRIBUTING.md)
- Portal de ingeniería: [gnosi.temenosismael.org/engineering/es](https://gnosi.temenosismael.org/engineering/es/)

## Comentarios y contribuciones

Si pruebas Gnosi, el comentario más útil es dónde se rompe la cadena:
instalación, importación, trazabilidad de la evidencia, síntesis o cita. Abre una
[incidencia de feedback](https://github.com/ismigar/Gnosi/issues/new?labels=feedback&title=%5BFeedback%5D%20Mi%20primer%20flujo%20con%20Gnosi)
o consulta la [guía de contribución](apps/gnosi/CONTRIBUTING.md). Las personas
mantenedoras pueden utilizar el [kit de publicación comunitaria](apps/gnosi/docs/community/community-release.es.md).

## Licencia

Copyright © 2024–2026 Ismael García Fernández.

Gnosi se distribuye bajo la
[GNU Affero General Public License v3.0 o posterior](LICENSE). Puede utilizarse,
modificarse y redistribuirse bajo los términos de la licencia, incluidas las
obligaciones de disponibilidad del código fuente para usos en red.
