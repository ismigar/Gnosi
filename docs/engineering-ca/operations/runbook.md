---
status: implemented
last_verified: 2026-08-02
source_paths:
  - sh/run_native_dev.sh
  - sh/run_native_frontend.sh
  - sh/native_watchdog.sh
  - docker-compose.yml
  - backend/config/paths_config.py
tests:
  - e2e/tests/anon/smoke.spec.ts
---

# Operacions a executar un llibre

## Línia de referència del desenvolupament nativa

El dorsal normal de la màquina executa el dorsal i el frontal a través de llançament d' agents. Abans d' iniciar un altre procés, determinar quin procés pertany cada port i inspeccionar els registres natius. No deixeu que Vite seleccioni un port alternatiu.

S' esperava punts d' acabament:

| Servei | Adreça | Comprovació vol dir agradable |
| --- | --- | --- |
| Frontal | `https://localhost:5173` | Es mostren les ordres de l' aplicació i es pot navegar. |
| Dorsal | `http://127.0.0.1:5002` | `/api/health`, `/api/config`, `/api/vault/pages`. |
| Ajudadora de recuperació OneDives | `http://127.0.0.1:5009` | Només es requereix per a les rutes d' hidratació/cuperació. |

Els canvis de codi font del dorsal es tornen a carregar automàticament. Els canvis de dependències requereixen un reinici del dorsal. Torna a carregar la font de l' agent. Cal reiniciar els valors d' inici.

## Primera seqüència de diagnòstics

1. Confirmar que hi ha exactament un escolta en cada port de l' aplicació.
2. Llegeix el dorsal i frontal natiu de registres d'errors.
3. Sol· licita `/api/health`; registre del mode efectiu i de l' estat de la volta.
4. Sol· licita `/api/config`; confirmeu la volta seleccionada sense mostrar secrets.
5. Sol· licita `/api/vault/pages`; distingir el contingut buit d' un error I/ S.
6. Torna a introduir l' acció del frontal afectada mentre es mira la consola del navegador i
Registres de dorsal.
7. Executa la prova automatització més rellevant abans de reiniciar els serveis amplis.

## S'han d'utilitzar i símptomes de fitxers en núvol

`EDEADLK` o `EAGAIN` En una petició de pàgina/ indexació indica un problema de disponibilitat del proveïdor de fitxers, no un error d' anàlisi Markdown. Comproveu les banderes de fitxer i bloceu la materialització. Hydyte el directori més petit mitjançant el mecanisme d' arranjament calent. Reoveritoriitoris seqüencialment; no martelleu un marcador de posició orfe en paral· lel.

El dorsal ha de continuar amb resultats parcials on permet el contracte. Mai deseu un escàner parcial com a índex complet. La mitigable per dispositiu és mantenir els directoris crítics descarregats localment.

## Dades locals i secrets

L'estat nadiu està sota `local_data`; l' estat de punter està en el `gnosi_local_data` volum. Abans de la migració o reinstal· lació, preservar la gestió SQLite, els secrets, el registre d' eines, els punts de comprovació quan siguin necessaris, i l' estat del sistema.

No copis l' SQLite en una volta sincronitzada o iniciïs dos escriptors contra la mateixa base de dades. S' espera reconnectar OAuth en una altra màquina perquè els secrets són intencionadament per dispositiu.

## Amarxa auto- màquina

L' amarador s' usa només quan està seleccionat deliberadament. Valida la configuració, construeix ambdues imatges, i executa la prova de fum de la salut del dorsal amb un proveïdor de fitxers local. El dorsal del dorsal crea munta els canvis de muntatge del Python; dependència o Tockerfile refau la imatge del dorsal.

El frontal utilitza un anònim `node_modules` volum. Un canvi de blocatge es pot ocultar pel volum antic; tornar a crear només el servei frontal i el seu volum anònim. Mai s' executa. `docker compose down -v` com a reparació rutinari perquè pot eliminar dades locals.

## Mapa de símptoma comú

| Symptom | Límit probablement | Següent evidència |
| --- | --- | --- |
| Interfície de pantalla blanca per al Frontal | Temps d' execució en JS, tros mort, bèl· ló de l' autenticació | Consola del navegador, registre de Vite, construcció de producció. |
| Treball de salut, seguretat falla | Configuració del camí, context, hidratació del proveïdor | `/api/config`, Registres de Vult, disponibilitat de fitxer. |
| Arranjament retorna | Objectiu de params erroni, ha fallat l' escriptura atòmica, migració heretat | Context de volta activa i font de params. |
| La integració sembla desconnectada | Manca el secret local o el punt per omissió és estable | Correspondència d'integració i directori secret local. |
| L' agent no té eines | Connexió MCP, validació del catàleg, assignació de habilitats | S'estan iniciant els registres de descobriment i punts de final de l'habilitat IA. |
| El correu atura l' actualització | Error de treballador/ compte o autorització del proveïdor | S' ha sincronitzat l' estat del recompte i la sincronització incremental. |
| L' escriptori mostra la versió antiga | El renderitzador/ servidor no s' ha reiniciat o no es manifesta de manera diferent | Frontal i versions de paquet electrònica. |

## Operacions de documentació

Executa el generador, validador i estrictes MkDocs que es construeix des de l' aplicació root. Les diferències Generades es revisen i es comprometen. La sortida del portal sota `site/engineering` és un " un ús " de la construcció " i no s' ha de comprometre.

Després d' un canvi de documentació abasta el repositori públic `main` branca, les pàgines funcionen publica el portal a `https://gnosi.temenosismael.org/engineering/`. Si el desplegament falla, comproveu les passes de referència generada i validadors abans de l' artiforme de pàgines. Confirmar que les pàgines del repositori usen accions del GitHub com a font de publicació i que la `github-pages` L'entorn permet la posició de `main`.

## Aprendre Incidient

Després de diagnosticar una nova fallada, arreglar la implementació, afegir una prova de regressió, registrar la restricció en la directiva corresponent i promoure el coneixement estable en aquest portal. Una recuperació sense papers només realitzada en un terminal no és un arranjament operatiu.
