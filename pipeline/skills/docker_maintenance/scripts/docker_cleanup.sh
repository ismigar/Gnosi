#!/bin/bash
# Script de mantenimiento periódico para Docker (SEGURO)
# Purga imágenes y contenedores no utilizados, PERO NO ELIMINA VOLÚMENES

LOG_FILE="/Users/ismaelgarciafernandez/Projectes/monorepo/apps/gnosi/pipeline/skills/docker_maintenance/maintenance.log"

# Asegurar que el directorio de logs existe
mkdir -p "$(dirname "$LOG_FILE")"

echo "--- Iniciando limpieza de Docker SEGURA: $(date) ---" >> "$LOG_FILE"

if ! docker info > /dev/null 2>&1; then
    echo "ERROR: Docker no parece estar corriendo." >> "$LOG_FILE"
    exit 1
fi

# Ejecutar limpieza PERO SIN --volumes para no perder datos
docker system prune -a -f >> "$LOG_FILE" 2>&1

echo "--- Limpieza completada: $(date) ---" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"
