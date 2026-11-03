# Prepara multimedia y publica contenido

El centro multimedia conserva recursos reutilizables. La publicación social prepara y envía contenido a las redes configuradas.

## Antes de empezar {#before-you-begin}

Activa Publicación social y conecta la red de destino con permiso para publicar. Aprende con un borrador de ejemplo.

## Pasos {#steps}

1. Abre Multimedia, añade una imagen que puedas utilizar y revisa sus metadatos. Abre el original para comprobar calidad y disponibilidad.

2. Abre el compositor social y selecciona red y cuenta. Escribe un borrador y adjunta el recurso.

3. Revisa la vista previa de cada destino, incluidos los límites de texto y archivos. Adapta el contenido si los requisitos difieren.

4. Elige publicación inmediata o una programación explícita. Comprueba destino, día y hora antes de confirmar; preparar no publica.

5. Tras la ejecución, abre el historial y comprueba el resultado de cada red y su enlace remoto.

6. Si falla un destino, inspecciona el resultado antes de reintentar. Excluye los destinos correctos del reintento para evitar duplicados.

## Resultado esperado {#expected-result}

El borrador tiene un destino comprobado y, tras publicarse, un resultado verificable por red.

## Si algo falla {#troubleshooting}

Credenciales caducadas y límites del proveedor pueden bloquear la publicación. Una miniatura no recupera el original. La programación depende de que complemento, cuenta y servicio sigan disponibles.

## Guías relacionadas {#related-guides}

- [Activa complementos, conecta servicios y automatiza](integrations-automations.md)
- [Preguntas frecuentes y recuperación](troubleshooting.md)

## Publicar un sitio web

Activa **Webs**, ábrelo desde la barra lateral y crea o selecciona un sitio web. Elige las tablas y páginas de origen y configura la navegación y la apariencia. Sube un logotipo, un icono de pestaña o una tipografía con los controles de apariencia. Solo los recursos seleccionados se incluyen en el sitio publicado; subir un archivo no lo publica. Las tipografías del sistema dependen del dispositivo del visitante.

La configuración se guarda automáticamente. Comprueba el estado del guardado antes de revisar y publicar en el destino seleccionado. La publicación es una acción explícita. Si falla el guardado, conserva el borrador y vuelve a intentarlo antes de publicar. Las credenciales de servicios privados y los borradores de boletines están separados del sitio público; enviar una campaña requiere su propia revisión y acción explícita.

### Revisión, historial de versiones y boletines de prueba

En Contenidos, elige una fuente antes de añadirla; selecciona explícitamente los campos públicos, el cuerpo y los adjuntos. Utiliza Páginas para el contenido manual y Navegación para los menús.

La configuración se guarda automáticamente. Comprueba el estado de guardado y resuelve los errores antes de salir. Revisa una instantánea, sus cambios y la vista previa de escritorio y móvil antes de publicar la versión revisada. Los cambios de fuentes o configuración requieren otra revisión. Comprueba el resultado de la tarea y el historial de versiones; la reversión restaura una versión del sitio, mientras que mensajes, suscriptores y campañas se mantienen separados.

En Boletines, elige el destino y el idioma y añade contenidos ya publicados a un borrador de resumen o lectura destacada. La lista muestra primero los contenidos más recientes. Ordena hasta veinte páginas únicas, añade una introducción y revisa HTML, texto plano y destinatarios antes de poner explícitamente una prueba en la cola. Los borradores se guardan automáticamente por sitio y destino; los cambios de publicación o del borrador requieren otra revisión. Puedes leer los correos de prueba capturados desde la cola de envío; leerlos no activa los enlaces de confirmación o baja. Utiliza los controles explícitos de prueba de enlaces cuando sea necesario.

El piloto actual solo permite publicar en el espacio de pruebas protegido y capturar correos para destinatarios sintéticos. La publicación en producción y el envío real están desactivados. Cada destino también necesita las dependencias de generación del sitio y del servicio privado; comprueba su conexión antes de publicar. Si el resultado de una acción es incierto, actualiza el estado antes de reintentarla.

### Importar una web y configurar su conexión

En **Crear web**, elige una web vacía o la importación por URL. Indica la dirección pública, analízala y revisa las páginas, idiomas y avisos antes de importar la selección. Se crean páginas editables sin publicarlas. Los servicios y formularios originales del servidor no se migran automáticamente.

En **Alojamiento**, configura servidor, puerto, usuario, carpetas y autenticación mediante agente SSH, clave del dispositivo o contraseña. Transfiere los archivos por SSH o SFTP; la contraseña se guarda solo en el gestor de credenciales del dispositivo. Comprueba la conexión: publicar con el servicio privado también requiere órdenes SSH, PHP y SQLite. Una conexión solo SFTP puede quedar verificada sin cumplir esos requisitos de publicación.

En **Formularios de contacto**, añade, ordena o elimina campos y edita los textos por idioma, incluidos consentimiento, errores y confirmación. Deja los textos opcionales vacíos para conservar los valores predeterminados. Revisa el resultado antes de publicar.
