# Directiva: GNOSI_INDEPENDENCE_REBRANDING

> ID: 2026-04-07
> Associated Script: N/A (Manual Refactor)
> Last Update: 2026-04-07
> Status: ACTIVE

---

## 1. Objectius i Abast

Aquesta directiva estableix el marc de referència per a la transició de Gnosi de ser un visualitzador de Notion a una aplicació totalment independent.

- **Objectiu Principal:** Eliminar totes les referències actives a Notion en interfícies, comunicacions i lògica de negoci que no estiguin estrictament relacionades amb la migració de dades històriques.
- **Criteris d'Èxit:** Tota menció de "Notion" en READMEs principals, interfícies d'usuari i noms de components actius ha de ser substituïda per "Gnosi" o "Vault".

## 2. Especificacions d'I/O

### Inputs
- Codi font de `monorepo/apps/gnosi` i `temenos`.
- Directives acadèmiques a `docs/dev_memory/directives/`.

### Outputs
- Codi refactoritzat i documentació actualitzada.

## 3. Flux Lògic (Algoritme)

1. **Categorització:** Separar referències en:
    - *Identitat:* Noms de projecte, logos, títols de pàgina. -> **CANVIAR**
    - *Estructura de Dades:* Variables que emmagatzemen info de Gnosi però es diuen `notion_X`. -> **CANVIAR**
    - *Integració:* Funcions de migració, scripts d'importació. -> **MANTENIR** (però clarificar).
2. **Rebranding Documental:** Començar pels READMEs i directives per establir la nova veritat.
3. **Refactorització de Codi:** Substituir de manera segura les variables i comentaris.
4. **Verificació de Build:** Assegurar que el canvi de variables no trenca integracions.

## 4. Eines i Llibreries
- `grep` i `sed` per a cerques i substitucions massives (amb precaució).
- `IDE Refactoring tools` per assegurar la integritat de les referències en Python i JavaScript.

## 5. Restriccions i Casos de Cantonada

- **Migració:** NO s'han de rebatejar les classes o mètodes que realment parlen amb l'API de Notion (`notion_api.py`).
- **Secrets:** Les variables d'entorn a `.env_shared` que contenen tokens de Notion han de mantenir el seu nom fins que es disposi d'una alternativa (si n'hi ha).

## 6. Protocols de l'Observador (Antigravity)

- Sempre que es trobi una nova menció de Notion, s'ha de preguntar si és "Identitat" o "Integració".
- Si es canvia un nom de component a React, s'ha de verificar la importació en tots els fitxers afectats.

## 7. Exemples d'Ús

```bash
# Exemple de cerca de mencions pendents
grep -r "Notion" . --exclude-dir=node_modules
```
