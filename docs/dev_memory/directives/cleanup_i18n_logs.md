# Directive: CLEANUP_I18N_LOGS

> ID: 2026-04-07
> Associated Script: monorepo/apps/gnosi/pipeline/sandbox/cleanup_i18n.py
> Last Update: 2026-04-07
> Status: ACTIVE

---

## 1. Objectives and Scope

- **Main Objective:** Eliminar los mensajes informativos y de depuración de i18next en la consola del navegador.
- **Success Criteria:** El archivo `src/i18n.js` debe tener la propiedad `debug` establecida en `false`. Los logs "i18..." deben dejar de aparecer.

## 2. Input/Output (I/O) Specifications

### Inputs
- **Source Files:**
    - `monorepo/apps/gnosi/frontend/src/i18n.js`

### Outputs
- **Modified Files:**
    - `monorepo/apps/gnosi/frontend/src/i18n.js`

## 3. Logical Flow (Algorithm)

1. **Initialization:** Localizar el archivo de configuración de i18n en el frontend.
2. **Processing:** Leer el contenido del archivo y buscar la línea que contiene `debug: true`.
3. **Modification:** Reemplazar `debug: true` por `debug: false`.
4. **Verification:** Confirmar que el cambio se ha aplicado correctamente en el sistema de archivos.

## 4. Tools and Libraries

- **Python libraries:** `pathlib`, `re`.

## 5. Restrictions and Edge Cases

- **Formats:** Mantener la indentación y el estilo del archivo original.
- **Idempotency:** El script debe ser seguro de ejecutar múltiples veces sin efectos secundarios si ya está en `false`.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 07/04 | Persistencia de logs | Los logs "i18..." seguían apareciendo tras el cambio. | Caché de Vite/Navegador. Es necesario reiniciar el servidor o forzar refresco total. |

## 10. Additional Notes

Esta configuración se utiliza habitualmente en desarrollo pero debe estar desactivada para una experiencia de usuario limpia.
