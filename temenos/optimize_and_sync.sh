#!/bin/bash
# Comprimeix imatges i PDFs de Temenos i sincronitza amb el servidor

set -e

SERVER="ismigar@web-12.pangea.org"
REMOTE_BASE="/home/ismigar/webapps/web/web/sites/default/files"
LOCAL_BASE="/Users/ismaelgarciafernandez/Projectes/temenos/web/sites/default/files"

# Directoris a processar
DIRS=("images-blog" "2026-01" "2025-12" "2026-02" "resources")

QUARTZ_FILTER="/System/Library/Filters/Reduce File Size.qfilter"

compress_images() {
    local dir="$1"
    local count
    count=$(find "$dir" \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.JPG" -o -name "*.png" -o -name "*.PNG" \) | wc -l | tr -d ' ')
    if [ "$count" -eq 0 ]; then return; fi
    echo "  Comprimint $count imatges..."
    find "$dir" \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.JPG" \) \
        -exec sips -s formatOptions 85 {} \; > /dev/null 2>&1
    find "$dir" \( -name "*.png" -o -name "*.PNG" \) \
        -exec sips -s formatOptions best {} \; > /dev/null 2>&1
}

compress_pdfs() {
    local dir="$1"
    local count
    count=$(find "$dir" -name "*.pdf" -o -name "*.PDF" | wc -l | tr -d ' ')
    if [ "$count" -eq 0 ]; then return; fi
    echo "  Comprimint $count PDFs..."
    while IFS= read -r pdf; do
        local tmp="${pdf}.tmp.pdf"
        if /System/Library/Printers/Libraries/convert \
            -j "$QUARTZ_FILTER" -o "$tmp" "$pdf" > /dev/null 2>&1; then
            # Només substituir si el resultat és més petit
            local orig_size new_size
            orig_size=$(stat -f%z "$pdf")
            new_size=$(stat -f%z "$tmp")
            if [ "$new_size" -lt "$orig_size" ]; then
                mv "$tmp" "$pdf"
            else
                rm -f "$tmp"
            fi
        else
            rm -f "$tmp"
        fi
    done < <(find "$dir" \( -name "*.pdf" -o -name "*.PDF" \))
}

echo "=== Optimitzador Temenos ==="
echo ""

for DIR in "${DIRS[@]}"; do
    LOCAL_DIR="$LOCAL_BASE/$DIR"
    REMOTE_DIR="$REMOTE_BASE/$DIR"

    echo ">>> $DIR"

    # Baixar si no existeix localment
    if [ ! -d "$LOCAL_DIR" ]; then
        echo "  Baixant del servidor..."
        mkdir -p "$LOCAL_DIR"
        rsync -az "$SERVER:$REMOTE_DIR/" "$LOCAL_DIR/"
    fi

    # Mida abans
    SIZE_BEFORE=$(du -sh "$LOCAL_DIR" | cut -f1)

    # Comprimir
    compress_images "$LOCAL_DIR"
    compress_pdfs "$LOCAL_DIR"

    # Mida després
    SIZE_AFTER=$(du -sh "$LOCAL_DIR" | cut -f1)
    echo "  $SIZE_BEFORE → $SIZE_AFTER"

    # Pujar al servidor
    echo "  Pujant al servidor..."
    rsync -az --progress "$LOCAL_DIR/" "$SERVER:$REMOTE_DIR/"

    echo ""
done

echo "=== Fet! ==="
echo "Recorda executar al servidor: ./dr image:flush --all"
