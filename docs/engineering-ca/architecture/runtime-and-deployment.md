---
status: implemented
last_verified: 2026-08-31
source_paths:
  - scripts/runtime/run_native_dev.sh
  - scripts/runtime/run_native_frontend.sh
  - backend/config/env_config.py
  - backend/config/data_dir.py
  - frontend/vite.config.js
  - docker-compose.yml
  - compose.vaults.yml
  - Dockerfile.backend
  - Dockerfile.frontend
  - desktop/main.js
  - tests/e2e/tests/setup/auth.setup.ts
  - tests/e2e/support/auth-playwright.ts
  - tests/e2e/support/auth-state.ts
tests:
  - pipeline/tests/test_native_runtime_wrappers.py
  - backend/tests/test_env_loading.py
  - backend/tests/test_data_dir.py
  - backend/tests/test_vault_creation_membership.py
  - desktop/application-menu.test.js
  - backend/tests/test_host_helper_url.py
  - tests/e2e/tests/anon/smoke.spec.ts
---

# Execució i desplegament

La CI compartida limita la preparació de dependències Python amb `UV_CONCURRENT_DOWNLOADS=4`,
`UV_CONCURRENT_INSTALLS=2`, `UV_HTTP_TIMEOUT=120` (segons per lectura HTTP) i
`UV_HTTP_RETRIES=3`.
Aquesta política només afecta les dependències: conserva els locks congelats,
les caches aïllades per tasca i els terminis de proves i arrencada existents.
Les desconnexions dels runners continuen sent errors d’infraestructura;
aquests paràmetres no fan passar un runner desconnectat.

Aquesta pàgina recull els contractes revisats al codi en la data de verificació.
Docker és una destinació de desplegament suportada i opcional; el desenvolupament
natiu continua sent el predeterminat. Ni revisar el codi ni configurar una
destinació de publicació acredita l’acceptació per plataforma. Consulteu la
[guia d’operacions](../operations/runbook.md) per a les ordres, la preservació
de dades i el diagnòstic.

## Execució nativa

Inicieu els dos wrappers del repositori des de terminals. Els LaunchAgents de
macOS són una configuració opcional del host, no un requisit:

| Procés | Wrapper a `scripts/runtime/` | Adreça predeterminada | Recàrrega del codi |
| --- | --- | --- | --- |
| Backend | `run_native_dev.sh 5002` | `127.0.0.1:5002` | uvicorn observa `backend/`. |
| Frontend | `run_native_frontend.sh --config vite.config.js --host 127.0.0.1` | HTTP(S) `127.0.0.1:5173` | Vite recarrega el codi. |

El backend utilitza `uv run --project "$BASE" --frozen --no-sync` amb
l’entorn Python existent de l’arrel. Les úniques autoritats d’entorn i dades
són `load_env()` i `resolve_data_dir()` de Python, no un analitzador dotenv
al shell. La precedència per variable és: entorn del procés, `.env` del
repositori i fitxer compartit seleccionat explícitament amb
`GNOSI_SHARED_ENV_FILE`; no s’infereix cap `.env_shared` dels directoris pare.
El resolutor de dades selecciona `GNOSI_DATA_DIR`, després `GNOSI_LOCAL_DATA`,
després `LOCAL_DATA_DIR` i finalment el valor predeterminat de la plataforma.
El wrapper no tria un vault si no està configurat ni força OneDrive, un
proveïdor, `HOME_HOST_PATH`, una zona horària, un model o un endpoint de traducció.

El frontend estableix `COREPACK_ENABLE_NETWORK=0` i executa
`corepack pnpm --filter @gnosi/frontend dev`. L’exemple passa explícitament
la configuració de Vite i el host loopback; altrament s’aplica el host configurat
a Vite. El wrapper conserva els valors explícits de `VITE_BACKEND_HOST` i
`VITE_BACKEND_PORT` (predeterminats: `localhost` i `5002`). Vite gestiona els
seus dotenv; el wrapper deixa `VITE_FRONTEND_PORT` sense definir si no hi és,
per no ocultar-los. També conserva les etiquetes explícites del checkout i pot
avisar quan el checkout servit és un avantpassat ja integrat d’`origin/main`.

Tots dos wrappers validen els ports proporcionats entre 1 i 65535, transmeten
els arguments i propaguen les sortides. No instal·len ni sincronitzen
dependències; el gestor de paquets fixat i els entorns bloquejats ja han d’estar
preparats. La recàrrega del codi no actualitza dependències. `uv.lock` és
l’autoritat, però les seves seleccions per plataforma no acrediten la pila de
ML a tots els sistemes operatius o arquitectures.

## Autoallotjament Docker

El `docker-compose.yml` base proporciona backend, frontend i translation-server
de Zotero sense exigir rutes de vault del host ni eines privades:

| Emmagatzematge | Volum amb nom | Ruta del backend |
| --- | --- | --- |
| Estat per dispositiu | `gnosi_local_data` (clau existent) | `/data`; `GNOSI_DATA_DIR=/data` |
| Vaults | `gnosi_vaults` (nou) | `/vaults`; `GNOSI_VAULTS_ROOT=/vaults`, `DIGITAL_BRAIN_VAULT_PATH=/vaults/default` |

Conserveu el nom existent del projecte Compose i els dos volums de dades en
actualitzar; el nom del projecte determina la identitat dels volums. Un volum
nou de vaults no importa els vaults existents del host. No utilitzeu mai
`docker compose down -v` ni una purga generalitzada de volums per reparar
dependències; preserveu les bases de dades, credencials i contingut dels vaults
abans de migrar.

Els ports es publiquen a loopback per defecte: `127.0.0.1:5002` i
`127.0.0.1:5173`. `GNOSI_BIND_ADDRESS`, `GNOSI_BACKEND_PORT` i
`GNOSI_FRONTEND_PORT` controlen la publicació al host. Els ports interns
continuen sent 5002/5173; el frontend utilitza HTTP i fa de proxy del trànsit
API/WebSocket cap a `backend:5002`. Reviseu l’accés i TLS abans d’exposar una
altra adreça. Cal un `GNOSI_JWT_SECRET` privat i robust durant la interpolació
de Compose, mitjançant el shell o el `.env` local; un `env_file` del servei
no el pot proporcionar per si sol. `GNOSI_REQUIRE_AUTH=1` és explícit.

Compose llegeix opcionalment el fitxer compartit seleccionat amb
`GNOSI_SHARED_ENV_FILE` (alternativa `.env.shared.disabled`) i després el
`.env` local opcional. Els valors locals prevalen sobre els compartits;
`environment` explícit del servei preval sobre tots dos. Els valors arbitraris
del shell del host no es converteixen automàticament en variables del contenidor.
Aquests fitxers no es munten ni s’inclouen a les imatges. Compose buida
`GNOSI_SHARED_ENV_FILE` dins del backend després de carregar-ne els valors.

El translation-server de Zotero continua sent intern al port 1969.
`GNOSI_TRANSLATION_IMAGE` en selecciona la imatge; `TRANSLATION_SERVER_URL`
pren `http://translation-server:1969` només si no està definida, i conserva
un valor buit explícit. La traducció és opcional per a l’aplicació; el Compose
actual inclou el servei auxiliar sense un perfil opcional.

La sobreescriptura explícita `compose.vaults.yml` exigeix les dues rutes
existents del host: `VAULT_HOST_PATH` per al vault actiu i
`VAULTS_ROOT_HOST_PATH` per al pare. Els dos muntatges utilitzen
`create_host_path: false`. La fusió segons la destinació al contenidor
substitueix el volum `/vaults`, afegeix `/vault`, estableix
`DIGITAL_BRAIN_VAULT_PATH=/vault` i conserva `gnosi_local_data:/data`.
Les dues rutes del host es transmeten explícitament per a les accions sobre
fitxers. Les relatives es resolen des del directori del Compose base;
preferiu rutes absolutes. Aquesta sobreescriptura no migra dades ni configura
serveis auxiliars del host.

No hi ha muntatges implícits del directori personal, `.antigravity` privat,
directori de secrets, socket Docker, codi font o dependències del host.
Només la sobreescriptura explícita afegeix els seus dos muntatges de vaults.
Un CLI Docker dins la imatge del backend no proporciona accés al motor del host
sense un socket o endpoint configurat explícitament. El codi i les dependències
pertanyen a les imatges: no hi ha recàrrega del codi del host ni volums anònims
`node_modules`. Reconstruïu les imatges si canvien el codi o els fitxers de bloqueig.

La imatge del frontend fixa Node 22.22.2 i pnpm 11.19.0, instal·la amb
`--frozen-lockfile` i executa Vite al port estricte 5173. El backend exporta
`uv.lock` amb `--frozen`, instal·la el wheel fixat de Torch només per a CPU
abans dels requisits exportats i executa uvicorn sense `--reload`.
La disponibilitat del wheel i la compilació i arrencada reals són requisits
d’acceptació per plataforma. Els tests estàtics de contractes no substitueixen
la fusió real de Compose, les compilacions d’imatges, les proves bàsiques dels
contenidors ni l’acceptació per plataforma.

La prova nativa inicia Uvicorn normalment, sense un fil de traces en segon pla.
La comprovació externa `scripts/ci/wait_native_services.py` exigeix HTTP `200`
tant de `/api/health` com del frontend en el mateix cicle. Cada petició té un
màxim de dos segons, dins d'un termini monotònic de sis minuts; el pas
d'arrencada té un límit extern de set minuts. Els errors mostren l'últim
resultat de cada endpoint i conserven els dos registres. Els anuncis d'arrencada
o els identificadors dels processos embolcall no acrediten disponibilitat,
i després es continua executant la suite de proves de navegador.

## Paquets Electron

Electron gestiona el cicle de vida de l’aplicació empaquetada. Inicia el backend
Python inclòs, exposa una interfície IPC limitada mitjançant preload, obre el
renderer i gestiona l’estat de les actualitzacions manuals. El renderer se
subscriu a les actualitzacions i pot consultar-ne l’estat més recent per no
perdre esdeveniments emesos abans que React es munti.

El procés d’escriptori instal·la un menú natiu explícit en lloc del menú de
desenvolupament predeterminat d’Electron. React és la font de veritat de les
etiquetes traduïdes: quan es resol la llengua configurada, el renderer envia
un conjunt validat d’etiquetes mitjançant preload i repeteix l’intercanvi quan
canvia la llengua. Les ordres natives de configuració tornen al modal existent
de Configuració global. Els menús de producció exclouen la recàrrega i les
eines de desenvolupament.

Les finestres principals de Gnosi es gestionen independentment. Fitxer → Nova
finestra crea un altre renderer contra el mateix backend inclòs; tancar una
finestra només elimina aquella finestra, i l’activació des del Dock de macOS
recrea una finestra principal quan s’ha tancat l’última. Les ordres de menú
destinades al renderer enfoquen una finestra existent o esperen que el nou
renderer estigui disponible abans de lliurar-les.

Els jobs de candidats produeixen instal·ladors i metadades per a `electron-updater`
després que la CI compartida passi al mateix commit. Conserven un artefacte
d'Actions cinc dies, no un esborrany ni una release de GitHub. La publicació
queda desactivada fins a l'acceptació completa i la revisió d'un procés separat;
vegeu la [distribució de candidats](../domains/desktop-clients.md). Les
destinacions configurades i els contractes estàtics no acrediten una
instal·lació neta, la primera arrencada, l’actualització, la reversió, la
signatura ni la preservació de dades; cada plataforma exigeix evidència pròpia.

## Serveis auxiliars del host

Els serveis host-open poden oferir obertura de fitxers, cerca Spotlight,
selectors natius i accions de paperera. Els serveis de fitxers al núvol poden
hidratar fitxers només en línia; la recuperació de cada proveïdor correspon al
seu adaptador. Són integracions opcionals que requereixen configuració explícita,
no requisits d’arrencada portable.

Els 15 scripts històrics del runtime del host (instal·ladors, watchdogs i eines
del host), juntament amb els llançadors obsolets `run_brain.sh` i `run_prod.sh`,
s’han retirat del repositori públic. Les operacions del host pertanyen al
repositori privat `WorkspaceTools`. L’instal·lador històric
`install_native_startup.sh` atura els processos que escolten a 5002/5173 i
recarrega LaunchAgents. Una còpia preservada de `native_watchdog.sh` pot matar
processos multiprocessing amb una selecció àmplia i reiniciar mitjançant launchd;
no executeu cap dels dos com a diagnòstic genèric. Reviseu la configuració real
instal·lada i els procediments privats. Aquesta neteja del checkout no modifica,
migra ni desinstal·la els serveis instal·lats del host. Els wrappers portables
continuen sent el contracte d’arrencada nativa.

## Invariants de ports i processos

- Només un procés pot escoltar a cada adreça/port escollit; 5002/5173 són valors
  predeterminats, no un permís perquè natiu i Docker comparteixin l’escolta.
- Vite utilitza `strictPort`; passar silenciosament a un altre port és una
  fallada de QA.
- La recàrrega nativa no actualitza dependències ni versions injectades en
  arrencar; els canvis de codi dels contenidors exigeixen reconstruir la imatge.
- La QA al navegador segueix el protocol del Vite actiu. Sense certificats locals
  llegibles s’utilitza HTTP; HTTPS automàtic els utilitza,
  `VITE_DEV_HTTPS=false` força HTTP i `VITE_DEV_HTTPS=true` els exigeix.

## Comprovacions de salut i acceptació

`/api/health` informa de l’estat del procés, el mode, la política efectiva
d’autenticació i la configuració del vault. Verifiqueu `/api/config` i
`/api/vault/pages` amb una sessió autoritzada; que el procés respongui no
demostra que es pugui llegir el vault.

L’acceptació nativa ha de provar el registre real, la creació d’un workspace i
del primer vault, l’inici de sessió, `/api/auth/me`, les cookies HttpOnly i la
preparació d’autenticació de Playwright, amb arrencada i aturada netes. Al
navegador cal crear/editar una pàgina descartable, recarregar-la/reobrir-la per
verificar la persistència del títol i del cos, revisar la consola i comprovar
el tancament de sessió. La preparació exigeix `GNOSI_TEST_EMAIL` i
`GNOSI_TEST_PASSWORD` explícits d’un compte descartable existent, deriva la
identitat i la pertinença al workspace de la sessió verificada i no registra
comptes ni inventa privilegis d’administrador. `GNOSI_TEST_WORKSPACE_ID` ha de
correspondre a una pertinença; si no s’indica, n’hi ha d’haver exactament una.
`GNOSI_TEST_VAULT_ID` és opcional i no concedeix accés. Mantingueu privades les
credencials, les cookies i `GNOSI_TEST_STORAGE_STATE`.

`backend/tests/test_vault_creation_membership.py` cobreix la creació autoritzada
del primer vault, els rebutjos per autenticació/rol/workspace, el confinament
de rutes i els llistats d’organització sense registrar emmagatzematge personal.
Aquestes comprovacions acotades no acrediten tota la suite E2E, la matriu
Docker/Electron ni una publicació. El responsable de la integració fa les
comprovacions restants de navegador real, CI, SOP, generació de documentació
i acceptació per plataforma.
