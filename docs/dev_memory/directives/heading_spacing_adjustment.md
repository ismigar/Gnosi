# Directiva: Ajust d'Espaiat de Headings (h1-h6)

## Context
L'usuari ha detectat que els elements `h1` fins `h6` tenen un `padding` superior i inferior que hauria de ser `margin`. Aquest comportament sol provenir dels estils per defecte de les llibreries externes (BlockNote/Mantine) o de resets incomplets.

## Objectiu
Assegurar que tots els encapçalaments a l'editor (`.bn-editor`) utilitzin exclusivament `margin` per al seu espaiat vertical, i que el color de fons (`background-color`) s'apliqui directament sobre l'element de text i no sobre el contenidor del bloc, per evitar que el fons ocupi l'àrea dels marges.

## Passos a seguir
1. **Identificació:** Localitzar les definicions de headings a `monorepo/apps/gnosi/frontend/src/index.css`.
2. **Eliminació de Padding:** Afegir `padding-top: 0 !important;` i `padding-bottom: 0 !important;` a tots els selectors de headings (`h1` a `h6`).
3. **Aplicació de Margin:** Assegurar que els valors d'espaiat es defineixin mitjançant `margin-top` i `margin-bottom`.
4. **Correcció de Background:**
    - Fer que el contenidor `.bn-block-content[data-background-color]` sigui transparent.
    - Aplicar el color de fons corresponent directament al fill (`h1...h6`).
    - Utilitzar `display: inline-block` o similar per a que el fons s'ajusti a l'alçada i amplada del text, si escau.

## Restriccions i Advertiments
- **Colors:** Mapejar els valors de `data-background-color` (orange, blue, etc.) a les variables de BlockNote (`var(--bn-colors-highlights-X-background)`).
- **Especificitat:** Utilitzar `!important` només si és necessari per sobreescriure els estils injectats per BlockNote al contenidor.
- **Alineació:** Si s'usa `display: inline-block`, assegurar que el heading no perdi la seva naturalesa de bloc (amplada completa) si el disseny ho requereix, o aplicar `padding` horitzontal per a un aspecte premiat.

## Verificació
- Validar que el build del frontend no falli.
- Inspeccionar el DOM al navegador per confirmar que el fons de color només ocupa l'alçada del text (sense els marges).
