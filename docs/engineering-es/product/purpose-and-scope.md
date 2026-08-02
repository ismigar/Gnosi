---
status: implemented
last_verified: 2026-08-02
source_paths:
  - ARCHITECTURE.md
  - CONTRIBUTING.md
tests: []
---

# Finalidad y alcance

## Objetivo del producto

Gnosi convierte una carpeta controlada por el usuario de Markdown en un espacio de trabajo conectado sin hacer de una base de datos alojada opaca el propietario del conocimiento del usuario. Combina la portabilidad de los archivos con un comportamiento de aplicación de alto nivel: vistas estructuradas, edición, búsqueda, traversal de gráficos, referencias, comunicación, automatización, publicación y asistencia de IA.

El objetivo principal de ingeniería es la soberanía de los datos con una colaboración y automatización útiles. Los usuarios deben poder inspeccionar, respaldar, sincronizar y recuperar sus conocimientos independientemente de Gnosi.

## Principios de diseño

### Persistencia local-primera

Markdown y YAML front matter son la representación principal del conocimiento. Los índices y cachés aceleran el acceso, pero deben ser reconstruibles. Las bases de datos relacionales almacenan el estado de la aplicación que no pertenece naturalmente a una nota, como identidades, membresías, índices de mensajes e historial de ejecución.

### Modo personal sin gastos generales de cuenta

El valor predeterminado `personal` modo puede ejecutarse como una aplicación local de un solo usuario sin una pantalla de inicio de sesión. `org` El modo permite el comportamiento autenticado de múltiples usuarios, espacios de trabajo, roles y comprobaciones de acceso. Las implementaciones sensibles a la seguridad pueden forzar la autenticación incluso mientras se mantiene la semántica de modo personal.

### Despliegue portátil

El código central debe funcionar de forma nativa y en Docker. La detección de implementación puede seleccionar los valores predeterminados apropiados, pero el código de dominio no debe asumir nombres de host de Docker o rutas absolutas de sólo nativo.

### Efectos externos explícitos

Abrir archivos, enviar mensajes, publicar contenido, eliminar datos, invocar herramientas generadas y llamar a servicios remotos cruzar límites de confianza. Estas operaciones utilizan servicios con alcance y, cuando proceda, controles de roles o políticas de confirmación explícitas.

### Degradación agraciada

Los proveedores e integraciones opcionales deben fallar localmente. Un proveedor de IA, un sidecar de traducción, una cuenta de correo o un servicio de hidratación de archivos en la nube no deben hacer que las operaciones de bóveda no relacionadas no estén disponibles.

## Superficies de productos

- Conocimiento: Marcar páginas, editar bloques, archivos adjuntos, vistas, búsqueda, gráfico.
- Investigación: referencias, citas CSL, lectura PDF/EPUB, anotaciones, feeds.
- Comunicación: correo, calendarios, reuniones, contactos.
- Inteligencia: registro de modelos, agentes, herramientas MCP, habilidades de ejecución, fuentes de contexto.
- Automatización: tareas programadas, fórmulas, rollups, recordatorios, publicación.
- Integración: Google, Microsoft, Notion, Drupal, redes sociales, complementos de oficina.
- Distribución: tiempo de ejecución de la web nativa, Docker auto-hosting, Aplicación de escritorio electrónico,
y clientes de navegador / oficina.

## No objetivos y límites

- Gnosi no requiere una base de datos de nube patentada como fuente de verdad.
- Los índices derivados no son sustitutos duraderos de la bóveda.
- La colaboración en tiempo real proporciona actualmente una base de relé/presencia; es
no documentado como edición completa de CRDT hasta que se implemente ese comportamiento.
- El código de lector Zotero vendido no es propiedad de la lógica de aplicación Gnosi.
la construcción, el límite de integración, los cambios locales y los flujos de datos a su alrededor.
- Una propuesta de característica en una directiva no se envía comportamiento hasta que se verifique en
fuente y pruebas.

## Consecuencias de la concesión de licencias

Gnosi es AGPL-3,0-o-más tarde. Las versiones modificadas ofrecidas a través de una red deben poner su fuente correspondiente disponible bajo la misma licencia. Los colaboradores deben mantener la fuente, documentación técnica e instrucciones operativas adecuadas para la revisión de terceros.
