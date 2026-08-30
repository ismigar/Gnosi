# Overlay de traduccions catalanes per al reader de Zotero.
#
# Per què cal: la versió a `chrome/locale/ca-AD/zotero/reader.ftl` del repo
# de Zotero té una dotzena de claus sense traduir (literals en anglès).
# Aquest overlay les omple. Es carrega com a ÚLTIM bundle del `ftl: [...]`
# que passem a `createReader`, perquè el reader fa `addResource(..., {
# allowOverrides: true })` — l'últim bundle guanya.
#
# IMPORTANT: només sobreescrivim claus terminals (label=text). Les claus
# amb atributs Fluent (`.title = { ... }`, etc.) ja estan correctament
# definides al `reader.ftl` original (referencien aquestes mateixes claus
# terminals); si les substituíssim aquí com a `key = string` simple,
# carregaríem el `.title` i el botó quedaria sense títol.
#
# Quan Zotero les acabi traduint upstream (vegeu PR paral·lel), aquest
# fitxer pot anar perdent files. Mentrestant, mantenir-les aquí evita
# tenir el menú barrejat amb anglès.

reader-note-annotation = Nota
reader-image-annotation = Anotació d'imatge
reader-ink-annotation = Anotació de tinta

reader-page-options = Opcions de pàgina
reader-vertical = Vertical
reader-theme-invert-images = Inverteix les imatges
reader-theme-original = Original

reader-epub-encrypted = Aquest llibre electrònic està xifrat i no es pot obrir.
reader-reading-mode-not-supported = El mode de lectura no és compatible amb aquest document.

reader-prompt-delete-annotations-title = Suprimeix les anotacions
reader-prompt-delete-annotations-text =
    { $count ->
        [one] Segur que voleu suprimir l'anotació seleccionada?
       *[other] Segur que voleu suprimir les anotacions seleccionades?
    }
reader-prompt-delete-pages-text =
    { $count ->
        [one] Segur que voleu suprimir { $count } pàgina del fitxer PDF?
       *[other] Segur que voleu suprimir { $count } pàgines del fitxer PDF?
    }
reader-prompt-transfer-from-pdf-text = Les anotacions emmagatzemades al fitxer PDF es mouran a { $target }.

reader-import-from-epub-prompt-title = Importa les anotacions de l'EPUB
reader-import-from-epub-select-other = Tria un altre fitxer…
