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
  - scripts/check_public_pipeline.py
  - pipeline/README.md
tests:
  - pipeline/skills/technical_documentation/tests
  - pipeline/tests/test_public_pipeline.py
---

# Manteniment de documentació

## Eines públiques i privades

Gnosi és el repositori font públic canònic. La configuració de màquina, les còpies
de seguretat, les operacions de Drupal i el manteniment de vaults personals van
en un repositori privat separat. Les còpies antigues revisades es conserven amb
hashes abans de retirar-les; aquesta neteja no reescriu l'historial ni elimina
dades d'usuari o serveis instal·lats.

`pnpm check:pipeline` comprova els noms i modes de l'índex Git, inclosos els
fitxers ignorats afegits explícitament. Rebutja paquets privats coneguts, caches,
dades, fitxers d'entorn i enllaços a codi extern. Cal preparar les eliminacions
revisades a l'índex abans de validar-lo. No executa habilitats ni llegeix secrets;
no substitueix una auditoria completa de secrets o portabilitat.

Després de preparar l'índex, `pnpm typecheck:pipeline` executa mypy estricte sobre
tots els fitxers Python públics del pipeline, inclosos tests i directoris ignorats.
No exclou directoris; si no hi ha fonts o falta un fitxer, falla. CI l'executa
a més de la comprovació del backend. No executa proveïdors ni migracions.

La traducció, les notificacions, l'ajudant d'obertura de fitxers, la publicació
social i la planificació del backend mantenen els contractes existents. L'antic
orquestrador de desenvolupament no era una dependència d'aquests serveis.

## Contingut revisat i contingut generat

Les pàgines revisades expliquen la intenció, els límits, els fluxos, les invariants,
el comportament davant d'errors, la seguretat, les operacions i la verificació.
Les pàgines generades enumeren fets que es poden extreure de manera fiable:
mòduls, rutes, variables d'entorn, exportacions, proves i paquets d'habilitats.

No deduïu decisions arquitectòniques només dels noms dels fitxers. No dupliqueu
manualment una taula de 400 operacions de l'API dins d'una guia revisada.

## Flux de treball estàndard

Des de `Gnosi/`, executeu el control complet abans de preparar el canvi final
a l'índex i repetiu-lo després. La segona execució no ha de generar diferències:

```bash
uv run --group docs python pipeline/skills/technical_documentation/scripts/pre_pr.py --base-ref origin/main
```

Passos individuals de diagnòstic amb el mateix entorn Python:

```bash
python pipeline/skills/technical_documentation/scripts/generate.py
python pipeline/skills/technical_documentation/scripts/localize.py --generated-only
python pipeline/skills/technical_documentation/scripts/generate.py --check
python pipeline/skills/technical_documentation/scripts/validate.py
python pipeline/skills/technical_documentation/scripts/localize.py --check
mkdocs build --strict
mkdocs build --strict --config-file mkdocs-ca.yml
mkdocs build --strict --config-file mkdocs-es.yml
mkdocs build --strict --config-file mkdocs-fr.yml
```

Després, serviu o obriu `site/engineering`, navegueu per les pàgines modificades,
inspeccioneu les taules i els diagrames i comproveu la consola del navegador.

## Accés públic

El portal canònic es publica a `https://gnosi.temenosismael.org/engineering/`.
El repositori públic `ismigar/Gnosi` el construeix directament amb
`.github/workflows/documentation-pages.yml`; cap mirall reescriu el codi font.

Amb cada canvi rellevant enviat a la branca pública `main`, el workflow verifica
els catàlegs i les versions localitzades, valida la traçabilitat, construeix els
quatre portals MkDocs en mode estricte i publica l'arbre `site/` a GitHub Pages.
Publicar aquest directori pare conserva el segment `/engineering/` de l'URL.

La barra lateral de Gnosi enllaça amb aquesta adreça. L'etiqueta està traduïda als
quatre idiomes i el portal s'obre fora de les rutes internes de l'aplicació.

## Metadades de la pàgina

Cada pàgina Markdown revisada declara:

```yaml
status: implemented
last_verified: YYYY-MM-DD
source_paths:
  - backend/path/to/source.py
tests:
  - backend/tests/test_behavior.py
```

Els estats permesos són `implemented`, `partial`, `experimental`, `planned`
i `deprecated`. Una pàgina marcada `implemented` ha de descriure el comportament
actual, no un disseny pendent d'implementar.

## Cobertura dels dominis

`domains.json` és el mapa de responsabilitats revisat. Cada entrada relaciona
una guia amb patrons de fitxers font, patrons de proves i directives privades.
La cobertura generada només indica `covered` quan existeixen la guia i els
fitxers font corresponents. L'absència de proves es mostra explícitament i
requereix una decisió conscient.

## Què requereix una actualització

- Afegir o retirar una ruta, pantalla, model, variable de configuració o habilitat:
  regenereu els catàlegs.
- Canviar una invariant, un límit de confiança, un cicle de vida o el responsable
  de les dades: actualitzeu la guia d'arquitectura o de domini.
- Afegir un proveïdor o una dependència de desplegament: actualitzeu les guies
  de domini i d'operacions.
- Descobrir un error o una restricció de recuperació: actualitzeu primer la
  directiva i incorporeu el coneixement consolidat al portal.
- Prendre una decisió arquitectònica duradora: afegiu un ADR.

## Control d'impacte a CI

El control documental de les PR cobreix els canvis que poden alterar un límit
del sistema o un contracte operatiu: API i serveis del backend, integracions,
execució nativa i d'escriptori, desplegament, autenticació, encaminament,
proveïdors i estructura principal del frontend.

Els canvis ordinaris de components, pantalles, estils o proves no exigeixen
modificar la prosa si el contracte documentat continua sent exacte. Sí que ho
exigeixen si alteren una invariant, la seguretat, el cicle de vida, la propietat
de les dades, la recuperació o un altre fet durador del sistema.

Després del trasllat, el control protegeix `frontend/src/app/`,
`frontend/src/features/auth/`, `frontend/src/shared/auth/`,
`frontend/src/shared/routing/`, `frontend/src/shared/ui/layout/`, el proveïdor
API i els hooks d'autenticació compartits, i `frontend/feature-public-entries.json`.
Els camins sensibles antics es reconeixen en eliminacions i canvis de nom.
Els canvis només en `*.test.*`, `*.spec.*`, `__tests__/`, `tests/` i CSS
continuen exempts. Traslladar UI ordinària no la converteix en codi d'alt impacte.
Els canvis sensibles requereixen evidència documental en anglès; les versions
catalana, castellana i francesa conserven els mateixos camins tècnics.
Les fixtures històriques poden mantenir camins antics, però no s'han de presentar
com a ubicacions actuals del codi.

## Validació contra les divergències

El validador comprova avisos de generació, metadades, camins de codi i proves,
enllaços interns, guies requerides, camins absoluts locals i possibles secrets.
`generate.py --check` compara els fitxers versionats amb el codi actual.
`localize.py --check` comprova la paritat dels arbres català, castellà i francès.
MkDocs en mode estricte valida la navegació i els enllaços dels quatre portals.

Els catàlegs tradueixen determinísticament els títols i les etiquetes fixes.
Les dades extretes del codi, els identificadors i els camins es mantenen idèntics
a l'anglès. `localize.py --generated-only` els actualitza sense models ni imports
de l'aplicació. No feu servir traducció automàtica completa per regenerar catàlegs.

Aquests controls no proven que la prosa sigui correcta: cal comparar les
afirmacions amb el codi i les proves enllaçades.
