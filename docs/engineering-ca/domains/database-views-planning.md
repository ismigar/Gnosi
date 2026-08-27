---
status: implemented
last_verified: 2026-08-28
source_paths:
  - backend/domains/vault/tables/formula_recalculation.py
  - backend/api/vault_views_routes.py
  - backend/api/planning_routes.py
  - backend/services/planning_engine.py
  - backend/services/planning_scheduler.py
  - frontend/src/components/Vault/VaultTable.jsx
  - frontend/src/pages/ProjectPlanningPage.jsx
tests:
  - backend/tests/test_vault_formula_recalculation_domain_contract.py
  - backend/tests/test_view_snapshot.py
  - backend/tests/test_planning_engine.py
  - backend/tests/test_project_planning.py
  - tests/e2e/tests/e2e/dashboards.spec.ts
---

# Vistes de base de dades i planificació del projecte

## Model de coneixement estructurat

Una base de dades Gnosi és un esquema i una capa de vista sobre pàgines, normalment arrelada en una carpeta Vult. La pàgina del davant conté valors de registre. Les dades de registre defineix els tipus de camp, vistes de valors, fórmules, característiques, relacions, opcions, preferències i accions.

Com a mínim una vista principal és una vista invariciant. L' inici i les rutes de reparació de temps de lectura, restaurar- la quan el llegat o interrompre escriu deixar una taula sense vista vàlida.

## Visualitza canonada

```mermaid
flowchart LR
    Pages["Registres de majúscules"] --> Schema["Esquema tipusd"]
    Schema --> Derived["fórmules i característiques"]
    Derived --> Filter["Filtres amb tipus"]
    Filter --> Sort["Tipus imprimible"]
    Sort --> Group["Agrupament"]
    Group --> Projection["Camps i disposició visibles"]
    Projection --> Table["Taula / galeria / tauler / calendar / cronal"]
```

Els valors amb tipus de camp declarat han de ser comparats com el seu tipus de camp declarat. L' entrada de text només pot representar tots els valors de filtre; data, caixa de selecció, número, relació, seleccioneu i multivalor normalitzar els camps mitjançant operadors de camp compatible amb el camp.

L' avaluació derivada del camp té una ordre explícita. Les fórmules que depenen dels valors en brut que s' executen abans de que les relacions agregades i dependre de fórmules es resolin sense permetre que els cicles es repeteixin indefinidament. El dorsal i les representacions dels frontals han d' estar d' acord amb la veritat, percentatges, valors buits i identificadors d' opció.

`tables/formula_recalculation.py` serialitza per taula els canvis entre
registres. Les peticions concurrents es fusionen en una passada pendent; es
recalculen totes les files visibles i només després d'una escriptura correcta
s'actualitzen l'índex de pàgines i la memòria cau de respostes.

## Evolucionació d' esquemes i d'acordència

Les revisions d' esquema protegeixen un client per a desar una llista de camp més antiga. Reanomenar un camp actualitzacions de filtres, tipus, fórmules, accions i referències de vista desades. Reanomenant una taula detecta col· lisions de fitxers pla abans de moure contingut.

Els Registres s' escriuen atòmiques i es refrescen després de canviar les metadades per lots. Les instantànies Cacheades són validades quan els registres d' origen o els canvis de revisió de l' esquema.

L'edició massiva de camps, la promoció de Zotero Extras i l'aplicació de
plantilles comparteixen un servei tipat de mutació de pàgines. Cada registre
comprova l'ETag opcional, refresca l'índex després d'escriure i informa de salts,
conflictes i errors sense interrompre la resta de files.

Els estats introduïts per regles d'acció es persisteixen idempotentment des del
domini de taules. Un error del registre queda al log i no fa fallar l'acció original.

## Planificació de projecte

Planificació consumeix camps de tasques estructurades i produeix una planificació autoritiva en comptes de duplicar la lògica de planificació a la IU. El motor normalitza les dependències, calendaris, restriccions, recursos, data, progrés i direcció de planificació. Calcula dates, puntuacions crítiques, avisos i assignacions de recursos.

El frontal representa els resultats i els controls d' edició. No gestiona independentment les semàntices del camí crític. Les planificacions cronitzades són claus de l' estat d' entrada rellevant i viuen en dades locals, no els registres de codi font de la càmera.

## Comportament erroni

- Les fórmules no vàlides retornen un error de camp controlat en comptes de cancel· lar la
Resposta de taula.
- Les relacions trencades romandran visibles com a valors no resolts quan sigui possible.
- Falta vistes que ubiquin una reparació de vista determinant.
- cicles de planificació, restriccions impossibles, o que produeixen calendaris que falten
Els diagnòstics i els resultats parcials, on són segurs.
- Una revisió d' esquema obsolet retorna un conflicte i requereix recàrrega/ allunyador.

## Concentrat de verificació

Prova la paritat de filtre escrita, conflictes de revisions d' esquema, camp i la taula reanomena, ordenació de fórmula/rollup, sincronització relacionada, ordenació de la instantània, accions de catàleg, restriccions de planificació, rutes crítiques, i representació del tauler E2E.
