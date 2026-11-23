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

# ADR 0001: El vault Markdown com a font de veritat del coneixement

- Estat: Acceptat
- Data de decisió: 2026-08-02 (formalitzada a partir de l'arquitectura existent)

## Context

Gnosi necessita edició estructurada, cerca, recorregut del graf, col·laboració
i automatització, tot preservant la propietat de l'usuari i la interoperabilitat.
Fer d'una base de dades d'aplicació l'única representació crearia dependència
del producte i relegaria les còpies de seguretat de fitxers, la sincronització
i l'edició externa a un paper secundari.

## Decisió

El coneixement de l'usuari es desa com a Markdown, frontmatter YAML i recursos
dins d'un vault controlat per l'usuari. Les bases de dades relacionals desen
estat de l'aplicació que no és la representació del coneixement escrit. Els
índexs i les memòries cau derivats del contingut del vault es poden reconstruir.

## Conseqüències

- Els fitxers continuen sent inspeccionables i portables sense Gnosi.
- Les escriptures requereixen atomicitat, ETags, normalització d'identitat i actualització dels índexs.
- Els editors externs i els proveïdors del núvol introdueixen problemes de
  concurrència i disponibilitat que els serveis han de tolerar.
- Les vistes de tipus base de dades són projeccions sobre fitxers; per tant,
  l'avaluació tipada i la coherència del registre són responsabilitat de l'aplicació.
- SQLite i els secrets es mantenen exclusivament locals perquè tenen una
  semàntica de persistència i sincronització diferent.

## Alternatives rebutjades

- SQL com a únic magatzem de coneixement: transaccions més fortes, però pèrdua
  de la propietat portable dels fitxers.
- SaaS al núvol com a font obligatòria: col·laboració centralitzada més senzilla,
  però incompatible amb la sobirania local-first.
- SQLite sincronitzat com a emmagatzematge portable: insegur perquè la
  sincronització de fitxers no proporciona bloqueig de base de dades ni replicació atòmica.

## Impacte en la verificació

Les proves cobreixen els cicles d'anada i tornada de Markdown, les escriptures
atòmiques, els conflictes ETag, el comportament d'identificadors i enllaços,
la reconstrucció d'índexs, el confinament de rutes, les fallades dels proveïdors
i l'aïllament de les dades locals.
