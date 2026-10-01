---
status: implemented
last_verified: 2026-09-30
source_paths:
  - README.md
  - backend/services/builtin_plugins.py
  - ARCHITECTURE.md
  - CONTRIBUTING.md
tests: []
---

# Finalidad y alcance

## Objetivo del producto

Gnosi es un espacio de investigación local-first que acompaña las fuentes
hasta la evidencia, la síntesis y la citación verificable. Un vault Markdown
controlado por el usuario mantiene el conocimiento portable y recuperable
independientemente de la aplicación. El núcleo incluye edición, bases de datos
tipadas y vistas básicas, búsqueda, grafo de conocimiento, referencias, lectura
PDF/EPUB, anotaciones y citas.

Correo, calendarios de proveedores, contactos, publicación, IA y otras
integraciones siguen siendo capacidades opcionales. Se conserva la funcionalidad
existente; desactivar un módulo debe mantener utilizable la investigación que
no depende de él. Las vistas de calendario de bases de datos, los adjuntos
ordinarios y las fórmulas locales siguen formando parte del núcleo.

El registro actual solo activa `resources` por defecto en un estado nuevo.
Este valor no implica cambiar las decisiones explícitas de activación de los
usuarios existentes. Separar la distribución de futuros plugins no exige
extraer primero todos los módulos integrados.

## Principios de diseño

### Persistencia local-first

Markdown y el frontmatter YAML son la representación principal del conocimiento. Los índices y cachés aceleran el acceso, pero deben poder reconstruirse. Las bases de datos relacionales almacenan el estado de la aplicación que no encaja de forma natural en una nota, como identidades, membresías, índices de mensajes e historial de ejecución.

### Modo personal sin necesidad de gestionar una cuenta

El modo predeterminado `personal` permite ejecutar una aplicación local de un solo usuario sin pantalla de inicio de sesión. El modo `org` habilita el uso multiusuario autenticado, los espacios de trabajo, los roles y las comprobaciones de acceso. Los despliegues con requisitos de seguridad pueden exigir autenticación manteniendo la semántica del modo personal.

### Despliegue portátil

El código central debe funcionar de forma nativa y en Docker. La detección del entorno de despliegue puede seleccionar valores predeterminados adecuados, pero el código de dominio no debe depender de nombres de host exclusivos de Docker ni de rutas absolutas exclusivas del entorno nativo.

### Efectos externos explícitos

Abrir archivos, enviar mensajes, publicar contenido, eliminar datos, invocar herramientas generadas y llamar a servicios remotos son operaciones que cruzan límites de confianza. Utilizan servicios con un ámbito definido y, cuando procede, comprobaciones de roles o políticas de confirmación explícitas.

### Degradación controlada

Los fallos de los proveedores e integraciones opcionales deben quedar aislados. La ausencia de un proveedor de IA, un sidecar de traducción, una cuenta de correo o un servicio de hidratación de archivos en la nube no debe impedir las operaciones del vault que no dependan de ellos.

## Áreas del producto

- Conocimiento: páginas Markdown, edición por bloques, archivos adjuntos, vistas, búsqueda, grafo.
- Investigación: referencias, citas CSL, lectura PDF/EPUB, anotaciones, feeds.
- Comunicación: correo, calendarios, reuniones, contactos.
- Inteligencia: registro de modelos, agentes, herramientas MCP, habilidades de ejecución, fuentes de contexto.
- Automatización: tareas programadas, fórmulas, rollups, recordatorios, publicación.
- Integración: Google, Microsoft, Notion, Drupal, redes sociales, complementos de oficina.
- Distribución: ejecución web nativa, autoalojamiento con Docker, aplicación de escritorio Electron
  y clientes complementarios para navegador y aplicaciones ofimáticas.

## Fuera de alcance y límites

- Gnosi no requiere una base de datos propietaria en la nube como fuente de verdad.
- Los índices derivados no son sustitutos duraderos del vault.
- La colaboración en tiempo real proporciona actualmente una base de retransmisión y presencia;
  no se documenta como edición CRDT completa hasta que ese comportamiento esté implementado.
- El código del lector Zotero incluido como dependencia no es lógica de aplicación propia de Gnosi.
  Gnosi se encarga de su compilación, el límite de integración, los cambios locales y los flujos de datos asociados.
- Una funcionalidad propuesta en una directiva no se considera entregada hasta que se verifique
  en el código fuente y las pruebas.

## Consecuencias de la concesión de licencias

Gnosi utiliza la licencia AGPL-3.0-or-later. Las versiones modificadas ofrecidas a través de una red deben poner su código fuente correspondiente a disposición de los usuarios bajo la misma licencia. Los colaboradores deben mantener el código fuente, la documentación técnica y las instrucciones operativas en condiciones que permitan su revisión por terceros.
