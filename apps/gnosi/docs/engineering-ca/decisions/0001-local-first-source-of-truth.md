---
status: implemented
last_verified: 2026-08-02
source_paths:
  - backend/api/vault_routes.py
  - backend/config/paths_config.py
  - backend/data/management_db.py
tests:
  - backend/tests/test_safe_io.py
  - backend/tests/test_e2e_etag_concurrency.py
---

# DR 0001: Markdown Vult com a font de coneixement de la veritat

- Estat: Acceptat
- Data de decisió: 2026- 08- 02 (formada de l' arquitectura existent)

## Context

El Gnosi necessita edició estructurada, cerca, gràfica traversal, col· laboració, i automatització mentre es preserva el propietari de l' usuari i la interoperabilitat. Fent una base de dades d' aplicacions l' única representació crearia un bloqueig i faria còpia de seguretat normal de fitxers, sincronització i edició externa.

## DecisióStencils

El coneixement d' usuari es desa com a Markdown, YALM davant de la matèria, i els actius dins d' una consola controlada per l' usuari. Les bases de dades relacionals emmagatzemen l' aplicació que no és la representació del coneixement autor. Els índexs i la memòria cau derivats del contingut de laulta es poden reconstruir.

## Consseqüències

- Els fitxers segueixen inspeccionats i portàtils sense el Gnosi.
- Les escrius requereixen la atòmica, l'EPags, la normalització de la identitat i la refrescació d' índex.
- Els editors externs i proveïdors de núvol introdueixen una gran part de la capacitat i disponibilitat
Errors que els serveis han de tolerar.
- Les vistes a l' estil de la base de dades són projeccions sobre fitxers, així que s' escriuen avaluació i
La consistència de registre són responsabilitats de l' aplicació.
- SQLite i secrets segueixen sols locals perquè tenen diferents opcions
i la sincronització semàntica.

## alternatives rebutjades

- SQL com a únic visor de coneixement: transaccions més fortes però pèrdua de portable
propietat del fitxer.
- Núvol SaaS com a font obligatori: col·laboració més fàcil descentralitzada però
incompatible amb la primera sobirania local.
- Tractant el SQLite sincronitzat com a magatzem portàtil: insegur perquè la sincronització de fitxers
No proporciona el bloqueig de bases de dades o replicació atòmica.

## impact de verificació

Prova els viatges de cobertura, escriu atòmics, conflictes ETag, identificador i comportament d' enllaç, índex reconstrueix, contenidor de ruta, fracassos del proveïdor i l'aïllament de dades locals.
