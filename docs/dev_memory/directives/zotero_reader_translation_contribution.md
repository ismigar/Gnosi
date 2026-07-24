# Contributing Catalan and Spanish translations to Zotero Reader

## Context

Gnosi embeds [`zotero/reader`](https://github.com/zotero/reader) for PDF,
EPUB, and HTML documents. Its translations come from the main Zotero
repository under `chrome/locale/<lang>/zotero/reader.ftl`.

As of 2026-05-19, the Catalan and Spanish `reader.ftl` files still had about
13 English keys. Gnosi overrides them through local overlays under
[`zotero-locale-overlays`](../../monorepo/apps/gnosi/frontend/src/components/Vault/zotero-locale-overlays/).

The objective is to contribute these translations upstream so the overlays
can eventually be removed and the wider Zotero community benefits.

## Process

Zotero does not accept direct pull requests to `chrome/locale/*/`. Follow
[Zotero contribution guidance](https://github.com/zotero/zotero/blob/main/CONTRIBUTING.md)
and the [localization guide](https://www.zotero.org/support/dev/localization)
through Transifex:

1. Create a free Transifex account.
2. Open the [Zotero Desktop project](https://explore.transifex.com/zotero/zotero/).
3. Request access to the Catalan or Spanish team.
4. Translate the listed keys in the `reader.ftl` component.
5. Check `zotero.ftl` for reader-prefixed strings as well.

The relevant Zotero language-team coordinator reviews submissions.

## Catalan keys

```ftl
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
```

## Spanish keys

```ftl
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
```

## After the upstream merge

After Zotero accepts the translations:

1. Updating the reader submodule brings a new `.zotero-locale-commit` with the
   translations in `chrome/locale/`.
2. `build-zotero-reader.sh` copies them into
   `public/zotero-reader/locales/`.
3. The overlay can remain temporarily; Fluent applies it last and identical
   values are harmless.
4. Remove the overlay and copy branch once every override matches upstream.

## Periodic verification

Check whether the pinned Zotero locale commit contains the translations:

```bash
COMMIT=$(cat monorepo/apps/gnosi/frontend/vendor/zotero-reader/.zotero-locale-commit)
curl -s "https://raw.githubusercontent.com/zotero/zotero/$COMMIT/chrome/locale/ca-AD/zotero/reader.ftl" \
    | grep -E "^reader-(note-annotation|page-options|prompt-delete-annotations-title) ="
```

When the upstream file contains the Catalan translations, those overlay keys
are redundant.
