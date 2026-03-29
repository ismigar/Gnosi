#!/bin/bash
# Script de mantenimiento periódico para Docker
# Purga imágenes, contenedores, volúmenes y networks no utilizados

LOG_FILE="/Users/ismaelgarciafernandez/Projectes/monorepo/apps/digital-brain/pipeline/skills/docker_maintenance/maintenance.log"

echo "--- Iniciando limpieza de Docker: $(date) ---" >> "$LOG_FILE"

if ! docker info > /dev/null 2>&1; then
    echo "ERROR: Docker no parece estar corriendo." >> "$LOG_FILE"
    exit 1
fi

# Ejecutar limpieza profunda
docker system prune -a -f --volumes >> "$LOG_FILE" 2>&1

echo "--- Limpieza completada: $(date) ---" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"
