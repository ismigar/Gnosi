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

# Termologia

| TermEthiopian month 8 - ShortName | El significat d' enginyeria |
| --- | --- |
| VaultCity name (optional, probably does not need a translation) | Un directori amb fitxers Markdown i actius formen un espai de coneixement. |
| Pàgina | Un document Markdown amb YAML front i un estable `id`. |
| Base de dades o taula | Una vista estructurada sobre pàgines, normalment s' abasta a una carpeta i esquema en comptes d' una taula SQL separada. |
| Visualitza | Una projecció desada d' una base de dades: tipus, filtres, ordenació, agrupament, camps i estat de disposició. |
| Registeria | Les metadades de Gnosi-maned descriuen bases de dades, vistes, esquemes o catàlegs. |
| metadata de cara a cara | Intern `.gnosi` Les dades associades amb contingut però intencionadament separades des dels camps de marca desplegables de l' usuari. |
| Base de dades de gestió | Estat SQLite local per a identitats, espais de treball, afiliació, accés de la volta, fitxes i enllaços de compartició. |
| Dades locals | Per bases de dades d' exemple, caches, índexs, secrets, registres, sortides i punts de control. No ha de ser una sincronització en núvol. |
| Mode personal | Mode d' usuari únic per omissió amb autenticació o no es requereix explícitament. |
| Mode d' organització | Mode autenticat amb l' afiliació de l' espai de treball i els rols ordenats. |
| Espai de treball | Límits administrativa que els grups i les cambres registrades. |
| habilitat d' execució | Una capacitat d' aplicació documentada a sota `pipeline/skills/`; no és un connector d' agent de desenvolupament. |
| Eina | Una operació cal· lable disponible a un agent, possiblement descobert a través de MC o generada localment. |
| MCP | Protocol de model Context, usat per descobrir i invocar eines d' agent extern. |
| Directiva | La memòria d'enginyeria descriu un procediment, decisió, incident, restricció o pla d' implementació. |
| Referència generada | La documentació determinista derivada de la font actual sense importar l' hora d' execució. |
| Font de la veritat | Les dades que no poden reparar-se d'una altra representació autoritiva. |
| Dades derivades | Memòria cau o índex que es pot reconstruir des d'una font de veritat. |
| Proveïdor de fitxers | Adaptador de sistema de fitxers local o de seguretat de núvol, com ara la hidratació i les comprovacions de disponibilitat. |
| Servidor de traducció | El dipòsit de l'art del Zotero que tradueix pàgines web i identificadors a metadades de referència normalitzades. |
| PAT | Accés personal Token, la base de dades de gestió tan sols desa la seva haixix i el prefix a mostrar. |

## Límit de l' activació

Identificadors històrics com `vault`, `DIGITAL_BRAIN_VAULT_PATH`, i algunes claus d'integració heretats de Temenos encara són contractes de compatibilitat. El llenguatge públic usa Gnosi i coneixement on les migració han finalitzat. Els identificadors no només es reanomenaven per a fer uniforme de documentació.
