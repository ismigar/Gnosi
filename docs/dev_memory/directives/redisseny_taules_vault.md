# Directiva: Redisseny de la Interfície de Taules al Vault

L'objectiu és simplificar i professionalitzar la interfície de les taules, eliminant elements redundants i agrupant les vistes i accions en una única barra horitzontal sota el títol de la taula.

## SOP (Standard Operating Procedure)

1.  **Eliminació d'espais morts**: S'ha d'ajustar el padding superior del component `VaultTable` per eliminar l'espai entre les pestanyes de navegació i el contingut de cada taula.
2.  **Unificació de la Capçalera**: Es crearà un nou component `VaultViewsHeader` que centralitzi el títol, el número de registres, les pestanyes de vistes i les accions a la dreta.
3.  **Ordre de les Vistes**: S'ha de permetre que l'usuari reordeni les pestanyes de vistes arrossegant-les (Drag & Drop).
4.  **Accions a la Dreta**:
    -   **Cerca**: Icona de lupa que desplega un camp de text.
    -   **Configuració de Camps (Camps)**: Botó per obrir el formulari de camps.
    -   **Nou Registre (+ Nou)**: Botó per crear registres o triar plantilles.

## Restriccions i Casos Límit

-   **Overflow de Pestanyes**: Si hi ha més pestanyes de les que caben a l'ample, cal mostrar `...` amb un desplegable lateral.
-   **Interoperabilitat**: Les props de cerca i configuració s'han de passar correctament des del `VaultDashboard` per garantir que els canvis es reflecteixin globalment.
-   **Draggable Context**: Cal envoltar el component `SortableContext` amb el `DndContext` adequat per a la gestió d'estats de reordenació.

## Proves de Qualitat (QA)

-   Confirmar que el títol `# Taula: ...` és visible i està alineat correctament.
-   Verificar que l'input de cerca es desplega cap a l'esquerra.
-   Assegurar que les pestanyes de vista tenen el menú de 3 punts amb totes les accions (Configurar, Renombrar, Duplicar, Eliminar).
