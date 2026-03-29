# Directiva: Neteja Segura del Vault de Gnosi

Aquesta directiva estableix el procediment per a l'eliminació total de contingut (pàgines) del Vault de Gnosi a petició de l'usuari.

## Protocol d'Operació

### 1. Dosímetre de Seguretat (Backup)
* **Obligatori**: Abans de qualsevol eliminació massiva, s'ha de crear un backup comprimit del directori del Vault.
* **Ubicació**: El backup s'ha de guardar a `monorepo/apps/gnosi/pipeline/sandbox/backups/`.

### 2. Definició de "Pàgines"
* En el context de Gnosi Vault, les "pàgines" són fitxers `.md` situats a l'arrel del directori del Vault.
* Aquests fitxers contenen tant la metadata del sistema com el contingut Markdown.

### 3. Procediment d'Execució
1. Identificar el camí del Vault mitjançant `config/paths_config.py`.
2. Crear un directori de backups si no existeix.
3. Comprimir tot el contingut del Vault en un fitxer `.zip` o `.tar.gz`.
4. Eliminar TOTS els fitxers `.md` del directori del Vault.
5. **Nota**: El fitxer `vault_db_registry.json` s'ha de mantenir si l'usuari només demana eliminar "pàgines", ja que defineix l'estructura de les taules. Si demana eliminar-ho TOT, també s'ha de buidar el registre.

### 4. Verificació
* Confirmar l'absència de fitxers `.md`.
* Verificar que la UI de l'App (Vault) apareix buida però amb les taules existents.

## Restriccions i Riscos
* **Risc de Perda de Dades**: Aquesta acció és irreversible sense el backup.
* **Consistència**: No s'han d'eliminar fitxers que no siguin `.md` a menys que es demani explícitament.
