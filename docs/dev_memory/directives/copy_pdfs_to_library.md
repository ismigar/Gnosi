# Directiva: Copia Recursiva de PDFs a Biblioteca

> ID: copy_pdfs_to_library
> Associated Script: monorepo/apps/digital-brain/pipeline/sandbox/copy_pdfs.py
> Last Update: 2026-02-14
> Status: DRAFT

---

## 1. Objetivos y Alcance

*Copiar todos los archivos PDF desde una carpeta de origen (y sus subcarpetas) a una carpeta de destino plana, evitando duplicados.*

- **Objetivo Principal:** Centralizar PDFs de `OneDrive/Documents/Filosofia/UNED` en `OneDrive/Biblioteca_PDFS`.
- **Criterios de Éxito:**
    - Todos los PDFs encontrados en la estructura de origen están presentes en el destino.
    - No se sobrescriben archivos si ya existen (skipping).
    - Se mantiene un log de las operaciones.

## 2. Especificaciones de E/S

### Entradas

- **Origen:** `/Users/ismaelgarciafernandez/OneDrive/Documents/Filosofia/UNED`
- **Destino:** `/Users/ismaelgarciafernandez/OneDrive/Biblioteca_PDFS`

### Salidas

- **Archivos:** Copias de los PDFs en la carpeta destino.
- **Log:** Salida estándar indicando archivos copiados y omitidos.

## 3. Flujo Lógico (Algoritmo)

1. **Escanear:** Recorrer recursivamente la carpeta de origen buscando archivos `.pdf`.
2. **Iterar:** Para cada archivo PDF encontrado:
    - Construir la ruta de destino (flattening: solo el nombre del archivo en la raiz del destino).
    - **Verificación:** Comprobar si un archivo con el mismo nombre ya existe en el destino.
    - **Acción:**
        - Si NO existe: Copiar el archivo (`shutil.copy2` para preservar metadatos).
        - Si SI existe: Omitir (Log: "Skipped [filename], already exists").
3. **Resumen:** Imprimir el total de archivos copiados y omitidos.

## 4. Herramientas y Librerías

- **Python:** `os`, `shutil`, `pathlib`.

## 5. Restricciones y Casos Borde

- **Nombres Duplicados:** Si dos subcarpetas diferentes tienen un PDF con el mismo nombre, el primero que se procese ganará. El segundo será omitido. *Decisión: Aceptar este comportamiento por ahora.*
- **Permisos:** Asegurar permisos de lectura/escritura en OneDrive.

## 6. Protocolo de Errores y Aprendizaje

| Fecha | Error Detectado | Causa Raíz | Solución/Parche Aplicado |
| --- | --- | --- | --- |
## 6. Protocolo de Errores y Aprendizaje

| Fecha | Error Detectado | Causa Raíz | Solución/Parche Aplicado |
| --- | --- | --- | --- |
| 2026-02-14 | `[Errno 60] Operation timed out` en 3 archivos (Galtung, FPI, Bermejo) | Timeout de red al copiar a OneDrive (volumen montado). | El script capturó la excepción. **Se reintentó la ejecución y los 3 archivos se copiaron correctamente.** Futura mejora: implementar reintentos automáticos en el script. |
