# Directiva: Millores de la Interfície de Vault

Aquesta directiva descriu els canvis necessaris per millorar l'experiència d'usuari (UI/UX) al Vault de Gnosi, seguint el feedback de l'usuari sobre la disposició dels elements, la cerca i la gestió de vistes.

## Objectius

1.  **Simplificació de la Capçalera (Àrea Vermella):**
    *   Eliminar el títol petit que apareix sota les pestanyes de documents.
    *   Eliminar la separació visual (bordes/espais) innecessària entre la pestanya activa i l'espai de treball.

2.  **Optimització de la Cerca (Àrea Groga):**
    *   Moure el camp de cerca a la dreta de la barra d'eines.
    *   Implementar-lo com un botó (icona de lupa) que, en fer clic, desplega el formulari de cerca cap a l'esquerra.

3.  **Gestió de Vistes com a Pestanyes:**
    *   Moure el llistat de vistes (Taula, Galeria, etc.) a la dreta de la interfície.
    *   Mostrar les vistes com a pestanyes horitzontals amb un botó "+" per afegir-ne de noves.

## Protocols d'Implementació

### 1. Neteja de `VaultDashboard.jsx`
*   Localitzar la funció `renderEditor`.
*   Dins de la condició `if (tab.isTable)`, eliminar el `div` que renderitza el títol secundari (`table.name`).
*   Ajustar el padding/bordes per que el contingut sembli una continuació natural de la pestanya de dalt.

### 2. Redisseny de `VaultViewToolbar.jsx`
*   Substituir l'input de cerca estàtic per un component amb estat `isSearchExpanded`.
*   Posicionar el botó de cerca a la dreta, prop dels botons d'ordenació i filtres.
*   Quan `isSearchExpanded` sigui cert, mostrar l'input ocupant l'espai necessari cap a l'esquerra.

### 3. Reposicionament de `VaultViewsTabs.jsx`
*   Integrar o posicionar `VaultViewsTabs` de manera que aparegui a la dreta de la capçalera de la taula/vista.
*   Assegurar que el botó "+" estigui visible i funcional.

## Restriccions i Advertències
*   **Mantingues la Responsivitat:** El disseny desplegable de la cerca no ha de trencar la barra d'eines en pantalles petites.
*   **Idempotència de les Vistes:** En canviar de vista, l'estat de la cerca no s'ha de perdre si és possible, o bé tancar-se netament.
*   **Estètica Premium:** Gnosi ha de mantenir un aspecte net similar a Notion. Utilitza colors de la paleta `slate` i `indigo`.

## Verificació
*   Verificar visualment que la separació entre pestanyes i contingut ha desaparegut.
*   Provar que la cerca es desplega i contrau correctament.
*   Confirmar que el canvi entre vistes mitjançant les noves pestanyes a la dreta funciona sense errors.
