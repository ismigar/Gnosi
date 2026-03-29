# DIRECTIVE: PROJECT_BACKUP_SOP

> ID: 2026-02-09
> Associated Script: monorepo/apps/digital-brain/pipeline/sandbox/backup_projectes.py 
> Last Update: 2026-02-09
> Status: DRAFT

---

## 1. Objectives and Scope

*Mantenir una còpia de seguretat actualitzada i eficient de tot l'ecosistema de desenvolupament.*

- **Main Objective:** Realitzar un backup diari incremental de la carpeta `/Users/ismaelgarciafernandez/Projectes` cap a `/Users/ismaelgarciafernandez/Library/CloudStorage/OneDrive-UNED/Backups/Projectes`.
- **Success Criteria:** La carpeta de destinació és una rèplica exacta (excloent temporals) i l'script genera un log d'èxit.

## 2. Input/Output (I/O) Specifications

### Inputs

- **Source Path:** `/Users/ismaelgarciafernandez/Projectes/`
- **Destination Path:** `/Users/ismaelgarciafernandez/Library/CloudStorage/OneDrive-UNED/Backups/Projectes/`
- **Exclusion List:**
    - `node_modules/`
    - `.git/` (opcional, però recomanat mantenir-lo per seguretat extra si hi ha canvis no pushejats)
    - `.venv/`
    - `__pycache__/`
    - `.DS_Store`

### Outputs

- **Generated Artifacts:** Rèplica incremental en OneDrive.
- **Console Output:** Resum de fitxers transferits i temps total.

## 3. Logical Flow (Algorithm)

1. **Initialization:** Validar que tant la carpeta origen com la de destinació (OneDrive) estiguin muntades/disponibles.
2. **Setup:** Crear la carpeta de destinació si no existeix.
3. **Execution:** Executar `rsync -av --delete --exclude-from=[list]` per sincronitzar els canvis.
4. **Logging:** Registrar la data, hora i volum de dades sincronitzat.
5. **Notification:** (Opcional) Notificar si el backup falla.

## 4. Tools and Libraries

- **System:** `rsync` (v3.x recomanat).
- **Python:** `subprocess`, `datetime`, `os`.

## 5. Restrictions and Edge Cases

- **File Locks:** Si algun fitxer està obert (com `database.sqlite` d'n8n), rsync podria fallar o copiar un estat inconsistent. El backup s'hauria de fer quan els serveis estiguin en idle o aturar-los breument (per a fitxers crítics).
- **Network:** OneDrive ha d'estar actiu per sincronitzar el backup al núvol després de la còpia local.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 09/02 | UnicodeDecodeError | output de `rsync` amb caràcters no UTF-8 | No usar `text=True` per a captures grans; usar `capture_output=False`. |

## 7. Examples of Use

```bash
python backup_projectes.py
```
