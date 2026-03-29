# DIRECTIVE: DOCKER_SYSTEM_MAINTENANCE

> ID: 20260209-DOCKER
> Associated Script: monorepo/apps/digital-brain/pipeline/skills/docker_maintenance/scripts/docker_cleanup.sh
> Last Update: 2026-02-09
> Status: DRAFT

---

## 1. Objectives and Scope

*Este protocolo define cómo realizar una limpieza profunda de Docker para evitar que las imágenes y volúmenes huérfanos agoten el espacio en disco.*

- **Main Objective:** Ejecutar `docker system prune` de forma periódica con todos los flags necesarios para una limpieza total.
- **Success Criteria:** El comando se ejecuta sin errores y libera espacio verificado por el log.

## 2. Input/Output (I/O) Specifications

### Inputs
- **Commands:** `docker system prune -a -f --volumes`

### Outputs
- **Logs:** Salida estándar redirigida a un archivo de log para auditoría.

## 3. Logical Flow (Algorithm)
1. **Verification:** Comprobar si Docker Desktop está corriendo.
2. **Execution:** Ejecutar la limpieza profunda.
3. **Logging:** Registrar la fecha y el espacio liberado.

## 4. Restrictions and Edge Cases
- **Running Containers:** Solo borra lo que NO está en uso. Si un contenedor está corriendo, su imagen y volúmenes están protegidos.
- **Docker Daemon:** Si Docker no está arrancado, el script fallará silenciosamente o registrará el error.

## 5. Examples of Use
```bash
bash docker_cleanup.sh
```
