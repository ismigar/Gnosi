---
status: implemented
last_verified: 2026-08-02
source_paths:
  - backend/models/management.py
  - backend/config/app_config.py
  - backend/services/context_vars.py
  - backend/services/workspace_service.py
tests: []
---

# Terminologia

| Terme | Significat en enginyeria |
| --- | --- |
| Vault | Directori els fitxers Markdown i recursos del qual formen un espai de coneixement. |
| Pàgina | Document Markdown amb frontmatter YAML i un `id` estable. |
| Base de dades o taula | Vista estructurada sobre pàgines, normalment limitada a una carpeta i un esquema, en lloc d'una taula SQL separada. |
| Vista | Projecció desada d'una base de dades: tipus, filtres, ordenació, agrupació, camps i estat de disposició. |
| Registre | Metadades gestionades per Gnosi que descriuen bases de dades, vistes, esquemes o catàlegs. |
| Metadades auxiliars | Dades internes de `.gnosi` associades al contingut però separades intencionadament dels camps Markdown escrits per l'usuari. |
| Base de dades de gestió | Estat SQLite exclusivament local per a identitats, espais de treball, pertinences, accés al vault, tokens i enllaços compartits. |
| Dades locals | Bases de dades, memòries cau, índexs, secrets, registres, sortides i punts de control de cada instància. No s'han de sincronitzar al núvol. |
| Mode personal | Mode predeterminat d'un sol usuari que omet l'autenticació, tret que s'exigeixi explícitament. |
| Mode d'organització | Mode autenticat amb pertinença a espais de treball i rols ordenats. |
| Espai de treball | Límit administratiu que agrupa membres i vaults registrats. |
| Habilitat d'execució | Capacitat documentada de l'aplicació a `pipeline/skills/`; no és un complement d'un agent de desenvolupament. |
| Eina | Operació invocable disponible per a un agent, possiblement descoberta via MCP o generada localment. |
| MCP | Model Context Protocol, utilitzat per descobrir i invocar eines externes d'agent. |
| Directiva | Memòria d'enginyeria que descriu un procediment, decisió, incident, restricció o pla d'implementació. |
| Referència generada | Documentació determinista derivada del codi actual sense importar l'entorn d'execució. |
| Font de veritat | Dades la pèrdua de les quals no es pot reparar a partir d'una altra representació autoritativa. |
| Dades derivades | Memòria cau o índex que es pot reconstruir a partir d'una font de veritat. |
| Proveïdor de fitxers | Adaptador del comportament del sistema de fitxers local o del núvol, com ara la hidratació i les comprovacions de disponibilitat. |
| Servidor de traducció | Servei auxiliar de Zotero que converteix pàgines web i identificadors en metadades bibliogràfiques normalitzades. |
| PAT | Personal Access Token; la base de dades de gestió només en desa el hash i el prefix visible. |

## Límit dels canvis de nom

Identificadors històrics com `vault`, `DIGITAL_BRAIN_VAULT_PATH` i algunes
claus d'integració antigues amb prefix Temenos continuen sent contractes de
compatibilitat. El llenguatge públic del producte utilitza Gnosi i Knowledge
on les migracions han finalitzat. No es canvien identificadors només per
uniformitzar la terminologia de la documentació.
