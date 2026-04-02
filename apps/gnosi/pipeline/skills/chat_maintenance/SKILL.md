# DIRECTIVE: CHAT_MEDIA_PURGE_MAINTENANCE

> ID: 20260209-PURGE
> Associated Script: monorepo/apps/digital-brain/pipeline/sandbox/purge_chat_media.py
> Last Update: 2026-02-09
> Status: DRAFT

---

## 1. Objectives and Scope

*Este protocolo define cómo limpiar archivos antiguos de aplicaciones de mensajería (WhatsApp y Telegram) para evitar el agotamiento del espacio en disco.*

- **Main Objective:** Eliminar automáticamente archivos multimedia (fotos, videos, audios) de WhatsApp y Telegram que tengan más de 7 días de antigüedad.
- **Success Criteria:** Los archivos con fecha de modificación superior a 7 días en las rutas especificadas son eliminados, liberando espacio sin afectar la base de datos de mensajes.

## 2. Input/Output (I/O) Specifications

### Inputs

- **Required Arguments:**
    - `--days`: Integer - Número de días de antigüedad para purgar (default: 7).
    - `--dry-run`: Boolean - Si es true, solo lista lo que borraría sin borrar nada.
- **Source Directories:**
    - WhatsApp: `~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/Message/Media`
    - Telegram: `~/Library/Group Containers/*.keepcoder.Telegram/appstore/account-*/postbox/resources`

### Outputs

- **Console Output:** Resumen detallado de archivos eliminados y espacio total liberado en MB/GB.

## 3. Logical Flow (Algorithm)

1. **Initialization:** Validar que las rutas de las aplicaciones existen.
2. **Scan:** Recorrer recursivamente las carpetas de media buscando archivos.
3. **Filter:** Identificar archivos cuya fecha de última modificación (mtime) sea mayor a N días.
4. **Execution:** Si no es `dry-run`, eliminar los archivos filtrados.
5. **Reporting:** Calcular el tamaño total de los archivos eliminados y mostrar el resumen.

## 4. Tools and Libraries

- **Python libraries:** `os`, `time`, `pathlib`, `argparse`, `glob`.

## 5. Restrictions and Edge Cases

- **Root Folders:** NO borrar las carpetas raíz o carpetas de base de datos (.sqlite). Solo archivos dentro de carpetas de recursos/media.
- **Permissions:** El script requiere permisos de acceso a la carpeta `Library`.
- **Integrity:** WhatsApp y Telegram deben estar cerrados idealmente, aunque borrar solo media no suele corromper la DB.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 09/02 | Permisos denegados | macOS Sandbox | Asegurarse de que el script corre con permisos suficientes o avisar al usuario. |

## 7. Examples of Use

```bash
# Simulación de purga de 7 días
python purge_chat_media.py --days 7 --dry-run

# Purga real de 7 días
python purge_chat_media.py --days 7
```

## 8. Pre-Execution Checklist

- [ ] Rutas de WhatsApp/Telegram comprobadas.
- [ ] Backup de mensajes (opcional pero recomendado).

## 9. Post-Execution Checklist

- [ ] Espacio liberado verificado con `df -h`.
- [ ] Aplicaciones de chat abren correctamente.
