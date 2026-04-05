# DIRECTIVE: VAULT_OBSIDIAN_TRANSCLUSION

> ID: 2026-04-04
Associated Script: N/A (Frontend Integration) Last Update: 2026-04-04
Status: ACTIVE

---

## 1. Objectives and Scope

Implementar transclusión estilo Obsidian en el editor del Vault usando la sintaxis `![[Nota]]` y `![[Nota#Apartado]]`.

- Main Objective: Permitir incrustar notas internas como bloques embebidos reutilizables.
- Success Criteria: `![[...]]` y `![[...#Apartado]]` se parsean como bloque de transclusión, se renderizan en el editor y se serializan de nuevo a la misma sintaxis.
- UX Objective: Al escribir `[[Nota#` o `![[Nota#`, sugerir apartados con jerarquía (`H1/H2/H3`) para navegar mejor documentos largos.

## 2. Input/Output (I/O) Specifications

### Inputs

- Source Files:
  - `monorepo/apps/gnosi/frontend/src/components/Vault/BlockEditor.jsx`
  - `monorepo/apps/gnosi/frontend/src/components/Vault/markdown-mapper.js`

### Outputs

- Functional UI:
  - Bloque `transclusion` en el esquema de BlockNote.
  - Render embebido con título de nota destino y extracto.
- Persistence:
  - Round-trip estable entre bloque y markdown `![[target]]`, `![[target#section]]` o `![[target#section|alias]]`.

## 3. Logical Flow (Algorithm)

1. Registrar un bloque custom `transclusion` en el esquema del editor.
2. Parsear líneas markdown con patrón `![[...]]` hacia bloque `transclusion`.
3. Parsear y serializar soporte de apartados (`#section`) y alias (`|alias`).
4. Renderizar el embed resolviendo título por `idToTitle` y cargando extracto desde API de páginas.
5. Si hay `#apartado`, recortar previsualización al contenido de ese apartado hasta el siguiente heading de igual o menor nivel.
6. En sugerencias de `#`, mostrar contexto jerárquico (padres) para evitar ambigüedades.
5. Añadir vía de inserción desde menú slash/sugerencias para facilitar creación.

## 4. Tools and Libraries

- BlockNote (`@blocknote/react`, `@blocknote/core`)
- Axios para recuperar vista previa del contenido.

## 5. Restrictions and Edge Cases

- Si el destino no existe o no es resoluble por ID/título, mantener fallback textual sin romper guardado.
- No romper compatibilidad con enlaces markdown estándar ni wikilinks existentes.
- No introducir transformaciones destructivas en bloques no transclusión.
- En backend (backlinks/grafo), resolver `target#section` por `target` base para mantener consistencia de aristas.
- No asumir headings únicos por texto: en documentos largos, usar contexto jerárquico para distinguir secciones repetidas.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 04/04 | `![[...]]` no se renderiza como embed | El parser trataba la línea como párrafo markdown genérico | Añadir parser explícito de transclusión y bloque custom en schema/render. |
| 04/04 | `#apartado` no resolvía backlinks ni aristas de grafo | La resolución tomaba el literal completo (`target#section`) como id/título | Normalizar refs wiki separando por `#` en backend (`graph_service`, `vault_routes`, `server`). |
| 04/04 | La sugerencia de apartados era plana y ambigua | El extractor devolvía solo texto de heading, sin nivel ni ruta de padres | Devolver estructura `{title, level, path}` y mostrar sugerencias `Hn` con jerarquía. |
| 04/04 | `![[Nota#Apartado]]` mostraba preview global en vez de apartado | El embed limpiaba markdown completo sin recorte por sección | Extraer bloque de contenido delimitado por headings y usarlo como previsualización prioritaria. |

## 8. Pre-Execution Checklist

- [x] Confirmar arquitectura actual de editor y mapper markdown.
- [x] Validar que no hay directiva previa de transclusión.

## 9. Post-Execution Checklist

- [ ] Build frontend OK.
- [ ] Test visual: inserción y render de transclusión con y sin `#apartado`.
- [ ] Persistencia: guardado y recarga mantienen `![[...]]`.
