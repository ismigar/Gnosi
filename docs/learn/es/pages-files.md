# Crea páginas, enlaces y adjuntos

Utiliza páginas para tus ideas y conserva cerca el material que las sustenta. Gnosi guarda el conocimiento en archivos Markdown y YAML.

## Antes de empezar {#before-you-begin}

Un Vault activo con escritura. La IA es opcional; compartir y traducir requiere los complementos correspondientes.

## Pasos {#steps}

1. Abre Conocimiento y crea “Proyecto de lectura”. Añade un encabezado, un párrafo y una lista de preguntas con el editor de bloques.

2. Crea “Notas de la fuente”. Enlázala desde la primera página con el selector de páginas; comprueba la selección si hay títulos similares.

3. Adjunta un documento pequeño con los controles del editor. Ábrelo de nuevo para comprobar que el archivo original está disponible.

4. Añade una cita textual con su fuente y localización. Sepárala de tu interpretación para poder rastrearla después.

5. Sal de la página y vuelve a abrirla para verificar el guardado automático. Recupérala con la búsqueda o la barra lateral y comprueba el enlace.

### Tablas anchas

En el menú **⋯** de la página, activa **Anchura libre** para que las tablas puedan expandirse y desplazarse horizontalmente. Los párrafos mantienen una anchura legible. La preferencia se recuerda por página en este dispositivo y no modifica el Markdown. Desactívala en el mismo menú para recuperar la visualización habitual.

### Buscar notas completas y reutilizar contenido

La búsqueda global encuentra palabras en cualquier parte de una nota y muestra
un fragmento. Puedes escribir `"frase exacta"`, `(rojo OR azul) -verde`,
`tag:investigación`, `content:"memoria de trabajo"`, `task-todo:revisar` o
`[estado:Borrador]`. `line:(zorro rojo)`, `block:(zorro rojo)` y
`section:(zorro rojo)` requieren las palabras en la misma línea, bloque o
sección. Una consulta incorrecta muestra un error para poder corregirla.
El bloque **Resultados de búsqueda**, o un bloque de código Markdown con lenguaje `query`,
mantiene resultados de búsqueda vivos dentro de una nota.

Escribe `![[Notas de la fuente]]` para mostrar todo su contenido con formato.
`![[Notas de la fuente#Encabezado]]` y `![[Notas de la fuente#^id-bloque]]`
incrustan una parte concreta. Se muestran tablas, código y notas anidadas; las
referencias circulares se detienen con una explicación. La fuente sigue siendo
una nota independiente y la transclusión se actualiza después de los cambios.

El editor de fuente Markdown incluye resaltado, varios cursores, modo Vim y
vista previa. Configura los atajos en los ajustes y guarda temas o fragmentos
CSS en Apariencia. Si un fragmento dificulta el uso de la interfaz, abre Gnosi
con `?gnosi-safe-appearance=1` y restablece la apariencia.

### Combina notas y guarda accesos

En el menú **⋯** de una nota, elige **Combina y extrae notas**. Selecciona la nota completa, un encabezado o líneas Markdown completas y elige una nota nueva o un destino existente. **Previsualiza los cambios** muestra el origen, el destino y los enlaces afectados. Revisa todos los cambios antes de aplicarlos. El origen conserva una transclusión y el historial. Si otro editor modifica un archivo, prepara una nueva vista previa.

En **Marcadores** de la barra lateral, guarda notas, secciones, búsquedas, vistas del grafo o enlaces web y asígnales un grupo. La estrella de una nota la añade o elimina de esta misma lista. Los antiguos favoritos y los marcadores de este dispositivo se importan automáticamente, conservando nombres propios y grupos. Los marcadores pertenecen a la cuenta, espacio de trabajo y Vault seleccionados. Se sincronizan mediante el mismo servidor Gnosi o cuando la carpeta del mismo Vault se sincroniza entre dispositivos. Los cambios se actualizan periódicamente y al volver a la aplicación; pulsa Actualizar para comprobarlos inmediatamente. Si la sincronización falla, se conservan los elementos guardados y los cambios en edición para poder reintentar.

Usa **Guardar la vista actual** para añadir una tabla, una vista guardada, un dibujo u otra vista estable de Gnosi. Las direcciones se guardan en relación con el Vault para que cada dispositivo pueda usar su propia dirección local. Los tableros, registros y plantillas usan el mismo tipo de marcador de página; el catálogo de Tableros sigue disponible.

## Resultado esperado {#expected-result}

La nota contiene texto legible, un enlace y un adjunto accesible.

## Si algo falla {#troubleshooting}

Si aparece un conflicto de guardado, conserva el texto pendiente y compáralo con la versión reciente antes de reintentar. Si falta un adjunto, comprueba el original y el Vault activo; una miniatura no es una copia de seguridad.

## Guías relacionadas {#related-guides}

- [Captura fuentes, lee y cita](reading-references.md)
- [Organiza registros y planifica el trabajo](databases-planning.md)
