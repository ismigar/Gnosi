# SKILL: ZOTERO_DB_SYNC

## 1. Objectiu
Sincronitzar la biblioteca local de Zotero (`zotero.sqlite`) cap a una taula de base de dades SQLite personalitzada amb mapeig de camps flexible.

## Configuració i Execució

### 1. Interfície d'Usuari (Recomanat)
- Ves a **Settings** > **Zotero**.
- Tria la taula destí de la teva Vault.
- Defineix el mapeig de camps (columna de la taula vs camp de Zotero).
- Prem **Save & Reload** per guardar.
- Pots forçar la sincronització amb el botó **Sincronitzar ara**.

### 2. Fitxer de Configuració (Avançat)
Si prefereixes editar el fitxer directament:
📍 `pipeline/skills/zotero_sync/zotero_db_config.json`

Aquest fitxer conté:
- `zotero_db`: Ruta al fitxer `zotero.sqlite`.
- `target_db`: Ruta a la base de dades destí (SQLite).
- `target_table`: Nom de la taula on es guardaran les dades.
- `mapping`: Diccionari `"camp_zotero": "columna_db"`.

### 3. Execució per Línia de Comandes
```bash
python3 pipeline/skills/zotero_sync/scripts/zotero_to_db.py
```

El script realitza els següents passos:
1. Llegeix la configuració.
2. Crea una còpia temporal de Zotero per evitar bloquejos.
3. Extreu metadades, autors i tags.
4. Aplica el mapeig i fa un `INSERT OR REPLACE` a la taula destí.

## Restriccions i Seguretat
- **Unidireccional**: Les dades només van de Zotero a l'App. No editis la taula de la DB esperant que canviï Zotero.
- **Bloqueig de DB**: El script fa una còpia temporal de `zotero.sqlite` per evitar errors si Zotero està obert.
- **Ids Interns**: S'utilitza el `key` de Zotero com a clau primària per evitar duplicats.
- **Zotero Local**: Només funciona amb la base de dades local.
- **SQLite**: La base de dades destí ha de ser SQLite.
- **Tipus d'Ítems**: S'exclouen adjunts (PDFs) i notes simples de Zotero, centrant-se en els ítems bibliogràfics.

## 5. Manteniment
Si s'afegeixen nous camps a la taula de destí, cal actualitzar el diccionari `mapping` al fitxer JSON.
