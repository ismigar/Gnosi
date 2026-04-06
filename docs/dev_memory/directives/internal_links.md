# DIRECTIVE: IMPLEMENTACIO_ENLLAÇOS_INTERNS

> ID: 20240228_INTERNAL_LINKS
> Associated Script: N/A
> Status: ACTIVE
> Last Update: 2026-04-05

---

## 1. Objectius i Abast

Implementar un sistema d'enllaçat entre notes que emuli el comportament d'Obsidian (`[[Note Name]]`).

- **Objectiu Principal:** Permetre a l'usuari crear vincles entre documents del Vault de forma ràpida mitjançant autocompletat.
- **Criteris d'Èxit:** 
    - El menú de suggeriments apareix en escriure `[[`.
    - La selecció insereix un enllaç funcional.
    - El backend reconeix aquests enllaços per al graf de coneixement.

## 2. Especificacions d'Entrada/Sortida (I/O)

### Entrades
- Sintaxi d'usuari: `[[` seguit de caràcters de cerca.
- Llista de notes: Proporcionada pel context de l'editor (`allNotes`).

### Sortides
- Bloc de text amb enllaç inserit.
- Connexió al graf de coneixement.
- Panell bidireccional de relacions per pàgina:
    - `Enllaça a` (outgoing links)
    - `Enllaçat per` (backlinks / incoming links)
- Panell `Mencions sense enllaç` (unlinked mentions) amb conversió automàtica a enllaç intern.

## 3. Flux Lògic (Algorisme)

1. **Detecció:** L'editor escolta el caràcter `[`. Si el següent és `[`, activa el menú.
2. **Filtrat:** Es filtren les notes existents per títol basant-se en el text després de `[[`.
3. **Inserció:** En confirmar, s'insereix un element de tipus "link" amb l'ID de la nota.
4. **Sincronització:** El backend analitza el Markdown i actualitza el graf amb la nova aresta.
5. **Backlinks:** El backend detecta i resol referències entrants per ID i per títol per alimentar el panell `Enllaçat per`.
6. **Unlinked Mentions:** El backend detecta mencions de títol en text pla que encara no són enllaç i permet convertir-les en bloc o per nota origen.
7. **Block References:** Les referències `#^blockId` s'han de suggerir i mantenir operatives en enllaços i transclusions.

## 4. Eines i Llibreries
- **BlockNote SDK:** Per a la gestió del menú de suggeriments.
- **FastAPI / Python (Backend):** Per al processament del graf.
- **Sigma.js / Graphology:** Per a la visualització.

## 5. Restriccions i Casos Extrems
- **Notes amb el mateix títol:** S'ha d'utilitzar l'ID (filename) per a l'enllaç real, mostrant el títol readable.
- **Notes inexistents:** Obsidian permet crear enllaços a notes que no existeixen encara. En aquesta fase, ens centrarem en enllaçar notes existents, però és un possible "future work".
- **Normalització d'enllaços:** Cal resoldre com a objectiu equivalent les variants `id`, `/vault/page/{id}`, `/api/vault/pages/{id}` i referències per títol.
- **Apartats (`#section`) i alias (`|alias`):** La detecció de backlinks ha d'ignorar el fragment i comparar el target base.
- **Mencions no enllaçades:** En convertir text pla a enllaç, no tocar segments que ja siguin `[[...]]` o `[text](...)`.
- **Block refs (`^id`):** Per previews de transclusió, si el target és `#^id` extreure la línia marcada (sense el marcador) en lloc de cercar un heading.
- **Nota operativa (error real detectat):** Note: Do not invoke `build_id_title_index()` in endpoints de links si la funció no existeix o no és visible en el mòdul, perquè provoca `NameError` i retorna 500 a `/api/vault/backlinks` i `/api/vault/unlinked-mentions`. Instead, do mantenir un helper global `build_id_title_index()` definit abans dels endpoints i reutilitzar-lo també a `/api/vault/global-index`.
- **Cobertura de fonts:** Els scans de backlinks/mencions no han de limitar-se només a `*.md`; cal incloure també fitxers Dashworks `*.json` per mantenir paritat funcional entre Wiki i Dashworks.
- **Exclusió d'històric:** Note: Do not escanejar `VAULT/.history/**` quan es construeix `id -> title` o quan es busquen backlinks/mencions, perquè introdueix pàgines antigues com si fossin vives (falsos duplicats de títol i backlinks fantasma). Instead, do excloure explícitament qualsevol fitxer amb `.history` al path.
- **Inserció de wikilinks al bloc actual:** No fer `replaceBlocks`/`updateBlock` de tot el paràgraf quan hi ha un `[[` o `[` incomplet, perquè pot eliminar text després del cursor. Inserir contingut inline de manera no destructiva.
- **Compatibilitat BlockNote (estils inline):** No utilitzar `styles: { link: ... }` en insercions inline si l'schema no defineix explícitament aquest estil; pot trencar amb `style link not found in styleSchema`. Prioritzar inserció de `[[...]]` com text wiki.
- **Línies amb enllaços inline existents:** Note: Do not inserir `[text](url)` quan el bloc ja conté nodes `link` inline (especialment en bullets), perquè la sintaxi de markdown pot barrejar-se amb enllaços existents i corrompre tota la línia. Instead, do reemplaçar només el token `[[query` en l'array inline i inserir `[[target]]` (afegint espai si el següent caràcter és alfanumèric).
- **Hardening de rang brackets:** Note: Do not fer reemplaços via `editor.updateBlock(... string ...)` per substituir `[[query` o variants amb claudàtors parcials (`[`, `[[`, `[[[`), perquè pot deixar claudàtors residuals i desalinear text en línies mixtes (bullet + markdown link + wikilink). Instead, do calcular rang expandit de claudàtors al `plainText` i aplicar només `editor.updateBlock(... inlineArray ...)` amb node `type: 'text'` per al token substituït.
- **Query amb sufix accidental:** Note: Do not tractar `replaceQuery` complet quan conté espais (p. ex. `Pla y final`), perquè el menú pot crear/enllaçar objectius equivocats i menjar text que era sufix de la frase. Instead, do normalitzar el query al primer token (`split(/\\s+/)[0]`) tant al menú de suggeriments com a `insertWikiLink`.
- **Fail-safe durant reemplaç actiu:** Note: Do not usar `insertInlineContent` com fallback quan hi ha `replaceQuery`/token pendent i ha fallat el càlcul de rang, perquè pot duplicar fragments o corrompre la línia mentre el suggestion menu resol. Instead, do no mutar el bloc en aquest branch (fail-safe) i només aplicar reemplaç per rang inline quan hi ha match vàlid.
- **Verificació de persistència:** Note: Do not validar el resultat només amb una lectura immediata d'API just després d'inserir un wikilink, perquè l'autosave va amb debounce i pot retornar estat antic temporalment. Instead, do comprovar UI + reconsultar API passats uns instants fins veure l'estat estable.

## 6. Protocols de Verificació
- Validar visualment el menú de suggeriments.
- Validar que el graf es mou segons les noves connexions.
- Validar que `A -> B` mostra B a `Enllaça a` i A a `Enllaçat per`.
- Validar que els backlinks funcionen tant amb wikilinks (`[[...]]`) com amb markdown links (`[text](/vault/page/...)`).
- Validar que `Mencions sense enllaç` detecta coincidències reals i que `Enllaçar` crea links interns sense duplicar links existents.
- Validar que `[[Nota#^bloc]]` i `![[Nota#^bloc]]` es poden seleccionar i visualitzar amb preview coherent.
