# DIRECTIVE: IMPLEMENTACIO_ENLLAÇOS_INTERNS

> ID: 20240228_INTERNAL_LINKS
> Associated Script: N/A
> Status: ACTIVE
> Last Update: 2026-02-28

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

## 3. Flux Lògic (Algorisme)

1. **Detecció:** L'editor escolta el caràcter `[`. Si el següent és `[`, activa el menú.
2. **Filtrat:** Es filtren les notes existents per títol basant-se en el text després de `[[`.
3. **Inserció:** En confirmar, s'insereix un element de tipus "link" amb l'ID de la nota.
4. **Sincronització:** El backend analitza el Markdown i actualitza el graf amb la nova aresta.

## 4. Eines i Llibreries
- **BlockNote SDK:** Per a la gestió del menú de suggeriments.
- **FastAPI / Python (Backend):** Per al processament del graf.
- **Sigma.js / Graphology:** Per a la visualització.

## 5. Restriccions i Casos Extrems
- **Notes amb el mateix títol:** S'ha d'utilitzar l'ID (filename) per a l'enllaç real, mostrant el títol readable.
- **Notes inexistents:** Obsidian permet crear enllaços a notes que no existeixen encara. En aquesta fase, ens centrarem en enllaçar notes existents, però és un possible "future work".

## 6. Protocols de Verificació
- Validar visualment el menú de suggeriments.
- Validar que el graf es mou segons les noves connexions.
