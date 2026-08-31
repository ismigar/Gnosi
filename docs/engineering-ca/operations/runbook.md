---
status: implemented
last_verified: 2026-08-31
source_paths:
  - package.json
  - pyproject.toml
  - pnpm-workspace.yaml
  - pnpm-lock.yaml
  - uv.lock
  - scripts/runtime/run_native_dev.sh
  - scripts/runtime/run_native_frontend.sh
  - scripts/runtime/install_native_startup.sh
  - scripts/runtime/native_watchdog.sh
  - frontend/vite.config.js
  - backend/app/health_contracts.py
  - backend/config/data_dir.py
  - backend/config/env_config.py
  - backend/config/paths_config.py
  - backend/platform/files/__init__.py
  - backend/platform/files/local.py
  - backend/platform/files/on_demand.py
  - backend/platform/files/onedrive.py
  - scripts/migrate-data-dir.py
  - backend/services/data_dir_migration.py
  - docker-compose.yml
  - Dockerfile.backend
  - Dockerfile.frontend
  - desktop/package.json
  - desktop/backend-launch.js
  - desktop/build-python.sh
  - desktop/electron-builder.yml
  - .github/workflows/build-release.yml
  - .github/workflows/documentation-pages.yml
tests:
  - backend/tests/test_data_dir.py
  - backend/tests/test_env_loading.py
  - backend/tests/test_data_dir_migration.py
  - backend/tests/test_health_api_contract.py
  - backend/tests/test_files_provider.py
  - desktop/backend-launch.test.js
  - desktop/packaging-contract.test.js
  - desktop/packaging-resources.test.js
  - tests/e2e/tests/anon/smoke.spec.ts
---

# Guia d’operacions

Aquesta guia descriu els contractes revisats al codi públic. La data de
verificació correspon a aquesta revisió, no a una instal·lació, migració o
publicació validada a totes les plataformes. Les ordres següents són
instruccions per a l’operador, no evidència que s’hagin executat.

## Desenvolupament natiu com a primera opció

Executeu el backend FastAPI i el frontend Vite de manera nativa. Docker,
Electron, l’emmagatzematge al núvol i els LaunchAgents de macOS són opcionals.
Utilitzeu Python 3.11, Node 22.22.2 i pnpm 11.19.0; la CI actual i el backend
Docker fixen uv 0.9.15. Des de l’arrel del repositori, prepareu les dependències
a partir dels fitxers de bloqueig versionats:

```sh
uv sync --frozen
corepack pnpm install --frozen-lockfile
```

Inicieu el backend i el frontend en terminals separats, tots dos a l’arrel del repositori:

```sh
uv run --frozen uvicorn backend.server:app --host 127.0.0.1 --port 5002 --reload --reload-dir backend
```

```sh
corepack pnpm --filter @gnosi/frontend dev
```

Per a un vault local, configureu-ne el directori real i seleccioneu
`GNOSI_FILES_PROVIDER=local`; no cal cap servei auxiliar de descàrrega.
Distingiu el vault actiu del directori pare que conté diversos vaults.
`DIGITAL_BRAIN_VAULT_PATH` té prioritat sobre `VAULT_HOST_PATH`; aquesta
segona variable també intervé en la detecció del proveïdor. Si l’entorn no
estableix cap ruta, el backend pot utilitzar el vault seleccionat a Configuració.

| Servei | Adreça predeterminada | Comprovació |
| --- | --- | --- |
| Frontend | `http://localhost:5173` | Es mostra l’inici de sessió o la interfície de l’aplicació; la navegació funciona. |
| Backend | `http://127.0.0.1:5002` | `/api/health` i, després, peticions autoritzades de configuració i del vault. |

Vite utilitza `strictPort: true`: resoleu els conflictes de port en lloc
d’acceptar un port alternatiu. HTTPS és opcional: el mode automàtic utilitza
certificats locals llegibles; `VITE_DEV_HTTPS=false` força HTTP i
`VITE_DEV_HTTPS=true` exigeix certificats. Reinicieu Vite si canvien els
certificats. El codi es recarrega; els canvis de dependències requereixen
sincronitzar els fitxers de bloqueig i reiniciar el procés afectat. Reinicieu el
frontend per actualitzar els valors de versió injectats durant l’arrencada.

## Configuració i dades persistents

La càrrega de l’entorn del backend segueix aquest ordre per a cada variable:
entorn del procés, `.env` local del repositori i fitxer compartit seleccionat
explícitament amb `GNOSI_SHARED_ENV_FILE`. No es busca implícitament cap
`.env_shared` als directoris pare. El fitxer compartit pertany a l’operador i
la neteja de l’entorn de Gnosi no el modifica. L’emmagatzematge segur natiu pot
aportar credencials que falten; no substitueix un valor ja establert.

Després de carregar l’entorn, la resolució del directori de dades pren el primer
valor no buit en aquest ordre: `GNOSI_DATA_DIR`, `GNOSI_LOCAL_DATA`,
`LOCAL_DATA_DIR` i valor predeterminat de la plataforma. Els dos àlies estan
obsolets, però continuen admesos durant tota la sèrie 3.x. Configureu el nom
canònic de manera coherent: un valor canònic en conflicte preval sobre un àlies,
encara que l’àlies provingui d’una font d’entorn de més prioritat. Preferiu
rutes absolutes: les relatives es resolen respecte del directori de treball del procés.

| Entorn del backend | Directori de dades predeterminat si no s’ha configurat |
| --- | --- |
| macOS | `~/Library/Application Support/Gnosi` |
| Linux | `$XDG_DATA_HOME/gnosi` o, si no està definit, `~/.local/share/gnosi` |
| Windows | `%APPDATA%\Gnosi` o, si no està definit, `~/AppData/Roaming/Gnosi` |
| Docker | `/data`; Compose hi munta el volum amb nom `gnosi_local_data`. |

L’antic directori `local_data` dins del checkout no és el valor predeterminat
natiu. El contingut del vault i la configuració `.gnosi/` estan separats de
l’estat de cada dispositiu. Mantingueu `GNOSI_DATA_DIR` en emmagatzematge
local no sincronitzat, fora de l’arbre de codi. Preserveu
`system/management.sqlite`, `system/tool_registry.sqlite`,
`system/checkpoints`, `secrets` i la resta de l’estat necessari abans de
reinstal·lar o migrar. No copieu fitxers SQLite en ús a un vault sincronitzat
ni executeu instàncies independents de Gnosi sobre el mateix directori de dades.
En un altre dispositiu pot caldre tornar a connectar OAuth, perquè les
credencials i l’emmagatzematge segur són locals.

Per traslladar les dades deliberadament, reviseu
`scripts/migrate-data-dir.py`: ofereix `plan`, `migrate`, `status`,
`rollback` i `finalize`. La planificació pot crear el directori pare de
destinació; per tant, no és un diagnòstic purament de lectura. Atureu tots els
processos que escriuen abans de migrar o revertir; `--writers-stopped` és una
confirmació de l’operador, no un detector de processos. El servei registra el
progrés en un diari, comprova la integritat SQLite i consolida el WAL. Fa un
canvi de nom dins del mateix volum o una còpia provisional verificada entre
volums; en el segon cas conserva l’origen. Guardeu el diari i la còpia de
seguretat, verifiqueu la destinació i configureu `GNOSI_DATA_DIR` abans de
reiniciar. Canviar només la variable no trasllada les dades existents.

## Primera seqüència de diagnòstic

1. Identifiqueu l’entorn escollit, el checkout, el propietari del procés i qui
   escolta a cada port abans d’iniciar o reiniciar res.
2. Reviseu els registres del backend i del frontend d’aquell entorn; no
   pressuposeu les rutes dels LaunchAgents.
3. Consulteu `/api/health`: `status`, `mode`, `gnosi_mode`,
   `require_auth` i `vault_configured`. Una resposta de salut no demostra
   que el vault es pugui llegir.
4. Utilitzeu una sessió autoritzada per a `/api/config` i `/api/vault/pages`.
   Distingiu els errors d’autenticació o permisos d’un vault buit o un error
   d’E/S; oculteu credencials i rutes privades abans de compartir diagnòstics.
5. Confirmeu el vault actiu, el directori de dades efectiu i el proveïdor
   seleccionat. No restabliu la configuració ni substituïu bases de dades per
   corregir una ruta equivocada.
6. Reproduïu l’acció afectada de la interfície mentre reviseu la consola del
   navegador i els registres del backend; després executeu la prova més específica.
7. Després de la reparació, verifiqueu tant les dades retornades com l’acció
   visible; reiniciar un procés no és, per si sol, evidència de recuperació.

## Disponibilitat dels fitxers i recuperació específica del proveïdor

Comenceu per l’adaptador seleccionat a `backend/platform/files`.
`GNOSI_FILES_PROVIDER` selecciona explícitament un proveïdor reconegut; si
no, la detecció utilitza `VAULT_HOST_PATH`. `LocalProvider` no fa cap
hidratació. El nom d’un proveïdor o una interfície compartida no acrediten el
comportament de tots els clients de núvol en tots els sistemes operatius.

En emmagatzematge File Provider de macOS, `EDEADLK` o `EAGAIN` poden indicar
fitxers no disponibles que només són al núvol. Aquests errors, per si sols, no
demostren una fallada del proveïdor ni de l’analitzador Markdown: comproveu la
ruta exacta, els indicadors del fitxer, els blocs descarregats i l’estat del
client. Reintenteu l’àmbit afectat més petit amb intents limitats i seqüencials;
no convertiu una exploració de recuperació parcial en un índex complet ni
substituïu contingut il·legible per fitxers buits. Mantenir els directoris
crítics descarregats localment pot evitar que el problema es repeteixi.

L’adaptador actual de fitxers sota demanda utilitza `open` per defecte en
macOS natiu i delega les lectures a una aplicació gràfica mitjançant
LaunchServices; les lectures directes des d’un procés launchd poden no activar
la descàrrega. El mode daemon crida un servei auxiliar del host configurat,
amb els valors predeterminats `http://127.0.0.1:5009/warmup` en natiu o
`http://host.docker.internal:5009/warmup` des de Docker. Aquest servei ha
d’estar realment configurat per a l’entorn escollit; el port 5009 no és un
requisit general d’arrencada ni una prova que la hidratació funcioni amb
qualsevol núvol.

Només l’adaptador de OneDrive activa el reinici del client OneDrive després
d’un intent `open` fallit. `ONEDRIVE_AUTO_RESTART=0` desactiva aquesta
acció; l’interval mínim predeterminat entre reinicis és de 300 segons. Tracteu
els reinicis del client i la configuració dels serveis auxiliars del host com
a canvis operatius separats. No apliqueu les instruccions de recuperació de
OneDrive a altres proveïdors.

## Configuració opcional del host macOS

`scripts/runtime/install_native_startup.sh` instal·la LaunchAgents que
invoquen els scripts d’arrencada nativa. Les instal·lacions existents poden
escriure registres a `~/Library/Logs/Gnosi`; reviseu-ne la configuració real.
Són facilitats opcionals del host, no el contracte d’arrencada portable. Les
definicions de serveis específiques de cada màquina, les rutes privades i
l’historial d’incidents pertanyen al repositori privat `WorkspaceTools`,
no als requisits públics.

Reviseu `scripts/runtime/run_native_dev.sh` abans d’adoptar-lo: encara
inclou una ruta de vault OneDrive pròpia del mantenidor com a alternativa i
força `ONEDRIVE_WARMUP_MODE=open`, `TZ=Europe/Madrid` i
`TRANSLATION_SERVER_URL` buit. La seva alternativa per al directori de
dades té en compte `GNOSI_LOCAL_DATA`, però no consulta `LOCAL_DATA_DIR`
abans d’assignar `GNOSI_DATA_DIR`. Utilitzeu les ordres natives explícites
anteriors com a base portable.

Si una instal·lació ja utilitza `scripts/runtime/native_watchdog.sh`,
reviseu `~/.gnosi_native_watchdog.log` per detectar bucles de reinici.
El marge d’arrencada (`GNOSI_NATIVE_STARTUP_GRACE`) i l’interval mínim entre
reinicis (`GNOSI_NATIVE_WATCHDOG_COOLDOWN`) són de 600 segons per defecte.
Deixeu prou temps per a una arrencada en fred o una recàrrega i mantingueu
l’interval almenys tan llarg com el temps d’arrencada mesurat. Un senyal recent
d’activitat del clon pot ajornar el reinici. L’script també mata processos
multiprocessing coincidents i invoca launchd: la selecció de processos és
àmplia; no l’executeu com a diagnòstic genèric ni l’instal·leu sense revisar
les altres càrregues Python del host.

## Desplegament Docker opcional

El Compose actual és un conjunt orientat al desenvolupament, no un desplegament
mínim aïllat. Configureu explícitament `VAULT_HOST_PATH` i
`VAULTS_ROOT_HOST_PATH`; les rutes alternatives encara fan referència a
l’organització OneDrive del mantenidor. Reviseu els muntatges abans
d’utilitzar-lo: inclouen el socket Docker, el directori personal, un directori
privat `.antigravity`, secrets antics i codi font. Que hi siguin no converteix
les eines privades del host en requisits de Gnosi. Reviseu els ports publicats
i l’autenticació abans d’exposar un host.

Proporcioneu un `GNOSI_JWT_SECRET` privat i robust a la interpolació de
Compose mitjançant el shell o el `.env` local; un `env_file` del servei, per
si sol, no satisfà l’expressió d’interpolació obligatòria. Compose estableix
`GNOSI_DATA_DIR=/data`, hi munta `gnosi_local_data` i utilitza `/vault`
i `/vaults` per als muntatges dels vaults. El conjunt opcional també inclou
el translation-server de Zotero.

`Dockerfile.frontend` instal·la les dependències de `pnpm-lock.yaml` amb
`--frozen-lockfile`. Actualment Compose cobreix tant `/app/node_modules`
com `/app/frontend/node_modules` amb volums anònims. Després de canviar
dependències, reconstruïu la imatge del frontend i renoveu només els volums
de dependències d’aquell servei; si no, el contingut antic pot ocultar el nou
fitxer de bloqueig. El backend exporta `uv.lock` amb `--frozen` i instal·la
els requisits d’execució després d’un wheel de Torch només per a CPU. Aquest
pas especial encara necessita validació per plataforma. El codi del backend
es recarrega mitjançant el muntatge del codi font; els canvis de dependències
requereixen reconstruir la imatge. No utilitzeu mai `docker compose down -v`
ni una eliminació generalitzada de volums com a reparació rutinària: el volum
amb nom conté bases de dades i credencials persistents.

## Empaquetament Electron opcional

Electron utilitza el valor heretat de `GNOSI_DATA_DIR`, després
`GNOSI_LOCAL_DATA` i després `LOCAL_DATA_DIR`; si no n’hi ha cap, passa el
perfil `userData` al backend inclòs. No pressuposeu que aquest perfil
coincideix amb el directori predeterminat de Python natiu a tots els sistemes
operatius. Preserveu el perfil i també les dades del backend configurades
separadament abans d’actualitzar.

El workspace fixa la versió d’Electron i en desactiva la descàrrega automàtica
del binari. `corepack pnpm --filter @gnosi/desktop install:runtime` és el pas
explícit d’instal·lació del binari per executar Electron localment. Compileu
el frontend abans d’empaquetar. `desktop/build-python.sh` requereix Python
3.11 i uv, crea un entorn temporal i utilitza
`uv sync --frozen --no-default-groups --group desktop` amb el fitxer de
bloqueig del repositori. Comprova els límits dels recursos, executa PyInstaller,
verifica el paquet i executa la prova bàsica del backend empaquetat.
Actualment no es fixa pip 25.3; diagnostiqueu els errors de proxy o de l’índex
de paquets al runner afectat en lloc de recuperar aquella solució històrica.

| Destinació declarada al workflow de publicació | Artefactes configurats |
| --- | --- |
| macOS arm64 | DMG i ZIP |
| macOS x64 | DMG i ZIP |
| Linux arm64 | AppImage i DEB |
| Windows x64 | Instal·lador NSIS |

Són destinacions configurades, no resultats d’acceptació. L’arquitectura del
backend Python empaquetat ha de coincidir amb la destinació Electron. Els
jobs de publicació actuals no cobreixen Linux x64 ni Windows arm64. Els
contractes estàtics o una compilació del frontend no acrediten una instal·lació
neta, la primera arrencada, l’actualització, la reversió, la signatura ni la
preservació de dades reals en cap destinació. Exigiu evidència real de cada
plataforma abans de publicar; la validació de Docker és una comprovació separada.

## Mapa de símptomes habituals

| Símptoma | Àrea probable | Evidència següent |
| --- | --- | --- |
| Frontend en blanc | Error JavaScript, fragment antic, inicialització de l’autenticació | Consola del navegador, registre de Vite, compilació de producció. |
| La salut respon, però el vault falla | Ruta del vault, permisos, disponibilitat de fitxers | Configuració autoritzada, registres del vault, ruta exacta que falla. |
| La configuració es reverteix | Destinació de params incorrecta, escriptura fallida, migració | Context del vault actiu i origen dels paràmetres. |
| Una integració apareix desconnectada | Credencial local absent o selecció de compte obsoleta | Estat del compte amb secrets ocults i emmagatzematge de secrets configurat. |
| L’agent no té eines | Connexió MCP, validació del catàleg, assignació de skills | Registres de descobriment i endpoints de skills autoritzats. |
| El correu deixa d’actualitzar-se | Procés del compte o autenticació del proveïdor | Estat del procés de cada compte i sincronització incremental. |
| L’escriptori mostra una versió antiga | Renderer/backend antic o manifests incoherents | Checkout/paquet realment en execució i versions dels paquets. |

## Documentació i aprenentatge dels incidents

Utilitzeu el workflow pre-PR de documentació descrit a
[Manteniment de la documentació](../testing/documentation-maintenance.md).
Reviseu manualment les quatre llengües; actualitzeu de manera determinista només
els catàlegs generats. El responsable de la integració executa les comprovacions
pre-PR, les compilacions estrictes dels quatre portals i la QA al navegador
quan els workers han acabat. Mantingueu `site/engineering` i els subdirectoris
de llengües fora del control de versions.

El workflow de Pages està configurat per publicar els canvis de documentació
de `main` al [portal d’enginyeria](https://gnosi.temenosismael.org/engineering/).
Si falla, reviseu la validació de les referències generades, la traçabilitat i
les compilacions estrictes de les llengües abans de l’artefacte Pages.
Comproveu la font real de publicació de Pages i els permisos de l’entorn
`github-pages`; el codi del workflow no demostra que el desplegament hagi funcionat.

Registreu les causes dels incidents, els intents fallits i la recuperació
verificada. Mantingueu els detalls privats de les màquines i les directives
de desenvolupament a `WorkspaceTools`; publiqueu només lliçons portables amb
evidència de codi i proves. Corregiu la implementació i afegiu proves de
regressió específiques quan calgui. Una recuperació feta només al terminal,
sense verificació ni documentació, no completa una reparació operativa.
