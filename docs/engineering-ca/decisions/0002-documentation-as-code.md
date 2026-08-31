---
status: implemented
last_verified: 2026-08-02
source_paths:
  - pyproject.toml
  - uv.lock
  - mkdocs.yml
  - pipeline/skills/technical_documentation/SKILL.md
  - pipeline/skills/technical_documentation/scripts/generate.py
tests:
  - pipeline/skills/technical_documentation/tests
---

# ADR 0002: Documentació revisada i referència generada del codi font

- Estat: Acceptat
- Data de decisió: 2026-08-02

## Context

Gnosi té centenars de mòduls de backend i frontend i una memòria d'implementació
extensa. Un únic fitxer d'arquitectura mantingut manualment no pot enumerar
l'API, la configuració, els components, les proves i les habilitats actuals
sense quedar desfasat. Una prosa completament generada seria exhaustiva, però
no explicaria la intenció i podria convertir noms en afirmacions falses.

## Decisió

Manteniu un únic portal d'enginyeria MkDocs a l'arbre canònic de l'aplicació.
Les pàgines revisades per persones expliquen l'objectiu, l'arquitectura, el
comportament dels dominis, la seguretat, les operacions i les decisions. Un
generador determinista basat en la biblioteca estàndard produeix els catàlegs
de codi font. Les pàgines generades es versionen i es comproven a CI.

El generador fa inspecció estàtica i mai no importa l'aplicació ni llegeix
configuració local o secrets.

## Conseqüències

- Els enginyers poden navegar des de la intenció fins al codi i les proves exactes.
- Les diferències generades mostren els canvis de les interfícies durant la revisió.
- Les responsabilitats dels dominis es continuen mantenint explícitament a `domains.json`.
- Els revisors encara han de comprovar el sentit de la prosa; l'automatització
  comprova la traçabilitat, no la correcció de les explicacions humanes.
- Les dependències de documentació utilitzen el grup opcional `docs` de
  `pyproject.toml` i el `uv.lock` compartit, no un fitxer de requisits ni un
  entorn separat. Generar catàlegs no importa la pila ML de l'aplicació.

## Alternatives rebutjades

- Un manual monolític: navegació deficient, conflictes de revisió i desfasament ràpid.
- Només docstrings: insuficients per als fluxos entre components i les decisions operatives.
- Importar FastAPI en execució per a cada compilació de documentació: efectes
  secundaris, dependències del host, càrrega de secrets i inicialització de bases de dades.
- Sortida generada sense versionar: els canvis es tornen invisibles a la revisió de codi.

## Impacte en la verificació

La CI executa proves unitàries del generador, la comprovació de sortida obsoleta,
la validació del portal i la compilació estricta de MkDocs. La QA al navegador
verifica el portal renderitzat i els diagrames Mermaid.
