# Directiva: Correcció de TypeError a GraphPage (Filtres de Camps)

## Context
S'ha detectat un error en temps d'execució (`Uncaught TypeError: Cannot read properties of undefined (reading 'name')`) a la pàgina del Graf (`GraphPage.jsx`). L'error es produeix en renderitzar els filtres de camps dinàmics quan una taula no es troba a la llista de taules disponibles (per exemple, entitats de sistema com 'wiki', 'images', etc.).

## Problema
Al component `GraphPage`, dins del bloc de filtres de camps (`visibleFields.map`), s'està intentant accedir a `table.name` directament en l'etiqueta `<h5>`, malgrat que existeix una lògica prèvia per calcular un `tableName` que gestiona els casos on `table` és `undefined`.

## Solució
1. Utilitzar la variable `tableName` (ja calculada) en lloc de `table.name` a la línia 633 (aprox.).
2. Assegurar-se que qualsevol accés a l'objecte `table` sigui segur (ús de optional chaining `?.`).

## Passos d'Execució
1. Localitzar el map de `visibleFields` a `GraphPage.jsx`.
2. Canviar `{table.name}` per `{tableName}`.
3. Verificar que no hi hagi altres accessos insegurs a `table` en aquest context.

## Verificació (QA)
1. Executar `npm run build` al directori `frontend` per assegurar que no hi ha errors de sintaxi.
2. (Opcional) Obrir el navegador a la pàgina del graf i verificar que els filtres de camps es carreguen correctament sense petar, especialment per a camps de sistema.
