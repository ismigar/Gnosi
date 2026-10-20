# Espacios de trabajo, Vaults y uso compartido

El espacio de trabajo determina con quién trabajas y con qué permisos. El Vault contiene los archivos de conocimiento. Cambiar uno puede modificar los registros y ajustes visibles.

## Antes de empezar {#before-you-begin}

Un espacio de trabajo existente. En una organización puedes necesitar pertenencia y rol de editor. Compartir externamente requiere su complemento.

## Pasos {#steps}

1. Comprueba el nombre del espacio en el selector. Elige uno existente o utiliza **Nuevo espacio de trabajo** si tu instalación permite crearlo.

2. Abre el selector de Vaults o Configuración → General → Archivos. Selecciona el previsto o crea uno llamado “Grupo de lectura”.

3. Crea una página de prueba y vuelve a abrirla después de cambiar de Vault y regresar. Así confirmas dónde pertenece.

4. Para colaborar, gestiona miembros y roles en los ajustes del espacio. Da acceso de edición a quienes deban modificar el contenido.

5. Para compartir una página externamente, activa el complemento y usa los controles de la página. Revisa permisos y caducidad y abre el enlace en otra sesión del navegador para comprobar qué ve un visitante.

## Resultado esperado {#expected-result}

Puedes identificar el espacio y el Vault activos y verificar el alcance de una página compartida.

## Si algo falla {#troubleshooting}

Un Vault local no aparece automáticamente en otro ordenador. Pertenencia, sincronización de archivos y publicación de enlaces son mecanismos diferentes. Si falta un espacio, comprueba cuenta y carpeta antes de eliminar datos.

## Guías relacionadas {#related-guides}

- [Instala Gnosi y da los primeros pasos](getting-started.md)
- [Preguntas frecuentes y recuperación](troubleshooting.md)

## Catálogo y moderación de plantillas de Vault

En modo personal, Configuración → General → Estructura de archivos → Vaults → Desde el repositorio abre el catálogo verificado. La búsqueda, los filtros por categoría y las vistas previas del contenido ayudan a elegir una plantilla; la instalación crea un Vault nuevo. Publicar plantilla abre un inventario con búsqueda de archivos incluidos, exclusiones y posibles datos sensibles. Actualizar el inventario borra la aceptación anterior.

## Disposiciones guardadas y notas en el canvas

Las disposiciones guardadas recuerdan notas abiertas, dibujos, lectores PDF y EPUB, documento activo y tamaños de paneles. También restauran las posiciones de lectura. Si un destino ya no existe, Gnosi informa del problema antes de sustituir la disposición actual.

En una tarjeta de página del canvas, utiliza **Editar** y **Guardar** para modificar su nota. Los borradores se conservan al cambiar de disposición durante la sesión; guárdalos antes de cerrar la aplicación. La importación y exportación JSON Canvas conservan las tarjetas, conexiones y metadatos compatibles. Importar no copia archivos adjuntos y Gnosi informa de las estructuras no compatibles.

## Lleva notas seleccionadas sin conexión

Inicia sesión en el servidor Gnosi, selecciona cuenta, espacio de trabajo y Vault y abre el complemento de notas sin conexión desde Ajustes → General. Crea una colección cifrada con una contraseña separada, carga la lista del servidor y añade las notas de texto necesarias. Utiliza **Guardar localmente** después de editar. Tras la primera carga correcta de producción, el complemento puede volver a abrirse sin red. En el navegador móvil, añádelo a la pantalla de inicio; el servidor debe utilizar HTTPS.

Reconecta y sincroniza explícitamente. Si ambas copias cambiaron, compara el texto original, local y del servidor y elige o escribe una versión combinada. Conserva la contraseña: no se puede recuperar y borrar los datos del navegador elimina los cambios no sincronizados. Los adjuntos y las notas incrustadas no se descargan con la nota. El servidor sigue utilizando el almacenamiento existente; esta colección local cifrada no es una copia de seguridad.

## Publica una colección de notas

Con el plugin de compartir activado, abre los controles de compartir de una nota y elige la publicación de varias páginas. Selecciona las notas, pon nombre al sitio y, opcionalmente, define su caducidad. Revisa la vista previa pública antes de publicar. Navegación y búsqueda solo incluyen las páginas seleccionadas; se indican los adjuntos, transclusiones privadas, HTML y consultas guardadas que se omiten. Los cambios del origen solo se publican después de previsualizar y publicar una actualización. Revoca el sitio desde el mismo gestor para impedir lecturas futuras; los visitantes pueden haber guardado copias.
