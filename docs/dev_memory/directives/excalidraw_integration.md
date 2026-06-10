# DIRECTIVE: EXCALIDRAW_INTEGRATION_MVP

> ID: 2026-02-28
Associated Script: sandbox/test_excalidraw_save.py Last Update: 2026-02-28
Status: ACTIVE

---

## 1. Objectives and Scope

Integrar Excalidraw com a eina de dibuix nativa dins del vault de Gnosi.

- **Main Objective:** Permetre la creació, edició i persistència de fitxers `.excalidraw.json` al vault.
- **Success Criteria:** L'usuari pot crear un dibuix nou des del sidebar, dibuixar, i que els canvis es guardin automàticament al fitxer corresponent del sistema de fitxers.

## 2. Input/Output (I/O) Specifications

### Inputs

- **Environment Variables:**
    - `VAULT_PATH`: Ruta base on es guarden els fitxers del vault.
- **Source Files:**
    - `vault/*.excalidraw.json`: Fitxers de dades de l'escena d'Excalidraw.

### Outputs

- **Generated Artifacts:**
    - `vault/*.excalidraw.json`: Actualitzats amb els nous elements del dibuix.
- **Preview Files:**
    - `vault/.thumbnails/*.svg`: (Fase 1.5) Previsualitzacions per al sidebar.

## 3. Logical Flow (Algorithm)

1.  **Frontend - Initialization**: Carregar `@excalidraw/excalidraw` dinàmicament (per evitar pes excessiu en el bundle inicial).
2.  **Frontend - Editor UI**: Mostrar el component Excalidraw dins d'un layout que permeti tancar-lo i veure el nom del fitxer.
3.  **Frontend - Change Detection**: Fer servir el callback `onChange` per detectar canvis en els elements o l'estat.
4.  **Frontend - Persistence**: Implementar un mecanisme de `debounce` (ex. 2 segons) que enviï el JSON actualitzat al backend via `PUT /api/vault/content`.
5.  **Backend - Storage**: Rebre el JSON i escriure'l al fitxer `.excalidraw.json` al vault del disc.
6.  **Backend - Graph Integration**: (Fase 2) Analitzar el JSON per extreure textos que continguin `[[enllaços]]`.

## 4. Tools and Libraries

- **Frontend:** `@excalidraw/excalidraw`, `react`, `axios`.
- **Backend:** `fastapi`, `python-json-logger`.

## 5. Restrictions and Edge Cases

- **Mida del fitxer**: Els fitxers JSON d'Excalidraw poden créixer si s'afegeixen moltes imatges. Cal vigilar el límit de payload de l'API.
- **Asset Path**: Excalidraw necessita configurar `window.EXCALIDRAW_ASSET_PATH` per carregar fonts i icones si no es vol dependre de la seva CDN.
- **SSR**: Excalidraw NO suporta Server Side Rendering. Només s'ha de carregar al client.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 28/02 | Proposta inicial | N/A | Decisió d'usar sistema propi vs plugins Obsidian. |
| 2026-06-10 | Autosave de TldrawEditor sobreescrivia dibuixos reals (i eclipsava els `.excalidraw.json` legacy) quan la càrrega fallava | Error de GET tractat com a "dibuix nou" + `loadSnapshot` no-op silenciós | Vegeu directiva `tldraw_save_integrity.md` |

## 7. Examples of Use

```javascript
// Exemple d'ús del component
<Excalidraw 
  initialData={content} 
  onChange={(elements, state) => handleSave(elements, state)} 
/>
```

---

## 8. Pre-Execution Checklist

- [ ]  Instal·lar `@excalidraw/excalidraw` al frontend.
- [ ]  Assegurar-se que el backend accepta fitxers `.json` genèrics al vault.
- [ ]  Crear carpeta `vault/drawings` (opcional o directament a l'arrel).

## 9. Post-Execution Checklist

- [ ]  Validar que el fitxer es guarda correctament al disc.
- [ ]  Verificar que el gràfic de coneixement no peta en trobar un fitxer JSON desconegut.
- [ ]  Provar el canvi de tema (Dark/Light).
