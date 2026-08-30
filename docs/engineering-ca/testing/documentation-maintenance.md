---
status: implemented
last_verified: 2026-08-20
source_paths:
  - pipeline/skills/technical_documentation/SKILL.md
  - pipeline/skills/technical_documentation/domains.json
  - pipeline/skills/technical_documentation/scripts/check_change_impact.py
  - pipeline/skills/technical_documentation/scripts/generate.py
  - pipeline/skills/technical_documentation/scripts/localize.py
  - mkdocs.yml
  - mkdocs-ca.yml
  - mkdocs-es.yml
  - mkdocs-fr.yml
tests:
  - pipeline/skills/technical_documentation/tests
---

# Manteniment de documentació

## S' ha obert el contingut en contra de l' generat

Les pàgines que s' expliquen atentament, límits, fluxos, invariants, comportaments de fallada, seguretat, operacions i verificació. Les pàgines Generades enumerades fets que es poden extreure de manera fiable: mòduls, rutes de ruta, referències d' entorn, rutes de frontal, rutes d' exportació, proves i paquets d'habilitats en temps.

No poseu reclamacions arquitectòniques només en el generador basant- vos en noms. No autoclogueu manualment una taula API de 400 operacions en una guia revisada.

## Desbordament estàndard de treball

Des de `Gnosi/`:

```bash
python pipeline/skills/technical_documentation/scripts/generate.py
python pipeline/skills/technical_documentation/scripts/generate.py --check
python pipeline/skills/technical_documentation/scripts/validate.py
python pipeline/skills/technical_documentation/scripts/localize.py --check
mkdocs build --strict
mkdocs build --strict --config-file mkdocs-ca.yml
mkdocs build --strict --config-file mkdocs-es.yml
mkdocs build --strict --config-file mkdocs-fr.yml
```

Llavors serveix o obre `site/engineering`, navegar per les pàgines canviades, inspeccionar taules i diagrames, i verificar la consola del navegador.

## Accés públic

El portal canònica es publica a `https://gnosi.temenosismael.org/engineering/`. Les exportacions privades monorepo `monorepo/` fins a l'arrel del públic `ismigar/Gnosi` repositori. `monorepo/.github/workflows/documentation-pages.yml` la font del públic `.github/workflows/documentation-pages.yml` Desembarca el flux de treball.

Per a cada pressió rellevant al públic `main` branca, el flux de treball verifica els catàlegs generats i els miralls localitzats, validant la traçabilitat, construeix l'anglès, català, castellà i francès Mkocls en mode estricte i publica el següent `site/` Arbre a través de les pàgines de GitHub. Publicant el pare `site/` El directori conserva el `/engineering/` segment d' URL.

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

## Porta d' impacte CI

La porta de documentació de " getret- request " està instal· lada als canvis que poden alterar un límit del sistema o un contracte operatiu. Cobreix les API del dorsal i serveis, integració, codi d' escriptori i codi d' execució natiu, desplegament fitxers, i autenticació de la interfície, rout, proveïdors i codi d' aplicació-shell.

Component de la interfície de Routine, pàgina, styling, i els canvis de prova no requereixen una edició de documentació prosse quan el contracte existent queda precisió. Encara necessiten documentació quan canvien un límit invaritari, un cicle de confiança, el propietari de la vida, la restricció de fracàs o un altre fet de sistema durable.

Després del trasllat, el gate protegeix `frontend/src/app/`,
`frontend/src/features/auth/`, `frontend/src/shared/auth/`,
`frontend/src/shared/routing/`, `frontend/src/shared/ui/layout/`, el proveïdor
API i els hooks d'autenticació compartits, i `frontend/feature-public-entries.json`.
Es mantenen els camins sensibles antics per detectar eliminacions i canvis de nom.
Els canvis només en `*.test.*`, `*.spec.*`, `__tests__/`, `tests/` i CSS
continuen exempts. Traslladar UI ordinària no la converteix en codi d'alt impacte.
Els canvis sensibles continuen requerint evidència documental en anglès;
els miralls revisats en català, castellà i francès mantenen els mateixos camins tècnics.
Les fixtures sintètiques històriques poden conservar camins antics; cal afegir
regressions dels camins nous sense presentar les fixtures com a codi actual.

## Validació anti-drift

Les comprovacions validadors generades, les metadades, els camins font/test, els enllaços interns, les guies de domini necessàries, rutes locals i el material secret obvi. `generate.py --check` Compara independentment la sortida compensida a l' arbre actual. `localize.py --check` Requereix que el català, l' espanyol i la paritat francesa. El mode MkDos estricte validi la navegació i els enllaços de documentació en tots quatre portals.

Les guies registrades es troben localitzats en tots els portals. Els francesos segueixen sent els catàlegs generats per codi font canònica perquè els noms de les rutes, els identificadors de codi i les descripcions extretes són proves de referència en lloc de revisar prose; el seu portal de navegació i el seu portal circumdant romanen localitzats.

Aquests controls no poden provar la semàntica prose. Els clients han de comparar amb la font i les proves enllaçades.
