# Overlay de traducciones castellanas para el reader de Zotero. Mismo
# motivo que ca-AD.ftl. Sólo claves terminales (las que tienen atributos
# Fluent como `.title` ya están bien definidas al `reader.ftl` original).

reader-note-annotation = Nota
reader-image-annotation = Anotación de imagen
reader-ink-annotation = Anotación de tinta

reader-page-options = Opciones de página
reader-vertical = Vertical
reader-theme-invert-images = Invertir imágenes
reader-theme-original = Original

reader-epub-encrypted = Este libro electrónico está cifrado y no se puede abrir.
reader-reading-mode-not-supported = El modo de lectura no es compatible con este documento.

reader-prompt-delete-annotations-title = Eliminar anotaciones
reader-prompt-delete-annotations-text =
    { $count ->
        [one] ¿Seguro que quieres eliminar la anotación seleccionada?
       *[other] ¿Seguro que quieres eliminar las anotaciones seleccionadas?
    }
reader-prompt-delete-pages-text =
    { $count ->
        [one] ¿Seguro que quieres eliminar { $count } página del archivo PDF?
       *[other] ¿Seguro que quieres eliminar { $count } páginas del archivo PDF?
    }
reader-prompt-transfer-from-pdf-text = Las anotaciones almacenadas en el archivo PDF se moverán a { $target }.

reader-import-from-epub-prompt-title = Importar anotaciones del EPUB
reader-import-from-epub-select-other = Elegir otro archivo…
