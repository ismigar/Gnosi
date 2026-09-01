---
status: implemented
last_verified: 2026-08-28
source_paths:
  - backend/server.py
  - backend/app/lifespan.py
  - backend/config/app_config.py
  - backend/config/env_config.py
  - backend/config/paths_config.py
  - backend/domains/configuration/api/settings.py
  - backend/domains/configuration/plugin_state.py
  - backend/mcp/http_client.py
  - backend/services/data_dir_migration.py
  - backend/utils/cache.py
  - backend/api/system_routes.py
  - frontend/src/app
  - frontend/src/shared
  - frontend/src/generated
  - frontend/feature-public-entries.json
tests:
  - frontend/src/app/composition.contract.test.ts
  - frontend/src/app/shellPages.test.tsx
  - backend/tests/test_app_lifespan.py
  - backend/tests/test_app_config_resolution.py
  - backend/tests/test_app_config_language.py
  - backend/tests/test_config_language_locale.py
  - backend/tests/test_host_helper_url.py
  - backend/tests/test_data_dir_migration.py
  - backend/tests/test_system_filesystem_routes.py
  - tests/e2e/tests/anon/smoke.spec.ts
---

# Base de la plataforma i entorn d'execució

## Responsabilitat

La base de la plataforma reuneix tots els dominis en un procés, resol la
configuració i les rutes portables, gestiona l'arrencada i l'aturada, aplica
middleware compartit i exposa l'estructura principal del frontend. Ha de
continuar sent utilitzable encara que faltin integracions opcionals.

El directori `app` del frontend gestiona l'arrencada, els proveïdors, la
composició de rutes i la pantalla d'inici de càrrega immediata. Les pantalles
opcionals dels dominis entren per mòduls públics de funcionalitat amb imports
diferits independents. Els contractes de composició preserven les 32 rutes,
els controls de permisos, l'ordre dels proveïdors i els vint imports diferits.

## Composició del backend

`backend/server.py` construeix la instància FastAPI, el middleware, la gestió
d'excepcions, el muntatge estàtic del lector, el cicle de vida i els encaminadors.
L'ordre dels encaminadors és explícit perquè el context d'espai de treball i
els prefixos amplis es poden solapar. El [catàleg d'API](../generated/api-catalog.md)
generat recull cada muntatge i ruta estàtics. El registre de composició importa
directament cada encaminador canònic de domini; les façanes API antigues només
es mantenen per compatibilitat d'imports. Les anotacions de les rutes han de
preservar la representació OpenAPI congelada; els gestors sense model de resposta
explícit conserven el contracte de resposta inferit.

L'arrencada del cicle de vida fa els tipus de feina següents:

El mòdul de cicle de vida manté el gestor de context públic `lifespan` com un orquestrador lineal. Funcions
acotades gestionen connectors, agent, índexs, reparació de taules, correu i
aturada, sense alterar l'ordre ni l'aïllament d'errors.

La reconciliació inicial de connectors és independent del transport: pot llegir
l'estat normalitzat de cada vault, desat atòmicament, abans d'importar cap mòdul
de rutes HTTP. Això desacobla la construcció d'Agent de l'ordre d'inicialització
de la façana de Vault, mentre que l'arrencada normal convergeix en el mateix
magatzem d'estat compartit per tot el procés.

1. Comprovar que un desplegament exposat no utilitza un secret JWT públic de desenvolupament.
2. Iniciar el planificador i el manteniment de retenció de confirmacions.
3. Reconciliar les contribucions dels connectors abans de construir les capacitats d'agent.
4. Connectar clients MCP, descobrir eines i compilar el graf d'agent predeterminat.
5. Precarregar síncronament els índexs de vault desats i actualitzar-los després
   en segon pla quan la política del proveïdor de fitxers ho permeti.
6. Carregar les memòries cau derivades abans que cap desament les pugui truncar.
7. Iniciar els processos IMAP IDLE de cada compte.

Els errors d'arrencada opcional d'IA o integracions es registren i s'aïllen.
Els errors de seguretat o d'inicialització de dades bàsiques no es presenten
silenciosament com un funcionament correcte.

Les memòries cau compartides del procés utilitzen una única implementació
TTL/LRU acotada i protegida amb bloqueig, i accepten factories de valors
explícitament tipades sense arguments. El transport HTTP de MCP en streaming
restringeix cada payload SSE descodificat a un objecte JSON abans de retornar-lo
al client JSON-RPC; els esdeveniments malformats o que no són objectes no entren
a l'entorn d'execució tipat.

## Fusió de configuració

`load_params()` combina el YAML versionat de l'aplicació amb la configuració
de l'usuari actual o del vault actiu. Els diccionaris es fusionen recursivament.
El fitxer `.gnosi/params.yaml` del vault actiu és la destinació de persistència
de la seva configuració. La resolució de rutes aplica després els valors
explícits de l'entorn de desplegament.

La configuració d'IA amb credencials desa referències. Una credencial d'entorn
antiga pot crear un proveïdor una vegada, però una marca de desconnexió desada
impedeix que reaparegui després d'eliminar-lo deliberadament.

La frontera d'escriptura de Configuració valida agents gestionats i estratègies
de model, desa contrasenyes i claus fora del YAML, tracta el mapa de proveïdors
com a estat desitjat perquè les eliminacions persisteixin, escriu de manera
atòmica i invalida els agents compilats només després d'un canvi d'IA.

La migració de dades locals és una màquina d'estats amb diari. La verificació
de l'origen, el moviment atòmic al mateix volum, l'staging entre volums, la
verificació del destí i el rollback automàtic són fases separades. Cada base
SQLite passa un checkpoint i una comprovació d'integritat, i les còpies es comparen amb un
inventari amb hash abans de substituir una estructura buida.

Les rutes del sistema separen l'orquestració HTTP dels ajudants acotats de
navegació i cerca. La cerca prioritza el vault actiu i les carpetes habituals,
inclosa l'arrel neutral `Library/CloudStorage` que fan servir OneDrive, Google
Drive, Dropbox, Box i altres proveïdors de fitxers de macOS. Els camins locals i
Docker es mapen sense incorporar cap proveïdor al model de dades.

## Estructura principal del frontend

`app/App.tsx` espera la inicialització de l'autenticació abans de seleccionar
la compartició pública, l'inici de sessió o l'estructura de l'aplicació. Les
pàgines pesants es carreguen sota demanda. L'estructura global gestiona la
navegació i les interaccions disponibles arreu; les pàgines de ruta gestionen
el contingut de cada domini. Per disseny, `/s/:token` es renderitza fora de
l'estructura autenticada.

## Invariants

- El port `5002` és el contracte del backend; `5173`, el del frontend.
- El codi de l'aplicació utilitza l'arbre canònic `Gnosi/`.
- Les cadenes visibles del frontend utilitzen tots els catàlegs d'idioma.
- La generació de documentació no ha d'importar l'entorn d'execució.
- Les ordres operatives puntuals resideixen a `scripts/`; els paquets de
  producció no contenen sincronitzadors provisionals, sondes que modifiquin
  dades ni scripts de reparació amb dades de màquina fixades al codi.
- Un vault no disponible es representa explícitament; una ruta temporal segura
  pot evitar errors d'importació, però no s'ha de presentar com a contingut configurat.
- La preparació de memòries cau derivades no pot retardar la primera resposta
  útil si existeix una instantània segura al disc.

## Diagnòstic de fallades

Comproveu qui gestiona el procés, `/api/health`, `/api/config` i
`/api/vault/pages`, en aquest ordre. Una resposta de salut correcta amb una
petició de vault buida o fallida indica un problema de configuració o de
proveïdor de fitxers, no un servidor aturat. Consulteu la
[guia d'operacions](../operations/runbook.md).
