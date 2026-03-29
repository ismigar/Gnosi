# Directiva: Neteja de Vistes Duplicades al Vault

## Context
A vegades, durant proves de layout o errors de sincronització, una taula pot aparèixer amb múltiples instàncies de la mateixa vista ("Taula Principal"). Aquestes s'han de netejar programàticament per mantenir la integritat de la UI.

## Procediment d'Identificació (CRÍTIC)
Abans de qualsevol acció, cal assegurar l'ID correcte de la taula:
1.  **NO utilitzar l'ID de la llista de bases de dades principal** sense comprovar abans la UI.
2.  **Inspeccionar el DOM** de la pestanya seleccionada per obtenir el `table_id` real.
3.  **Filtrar el registre** de l'API (`/api/vault/registry`) per aquest `table_id` i obtenir els IDs de les vistes.

## Procediment de Neteja
1.  **Identificar la Vista Principal**: Normalment la més antiga (la primera que surt al registre).
2.  **No esborrar la vista 'default'** (per IDs que siguin literalment "default" o el primer de la sèrie si no hi ha ID default).
3.  **Scripts de Sandbox**: Utilitzar scripts de Python al directori `pipeline/sandbox` per fer crides `DELETE` seqüencials a `http://localhost:5002/api/vault/views/{view_id}`.

## Restriccions i Riscos
- **Advertència**: L'esborrat de vistes és irreversible (només de la configuració visual, no de les dades).
- **Risc**: Esborrar vistes personals d'Ismael que sí tinguin configuració. Confirmar sempre que el nom sigui idèntic o que l'usuari hagi demanat neteja de "prova".
