---
status: implemented
last_verified: 2026-08-02
source_paths:
  - pipeline/skills/technical_documentation/SKILL.md
  - pipeline/skills/technical_documentation/domains.json
  - pipeline/skills/technical_documentation/scripts/generate.py
  - mkdocs.yml
tests:
  - pipeline/skills/technical_documentation/tests
---

# Manteniment de documentació

## S' ha obert el contingut en contra de l' generat

Les pàgines que s' expliquen atentament, límits, fluxos, invariants, comportaments de fallada, seguretat, operacions i verificació. Les pàgines Generades enumerades fets que es poden extreure de manera fiable: mòduls, rutes de ruta, referències d' entorn, rutes de frontal, rutes d' exportació, proves i paquets d'habilitats en temps.

No poseu reclamacions arquitectòniques només en el generador basant- vos en noms. No autoclogueu manualment una taula API de 400 operacions en una guia revisada.

## Desbordament estàndard de treball

Des de `monorepo/apps/gnosi/`:

```bash
python pipeline/skills/technical_documentation/scripts/generate.py
python pipeline/skills/technical_documentation/scripts/generate.py --check
python pipeline/skills/technical_documentation/scripts/validate.py
mkdocs build --strict
```

Llavors serveix o obre `site/engineering`, navegar per les pàgines canviades, inspeccionar taules i diagrames, i verificar la consola del navegador.

## Accés públic

El portal canònica es publica a `https://gnosi.temenosismael.org/engineering/`. Les exportacions privades monorepo `monorepo/` fins a l'arrel del públic `ismigar/Gnosi` repositori. `monorepo/.github/workflows/documentation-pages.yml` la font del públic `.github/workflows/documentation-pages.yml` Desembarca el flux de treball.

Per a cada pressió rellevant al públic `main` branca, el flux de treball verifica els catàlegs generats, validant la traçabilitat, construir emkDocs en mode estricte i publicarà el complet `apps/gnosi/site/` Arbre a través de les pàgines de GitHub. Publicant el pare `site/` El directori conserva el `/engineering/` segment d' URL.

Els enllaços de la barra lateral global de Gnosi a la mateixa adreça canònica. L' etiqueta es troba en català, anglès, espanyol i francès i el portal obre fora de l' arbre de rutes de l' aplicació.

## metadata de la pàgina

Cada pàgina Remarcada declara:

```yaml
status: implemented
last_verified: YYYY-MM-DD
source_paths:
  - backend/path/to/source.py
tests:
  - backend/tests/test_behavior.py
```

Els estats permesos són `implemented`, `partial`, `experimental`, `planned`, i `deprecated`. Una pàgina marcada `implemented` Ha de descriure el comportament actual. El disseny planejat no ha d' aparèixer sota una capçalera implementada.

## cobertura de domini

`domains.json` és el mapa de responsabilitats encastat. Cada entrada enllaça una guia de domini per als glops, els glops, les directives de prova i rellevants. Generades informes de cobertura `covered` Només quan existeixen les guies i les fonts revisades. Les proves Zero són visibles i requereixen una decisió de prova deliberada.

## Què requereix una actualització

- Una nova ruta o eliminada, pàgina del navegador, model, nom de configuració o temps d' execució
habilitat: regenera catàlegs.
- Un canvi envari, límit de confiança, cicle de vida o propietari d' emmagatzematge: actualitza el
Guia d'arquitectura/ domini.
- Un nou proveïdor o dependència de desplegament: actualitza les pàgines de domini i operacions.
- Una nova fallada o restricció de recuperació: actualitza primer la directiva,
Ascendir coneixement estable al portal.
- Una decisió arquitectònica: afegeix-hi un DR.

## Validació anti-drift

Les comprovacions validadors generades, les metadades, els camins font/test, els enllaços interns, les guies de domini necessàries, rutes locals i el material secret obvi. `generate.py --check` Compara independentment la sortida compensida a l' arbre actual. El mode MkDocs valida la navegació i els enllaços de documentació.

Aquests controls no poden provar la semàntica prose. Els clients han de comparar amb la font i les proves enllaçades.
