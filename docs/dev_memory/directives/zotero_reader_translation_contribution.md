# Contribució de traduccions al reader de Zotero (català, castellà)

## Context

El visor de PDF/EPUB/HTML embedat al Vault de Gnosi és [`zotero/reader`](https://github.com/zotero/reader). Les seves traduccions venen del repo principal `zotero/zotero` a `chrome/locale/<lang>/zotero/reader.ftl`.

Al moment d'aquesta sessió (2026-05-19), el `ca-AD/reader.ftl` (i el `es-ES/reader.ftl`) tenen ~13 claus encara en anglès. Mentre Zotero no les tradueix, Gnosi les sobreescriu localment via un overlay (vegeu [`frontend/src/components/Vault/zotero-locale-overlays/`](../../monorepo/apps/gnosi/frontend/src/components/Vault/zotero-locale-overlays/)).

L'**objectiu d'aquest document** és facilitar enviar les mateixes traduccions upstream perquè el dia que Zotero les incorpori, puguem treure l'overlay i la comunitat sencera se'n beneficiï.

## Procés

Zotero **no accepta pull requests directes** a `chrome/locale/*/` (vegeu [CONTRIBUTING.md](https://github.com/zotero/zotero/blob/main/CONTRIBUTING.md) i [zotero.org/support/dev/localization](https://www.zotero.org/support/dev/localization)). La via oficial és **Transifex**:

1. Crear compte gratuït a [transifex.com](https://www.transifex.com) (si encara no en tens).
2. Anar al projecte **Zotero Desktop** a Transifex: <https://explore.transifex.com/zotero/zotero/> (es redirigeix al projecte; busca "zotero/zotero").
3. Demanar accés a l'equip català (`ca`/`ca-AD`) o castellà (`es`/`es-ES`).
4. Un cop aprovat, anar al component **`reader.ftl`** i traduir les claus de sota.
5. Repetir per `zotero.ftl` si hi ha algun string del visor que viu allí (`reader-` és l'únic prefix afectat ara).

Les traduccions catalanes a Transifex es revisen pel coordinador de l'equip català de Zotero (Carles Pina darrerament, però pot canviar).

## Claus a traduir (català)

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

## Claus a traduir (castellà)

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

## Després del merge upstream

Quan Zotero aprovi i incorpori les traduccions:

1. El proper `git submodule update --remote` del submodule `frontend/vendor/zotero-reader/` portarà un `.zotero-locale-commit` nou amb les traduccions ja al `chrome/locale/`.
2. `sh build-zotero-reader.sh` les baixarà automàticament a `public/zotero-reader/locales/`.
3. **No cal treure l'overlay**: Fluent l'aplica com a darrer bundle i no es trenca res si la traducció upstream coincideix.
4. Quan totes les claus del overlay siguin idèntiques a les d'upstream, es pot esborrar el fitxer overlay (i la branca del script que el copia) per reduir manteniment.

## Verificació periòdica

Per saber si Zotero ja ha incorporat traduccions:

```bash
COMMIT=$(cat monorepo/apps/gnosi/frontend/vendor/zotero-reader/.zotero-locale-commit)
curl -s "https://raw.githubusercontent.com/zotero/zotero/$COMMIT/chrome/locale/ca-AD/zotero/reader.ftl" \
    | grep -E "^reader-(note-annotation|page-options|prompt-delete-annotations-title) ="
```

Si veus les traduccions catalanes (no "Note Annotation", etc.), l'overlay ja és redundant per aquelles claus.
