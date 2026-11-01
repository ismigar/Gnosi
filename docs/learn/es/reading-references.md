# Captura fuentes, lee y cita

Sigue el recorrido de investigación desde la fuente hasta la evidencia y tu propia escritura. Leer canales y gestionar bibliografía son funciones distintas.

## Antes de empezar {#before-you-begin}

Activa Recursos para referencias y Lector de canales para suscripciones. Consultar identificadores requiere conexión; citar en Word o LibreOffice requiere su complemento.

## Pasos {#steps}

1. Abre **Búsqueda bibliográfica** (la función Recursos) y comprueba la tabla de referencias configurada. Importa DOI, ISBN, arXiv o PMID, un archivo BibTeX/RIS o una URL compatible.

2. Revisa título, autoría, fecha e identificador antes de utilizar el registro. Resuelve los posibles duplicados en vez de repetir la importación.

3. Abre un PDF o EPUB adjunto. Anota un pasaje conservando página, capítulo u otra localización y verifica que apunta al fragmento correcto.

4. Crea una nota de lectura con la evidencia y un párrafo separado con tu interpretación. Enlázala con la referencia y el proyecto.

5. Para seguir canales, activa el Lector, añade uno y abre un artículo. Su contenido puede requerir acceso al sitio del editor.

6. Para redactar, instala y configura el [complemento de Word](https://github.com/ismigar/Gnosi/tree/main/extensions/office/word-cite) o la [extensión de LibreOffice](https://github.com/ismigar/Gnosi/tree/main/extensions/office/libreoffice-cite). Utiliza el selector de citas y la bibliografía y comprueba autoría, año y estilo.

## Resultado esperado {#expected-result}

Tienes una referencia revisada, una anotación rastreable y una nota conectada con tu escrito.

### Campos de las notas generadas

En **Configuración → Plugins → Conocimiento**, dentro de cada tabla de recursos, utiliza **Campos a rellenar en las notas de lectura → Añadir campo**. Elige un campo del Cerebro y selecciona **Inferir con IA**, **Copiar campo fuente**, **Valor fijo** o **Dejar vacío**. Quitar una regla no elimina el campo de la tabla. Esta selección es independiente de los campos con índice.

La IA asigna valores según cada nota y solo utiliza las etiquetas y relaciones existentes. Los valores fijos respetan el tipo del campo, incluidos números, casillas y fechas; los adjuntos y otros campos estructurados se pueden copiar del recurso. Los campos calculados y del sistema se gestionan automáticamente. Las reglas se aplican al procesar o volver a procesar el recurso. **Dejar vacío** vacía el valor en las notas reprocesadas; quitar la regla conserva los valores anteriores.

## Si algo falla {#troubleshooting}

El identificador aporta metadatos, pero no garantiza acceso al texto completo. Si falla, revisa identificador y proveedor o prueba una exportación compatible. Corrige los metadatos antes de editar manualmente la bibliografía.

## Guías relacionadas {#related-guides}

- [Pregunta sobre las fuentes seleccionadas](notebooks.md)
- [Crea páginas, enlaces y adjuntos](pages-files.md)

## Escuchar el pódcast diario

Con el Lector de canales activado, configura el pódcast diario en sus ajustes y el modelo del asistente asignado en **Configuración → IA**. El episodio diario selecciona artículos publicados durante las 24 horas anteriores. Se informa de las fuentes que no se pueden leer; si no se puede leer ninguna, no se publica ningún episodio.

Personaliza la habilidad **Resumen diario** asignada para ajustar su enfoque editorial y las preferencias del pódcast. Los valores predeterminados solicitan diez minutos y un máximo de doce grupos temáticos. La revisión predeterminada comprueba los resúmenes de las fuentes y la cobertura temática, incluidos los temas independientes menos representados; la revisión completa opcional examina los fragmentos originales con mayor profundidad. La duración es un objetivo y la generación puede fallar si no cumple los requisitos de longitud o de fidelidad a las fuentes. Comprueba el episodio terminado y las fuentes indicadas antes de darlo por válido.

Los ajustes de voz se comparten entre el chat, los pódcasts del Lector y el audio generado dentro del Vault activo. Los cambios se guardan automáticamente; comprueba su estado antes de escuchar una prueba. La voz local debe estar disponible en el servidor y la voz neuronal requiere el proveedor configurado.

### Generación y recuperación

Activa el Lector de canales y la IA, configura el asistente asignado a la habilidad del resumen diario y comprueba los ajustes de voz. En el Lector, utiliza el botón para generar el pódcast; si ya existe un episodio, utiliza su botón para regenerarlo. Abre el panel de voz bajo el reproductor para escuchar una prueba, o utiliza su botón **Abrir configuración** para editar la configuración compartida. La prueba no está disponible durante la generación.

El episodio utiliza los artículos publicados en las 24 horas anteriores, incluidos los ya leídos. Los artículos sin texto legible ni resumen del canal se omiten y se notifican. La generación puede tardar varios minutos; sigue su progreso y utiliza Actividad para inspeccionar la tarea o cancelarla. Escucha el episodio terminado en el reproductor. Un error o una cancelación conserva el audio anterior; si no hay ningún artículo legible, no se produce un reemplazo.

Los días con pocos artículos pueden producir episodios más cortos. Los cambios de configuración se aplican a tareas nuevas; una tarea reanudada conserva la selección y las preferencias originales.
