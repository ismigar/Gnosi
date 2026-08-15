---
status: implemented
last_verified: 2026-08-02
source_paths:
  - mkdocs.yml
  - pipeline/skills/technical_documentation/SKILL.md
  - pipeline/skills/technical_documentation/scripts/generate.py
tests:
  - pipeline/skills/technical_documentation/tests
---

# ADR 0002: Documentació revisada més codi font generada

- Estat: Acceptat
- Data de decisió: 2026- 08- 02

## Context

El Gnosi té centenars de mòduls de dorsal i la memòria d' implementació extensa. Un únic fitxer d' arquitectura no pot enumerar l' API actual, la configuració, els components, proves i les habilitats sense derivar. Absolutament generats seria conversiu però no es pot explicar la intenció i es arriscaria a convertir noms en falses reclamacions.

## DecisióStencils

Mantingueu un portal d' enginyeria MkDocs en l' arbre d' aplicacions autoritives. Les pàgines amb un propòsit, arquitectura, comportament de domini, seguretat, operacions i decisions. Un generador de catàlegs estàndard determinants de la font. Les pàgines generades es comprometen i es comproven en CI.

El generador fa una inspecció estàtica i mai importa l'aplicació o llegeix la configuració local/secs.

## Consseqüències

- Els motors poden navegar des de la intenció fins a la font i les proves exactes.
- diffs generats revelen els canvis de superfície durant la revisió.
- El propietari del domini encara està implicat `domains.json`.
- Els clients encara confirmen prosse semàntics; l' automulació de comprovacions, no
Correctes d'explicacions humanes.
- Eines de documentació usen un fitxer de requeriments aïllats i no perturb el
s' està executant la dependència ML.

## alternatives rebutjades

- Un manual monolità: una pobra navegació, conflictes de revisió, i una ràpida deriva.
- Multites de Doc sol: insuficient per a fluxos de components creuats i operatives
Les decisions.
- S' està executant la importació de l' execució ràpidaAPI per a cada document construït: efectes secundaris, màquina
Dependències, càrrega secreta i inicialització de la base de dades.
- No s' ha pogut comprometre la sortida generada: els canvis es tornen invisibles en la revisió del codi.

## impact de verificació

El CI executa proves generadors d' unitats, comprovació de sortida ratch, validació del portal i esterros estrictes de l' execució. Navegador QA verifica el portal mostrat i els diagrames de Mermaides.
