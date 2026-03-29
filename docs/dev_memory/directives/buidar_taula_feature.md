# Directiva: Buidar Taula (Empty Table)

## Objectiu
Afegir una funció al sistema per poder eliminar completament i físicament tots els registres associats a una taula ("Trunacte" o "Buidar Taula"). Aquesta acció es dispara des del menú contextual de les taules a la barra lateral de Gnosi.

## Context i Problema
Actualment hi ha un botó de "Eliminar" a les taules que elimina la definició de la taula (la taula en si mateixa). De vegades, els usuaris necessiten mantenir l'estructura de la taula però esborrar-ne tots els continguts (per exemple, per netejar registres buits "Nou" acumulats per cancel·lacions). No existia cap endpoint per fer-ho fàcilment.

## Solució implementada

1.  **Endpoint API:** `DELETE /api/vault/tables/{table_id}/records`
    Aquest endpoint localitza tots els arxius Markdown (`.md`) l'ID de taula dels quals coincideix amb el `table_id` proporcionat (siguin `resolved_table_id` o `metadata.table_id`).
    *Regla important:* Abans d'esborrar el fitxer Markdown, l'endpoint **ha d'invocar a `_delete_asset_files_for_page(page.metadata, table, registry)`** per assegurar-se que els adjunts/imatges d'aquella pàgina també es destrueixen del directori `Assets/`.
    
2.  **UI - Menú Contextual (`VaultSidebar.jsx`):**
    *   S'afegeix un nou botó "Buidar taula" amb la icona adequada (ex. un escombra o escombraries amb avís).
    *   S'associa al `ConfirmModal` amb un tipus específic `truncate_table` i text d'avís corresponent que clarifiqui que és una acció destructiva sense retorn.

3.  **UI - Gestió (`VaultDashboard.jsx`):**
    *   S'afegeix la prop `onTruncateTable` que invoca `axios.delete(...)` al nou endpoint.
    *   Un cop l'endpoint retorna succés (200), **sempre** s'ha de forçar a fer un `fetchRegistry()` i un `fetchPagesByTable(tableId)` per mantenir la sincronia visual i que els registres desapareguin en temps real.

## Restrictions / Edge Cases
*   **Precaució:** Aquesta operació és destructiva. Mai cridar sense el component `ConfirmModal`.
*   **Assets:** No n'hi ha prou amb fer un `rm ` o `unlink()` del `.md`. Cal netejar l'asset, altrament `Assets/` creixerà indefinidament. Aquesta part ha estat implementada emprant funcions ja existents al servei.
*   **Aïllament:** Assegurar-se que l'endpoint itera exclusivament sobre notes on el target correcte coincideix amb el ID de la taula forçada per no tocar registres d'altres sub-sistemes.
