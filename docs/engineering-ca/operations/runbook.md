---
status: implemented
last_verified: 2026-09-09
source_paths:
  - package.json
  - pyproject.toml
  - pnpm-workspace.yaml
  - pnpm-lock.yaml
  - uv.lock
  - scripts/runtime/run_native_dev.sh
  - scripts/runtime/run_native_frontend.sh
  - scripts/check_public_runtime.py
  - frontend/vite.config.js
  - frontend/src/app/App.tsx
  - frontend/src/shared/plugins/usePlugins.ts
  - backend/app/health_contracts.py
  - backend/domains/calendar/timing.py
  - backend/utils/request_profile.py
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
  - compose.vaults.yml
  - Dockerfile.backend
  - Dockerfile.frontend
  - desktop/package.json
  - desktop/backend-launch.js
  - desktop/build-python.sh
  - desktop/electron-builder.yml
  - .github/workflows/build-release.yml
  - .github/workflows/documentation-pages.yml
  - tests/e2e/tests/setup/auth.setup.ts
  - tests/e2e/support/auth-playwright.ts
  - tests/e2e/support/auth-state.ts
tests:
  - pipeline/tests/test_native_runtime_wrappers.py
  - frontend/src/app/App.pluginRecovery.test.tsx
  - frontend/src/app/App.loginPluginRecovery.test.tsx
  - backend/domains/calendar/tests/test_timing.py
  - backend/tests/test_request_profile.py
  - backend/tests/test_graph_request_timing.py
  - backend/tests/test_vault_creation_membership.py
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

La comprovació de disponibilitat del navegador utilitza la mateixa instantània
global del procés que les sondes natives: una galeta, capçalera o consulta del
vault actiu no activa la resolució del vault a la ruta exacta `GET /api/health`.
La resta de rutes i mètodes mantenen l’encaminament habitual. L’autodetecció de
la política d’autenticació comparteix només lectures pendents; els seguidors HTTP
esperen una tasca en lloc d’ocupar workers bloquejats. El TTL existent de cinc
segons continua començant amb la lectura original; un restabliment retira la
generació pendent, les variables explícites de l’entorn es mantenen fresques,
les sessions explícites de base de dades eviten la reutilització i els errors
continuen exigint autenticació.

El mode personal local s’obre sense registre per a qualsevol perfil. Els registres addicionals de comptes no activen l’autenticació: les peticions anònimes reutilitzen el propietari de l’espai personal, prioritzant els propietaris establerts sobre les identitats generades i després la pertinença més antiga. Si encara no hi ha espai personal, es reutilitza el compte establert més antic; una instal·lació buida crea la identitat local. Els desplegaments d’organització o exposats i les opcions explícites d’autenticació mantenen el requisit de credencials.

La configuració agrupa els editors dels connectors a Plugins i elimina les entrades duplicades del menú general. La llista de connectors, les instal·lacions de tercers, el catàleg i les actualitzacions segueixen l’ordre alfabètic del nom visible en l’idioma de la interfície. Els accessos existents a Referències obren directament el seu connector; els altres editors mantenen les accions de configuració i un botó per tornar a Plugins.

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
bash scripts/runtime/run_native_dev.sh 5002
```

```sh
bash scripts/runtime/run_native_frontend.sh --config vite.config.js --host 127.0.0.1
```

El wrapper del backend utilitza l’entorn existent de l’arrel mitjançant
`uv run --project "$BASE" --frozen --no-sync`, crida les funcions canòniques
de Python `load_env()` i `resolve_data_dir()` i inicia uvicorn a loopback amb
recàrrega limitada a `backend/`. No sincronitza ni instal·la dependències.
No interpreta dotenv al shell ni força un vault OneDrive, un proveïdor,
`HOME_HOST_PATH`, una zona horària, un model o un endpoint de traducció.

El wrapper del frontend estableix `COREPACK_ENABLE_NETWORK=0` i executa
`corepack pnpm --filter @gnosi/frontend dev`; pnpm i les dependències fixades
ja han d’estar disponibles. L’exemple passa una configuració Vite explícita
i una adreça loopback; sense `--host`, s’aplica el host configurat a Vite.
Establiu `VITE_BACKEND_HOST` i `VITE_BACKEND_PORT` explícitament per a un altre
backend (valors predeterminats: `127.0.0.1` i `5002`). Vite carrega els seus
dotenv; el wrapper no exporta un `VITE_FRONTEND_PORT` predeterminat que els
oculti. Tots dos wrappers validen els ports proporcionats entre 1 i 65535,
transmeten els arguments i propaguen els codis de sortida. El frontend conserva
les etiquetes explícites del checkout i avisa si ja s’ha integrat i ha quedat
enrere respecte d’`origin/main`.

Per a l’ús natiu habitual, compileu una vegada i serviu l’aplicació compilada:

```sh
corepack pnpm --dir frontend run build
GNOSI_NATIVE_FRONTEND_MODE=preview bash scripts/runtime/run_native_frontend.sh
```

Preview utilitza el mateix port estricte, certificats HTTPS, redirecció d’HTTP
a HTTPS i proxy del backend. Serveix una còpia aïllada de `frontend/dist`, de
manera que una compilació posterior no pot eliminar recursos de l’aplicació
en execució. L’aturada elimina només la còpia d’aquell procés. Torneu a compilar
i reinicieu per aplicar canvis de codi; el valor predeterminat
`GNOSI_NATIVE_FRONTEND_MODE=dev` manté les actualitzacions en directe del codi.
Una compilació absent o un mode invàlid falla explícitament. Un LaunchAgent
gestionat pot seleccionar preview amb aquella variable d’entorn; recarregueu
la tasca després de canviar-ne l’entorn emmagatzemat.

Les compilacions inclouen un manifest Vite. Preview l’utilitza per identificar
els recursos públics exactes amb hash de contingut i els serveix amb cache
immutable del navegador en respostes GET/HEAD correctes, inclosa la validació
304. HTML, respostes API, recursos inexistents, fitxers públics no enumerats i
altres mètodes mantenen la política de cache existent. Canviar el contingut
canvia l’URL compilat; l’entrada HTML es continua revalidant per descobrir la
compilació actual. Les compilacions antigues sense manifest mantenen la política
original de Vite. Això evita revalidacions repetides després que el navegador
hagi rebut les noves capçaleres; no elimina la latència de la primera descàrrega
ni de les API.

L’arrencada deixa passar les peticions d’encaminament i salut pel middleware
asíncron abans de programar les descàrregues de la ruta i la interfície principal.
Es cedeix un torn al navegador sense esperar cap de les respostes; la representació
continua respectant la preparació de l’encaminament i de l’idioma. La compilació
agrupa només les 51 icones de la interfície principal revisades explícitament.
Les altres icones i rutes pesants continuen sent diferides, i les dependències
compartides de les icones mantenen la ubicació automàtica. Després de canviar
aquest grup, comproveu el graf d’importacions compilat per detectar cicles nous
i dependències inicials inesperades, a més dels límits de bytes.

Una galeta de sessió opcional invàlida s'ignora quan l'accés personal local està
permès, de manera que una sessió caducada no introdueix cap registre ni inici de
sessió. Quan calen credencials, `/auth/me` distingeix una galeta invàlida d'un
401 anònim habitual. La interfície ofereix una acció explícita de recuperació:
crida l'endpoint existent de tancament de sessió, esborra les metadades locals
d'identitat només si té èxit i recarrega l'aplicació. Si falla, la recuperació
continua disponible. Això no canvia la política d'autenticació ni l'accés a
pàgines compartides públiques.

Un 401 explícit d’una ruta protegida amb `Authentication required` és un cas
diferent: quan `/api/auth/me` informa d’un usuari anònim, mostreu Login en lloc
de diagnosticar una galeta caducada o demanar que es tanqui la sessió. La resposta
del servidor al catàleg de complements té prioritat sobre una instantània anterior
de salut que indiqui autenticació desactivada. La correcció `authenticationRequired`
de `usePlugins` i App té 17 proves focalitzades, una comprovació focalitzada de
tipus, lint dels fitxers existents i una compilació correctes. Una prova addicional
d’integració d’App verifica que iniciar sessió al mateix vault recarrega els
complements i abandona Login; el seu lint també passa. L’activació amb TLS de
confiança i la pantalla Login real estan verificades; no s’ha fet cap inici
o tancament de sessió real ni s’han llegit credencials. Consulteu la feina de
temps del calendari a l’[auditoria de latència de navegació](navigation-latency-audit-2026-09-08.md).

El perfilat Python amb privilegis no és l’única via de diagnòstic. La
instrumentació optativa de durades del calendari mitjançant
`X-Gnosi-Calendar-Timing: 1` i `Server-Timing` està implementada i activada a les
rutes de calendaris i esdeveniments. Informa dels temps de cua, resolució de
credencials i HTTP sense exposar credencials ni contingut del calendari. Només
es propaga el context `CalendarTiming`; els contextos de vault i autenticació
i els resultats de les consultes no canvien. Els temps són inclusius i poden
ser concurrents, de manera que no s’han de sumar per reconstruir el total.
`cal_total` exclou el middleware i la validació de resposta i no és la durada
HTTP completa. `cal_service` inclou l’accés a la capa de servei, importacions
de discovery anteriors a les credencials imbricades i la construcció del client;
no és temps pur de `build`. La bateria de 35 proves del calendari, una repetició
de les 9 proves noves, Ruff i mypy han passat. La verificació real amb accés a
dades ha retornat HTTP 200 amb un calendari i dos esdeveniments visibles després
de 10.557 s. L’espera anterior de 47–52 s al servidor no s’ha reproduït;
queden intervals locals sense explicar, i aquest canvi diagnòstic no demostra
una millora global atribuïble de latència. Aquesta via no requereix autorització
administrativa.

Hi ha un mostrejador Python dins del procés per a peticions del graf amb
`X-Gnosi-Graph-Profile: 1`, i per a peticions d’esdeveniments del calendari amb
`X-Gnosi-Calendar-Profile: 1` i `X-Gnosi-Calendar-Timing: 1` alhora. Permet un
mostrejador simultani, durant un màxim de 15 s a 20 Hz, observant el fil principal
i els workers registrats explícitament. Només registra noms normalitzats de
fitxers de codi, noms de funció i números de línia, sense variables locals,
globals, arguments, noms de fils, dades de l’usuari ni traçat del correu. La
sortida agregada està limitada a 256 piles de 32 frames i inclou l’identificador
del procés i l’instant d’inici monotònic. El fitxer amb mode `0600`
`/tmp/gnosi-request-profile-<id>.json` es desa en arribar al límit de 15 s encara
que la petició continuï pendent. L’aturada espera com a màxim 250 ms; la resposta
inclou `X-Gnosi-Request-Profile-Id` quan la persistència ja és completa.
No cal autorització administrativa. La bateria de 35 proves del mostrejador,
calendari i graf, Ruff, mypy i l’activació del backend han passat. Les captures
del graf i del calendari s’han completat sense privilegis administratius.
La captura del graf tenia 39 observacions en una finestra màxima de 15 s,
33 piles agregades i cap de descartada. L’interval nominal de 50 ms no ha estat
constant a la pràctica: no multipliqueu els recomptes d’observacions per aquell
interval per obtenir durades. Un frame del runner d’uvloop no distingeix temps
inactiu de treball natiu en C. La captura posterior del calendari tenia 34
observacions, 19 piles i cap de descartada; els frames d’espera dels workers i
de cache de discovery són observacions, no durades additives. Aquests límits
descriuen la recollida diagnòstica, no una correcció de latència. Les correccions
de descodificació JSON, admissió limitada a la cache de metadades i discovery
estàtic de Google estan implementades i validades: han passat 80 casos de prova
únics, Ruff, mypy i la comprovació del diff. El backend s’ha activat en 185.3 s.
Les obertures directes posteriors, només amb temps i recursos compilats a cache,
han mostrat el graf després de 22.128 s i dades fresques del calendari després
de 16.081 s. Aquestes mesures no demostren una millora global de latència ni
l’objectiu de 0.5 s. La navegació final en calent ha mostrat dades del graf
després de 7.447 s i dades fresques del calendari després de 5.392 s; les dades
ja carregades del calendari eren visibles als 398 ms. Manteniu separats els
temps de visibilitat i de dades fresques. La verificació i la neteja són completes,
mentre que l’objectiu de latència continua parcial. S’ha restaurat l’HTML de la
còpia nativa, s’han eliminat el script de temps i les dues captures, i el calendari
accessible de loopback s’ha tornat a la vista mensual sense consulta d’auditoria.
HTTPS ha retornat 200 amb verificació TLS correcta i HTML `no-cache`; HTTP ha
redirigit amb 307 a HTTPS, i els recursos compilats han mantingut un any de
cache immutable.

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

El frontend natiu gestionat estableix `pnpm_config_verify_deps_before_run=warn`
per defecte i conserva qualsevol valor explícit. Reiniciar un servei no ha
d’activar una reinstal·lació implícita de dependències quan una altra tasca
canvia els manifests del workspace. Instal·leu i sincronitzeu les dependències
explícitament abans de reiniciar el servidor afectat; l’avís no demostra que
les dependències instal·lades coincideixin amb el fitxer de bloqueig.

Per a HTTPS local de confiança, instal·leu `mkcert` i executeu
`bash scripts/runtime/setup-https-dev.sh`; després reinicieu el frontend.
La configuració instal·la una autoritat de certificació local al magatzem de
confiança de la màquina i genera certificats ignorats a `frontend/certs/`.
Amb aquests certificats, `https://localhost:5173` serveix l’aplicació i HTTP
redirigeix a la mateixa ruta i consulta mitjançant HTTPS. Els fitxers de
certificat sols no són suficients si el navegador no confia en l’autoritat local.

El desenvolupament natiu utilitza notificacions del sistema de fitxers.
Establiu `CHOKIDAR_USEPOLLING=true` només per a sistemes de fitxers o muntatges
bind de contenidors que necessitin sondeig. Vite prepara la interfície principal,
Coneixement i el Centre de control durant l’arrencada; les altres pantalles
continuen sent diferides i es pre-carreguen quan hi ha intenció de navegar-hi.

L’idioma inicial i el format dels registres utilitzen `/api/config/interface`,
una resposta petita de preferències visuals limitada al vault i amb el mateix
control de permisos que la configuració. No llegeix l’estat de les credencials;
`/api/config` continua sent la resposta completa de configuració, inclosos els
indicadors de credencials. Els editors i el Centre de control llegeixen
`/api/config/editor`, que conserva camps editables i extensions, normalitza
referències de proveïdors i valors predeterminats, i exclou credencials en text
pla i indicadors de disponibilitat de només lectura sense consultar magatzems
de credencials. Desar la configuració invalida les caches corresponents del
frontend. Les lectures dels editors comparteixen només peticions solapades
per vault; les lectures posteriors es revaliden immediatament.
Configuració carrega els documents editables una vegada per obertura del modal,
inclòs quan el mode de desenvolupament repeteix els efectes de muntatge. Tancar
i tornar a obrir continua demanant documents frescos de configuració, integració
i identitat. Els selectors de camps i registres reutilitzen un comparador de
la configuració regional per ordenació. La configuració de Planificació conserva
taules, projectes i tasques ordenats fins que canvien les dades o la configuració
regional, de manera que editar camps no relacionats no torna a ordenar centenars
d’opcions.

L’encaminament del vault resol les consultes inicials SQLite i de carpetes del
núvol en workers. Les peticions concurrents de la mateixa identitat comparteixen
una consulta; els canvis de vault invaliden la cache d’identitat de 60 segons,
incloses les consultes en curs. El context del vault actiu s’estableix a la tasca
de petició després de consultar-lo, abans de cridar l’endpoint. Els lectors HTTP
solapats esperen una tasca compartida en lloc d’ocupar workers mentre un altre
resol la mateixa identitat. Desconnectar un lector no pot cancel·lar la consulta
que necessiten altres peticions.

Els lectors de configuració reutilitzen preparacions correctes de directoris
durant un màxim de 30 segons, amb un límit de 256 rutes. YAML, selecció de vault
i lectures de fitxers mantenen les comprovacions habituals de frescor i permisos.
Les preparacions fallides es reintenten, i les crides directes a `get_paths()`
continuen comprovant i reparant immediatament. Si s’elimina un directori preparat,
una lectura de configuració pot ajornar-ne la recreació fins que caduqui l’interval.

Les lectures de comptes de correu resolen credencials només del compte seleccionat
o dels comptes habilitats durant la sincronització, excloent integracions alienes.
Les lectures de carpetes de correu, recordatoris de calendari i construcció del
graf s’executen en workers, inclosa la càrrega de configuració i registre.
Configuració carrega dades auxiliars de models, calendari, lector i xarxes
socials quan s’obre la secció que les utilitza. El graf mostra immediatament
les dades disponibles, sense un retard mínim de càrrega, i reutilitza la ruta
resolta de configuració del vault quan llegeix metadades gestionades de cada
node. Quan hi ha un índex de pàgines, la descoberta del graf utilitza les seves
rutes i dates de modificació i evita un segon recorregut del sistema de fitxers
del núvol. Els nodes sense canvis conserven els enllaços complets del cos a
cache; els nodes canviats es tornen a analitzar. Un índex antic absent o aliè
provoca el recorregut del sistema de fitxers. La frescor de l’índex segueix el
vigilant i l’actualització en segon pla existents.
La cache en disc de nodes analitzats s’escriu només després que canviï un node.
La persistència codifica una instantània i utilitza l’escriptor atòmic en lloc
de milions de petites escriptures JSON. Els lectors inicials concurrents esperen
una càrrega completa; els canvis que arriben durant un desament queden pendents
i els desaments fallits es reintenten en la reconstrucció següent.
Les caches persistents de nodes del graf es particionen per ruta de vault a
`LOCAL_CACHE/graph_nodes/`. Un vault sense cache pròpia llegeix una vegada les
seves entrades de l’antic `graph_node_cache.json` i escriu la seva partició;
el fitxer antic queda intacte per als altres vaults. L’estat carregat i pendent
de desar es controla separadament per vault, de manera que obrir-ne un no exigeix
descodificar totes les entrades antigues dels altres.
Un fitxer adjacent de metadades vincula els nodes analitzats amb la classificació,
els colors i els sidecars gestionats mitjançant un resum del JSON real dels nodes.
Les caches antigues o els marcadors que no coincideixen requereixen una
regeneració. Els marcadors es publiquen només després d’una construcció completa
i un desament correctes; les lectures fallides o parcials continuen sent reintentables.
El visor del graf deixa que Sigma representi per lots les actualitzacions de
topologia, visibilitat i posició sense forçar una segona reindexació completa
per pas de disposició. Els canvis en passar-hi el cursor continuen invalidant
l’estat visual. La projecció inicial i els filtres de visibilitat s’apliquen
abans de construir Sigma, de manera que el primer índex rep la topologia preparada.
La línia temporal utilitza el seu límit inicial efectiu abans de confirmar-lo
a l’estat, evitant una segona simulació D3 inicial de les mateixes dades i filtres;
els canvis posteriors de la línia temporal continuen actualitzant la disposició.
El minimapa agrupa els esdeveniments de graf, càmera i renderitzador en un dibuix
per frame, dibuixa els cercles de nodes per lots, canvia de mida només quan cal
i cancel·la la feina en cua en substituir-se o desmuntar-se. Els ajustos ajornats
de càmera també es cancel·len quan es tanca o canvia la seva vista del graf.
Els recomptes dels filtres de camps reutilitzen el graf de filtratge ja normalitzat
i recorren els nodes una vegada per a tots els camps configurats. Les metadades
es normalitzen només una vegada per node; el recompte conserva la classificació
de taules, la cerca de camps sense distingir majúscules, els valors repetits i
l’ordre estable quan els recomptes són iguals.
La pàgina obté l’índex global de títols només quan el necessiten els filtres de
camps configurats. Aquests filtres conserven la prioritat de títols de l’índex
canònic. Les consultes de graf, taules, configuració i índex es limiten al vault
actiu; les vistes de graf incrustades comparteixen la consulta del graf i la
invalidació per prefix.
Cada lot del graf al backend també resol una vegada els noms i àlies dels camps
de relació d’una taula, incloses les taules sense relacions. Aquesta cache pertany
només al lot; la construcció següent llegeix l’esquema actual del registre, i les
metadades de pàgina a cache mai no es modifiquen en convertir wikilinks de relació
en identificadors.
L’API del graf conserva un cos JSON validat per a la instantània actual i comprova
l’objecte actual del servei abans de reutilitzar-lo. Les reconstruccions i
invalidacions substitueixen aquell objecte, els grafs parcials mai no es conserven
i una validació fallida no pot publicar un cos. La codificació s’executa al worker
de la petició; les capçaleres de resposta i les tasques en segon pla continuen
sent independents per a cada petició.

Les lectures d’arrels, arbre, àlbums, vistes i pàgines multimèdia també s’executen
en workers perquè la latència de les carpetes del núvol no bloquegi altres
peticions. Una pàgina multimèdia resol cada vault/arrel una vegada dins de la
petició; l’àmbit es descarta tant si té èxit com si falla. Les lectures concurrents
del mateix arbre multimèdia confinat comparteixen només la feina pendent.
Els llistats de directoris pare i fill comparteixen un límit global de quatre
escanejos, conservant filtres de carpetes i ordenació estable. L’arbre no té TTL:
les peticions posteriors llegeixen els directoris actuals i les fallades no es
conserven per a peticions posteriors.
Els índexs multimèdia persistits conserven cadenes de ruta validades i dates de
modificació en una seqüència immutable. La paginació predeterminada construeix
objectes `Path` només per a la pàgina seleccionada, no per a tots els fitxers
indexats. La càrrega continua validant tot l’índex; els filtres i l’ordenació
personalitzada continuen inspeccionant cada entrada aplicable. El format JSON i
l’interval de frescor de 24 hores mantenen la compatibilitat. Quan l’interval
caduca, l’API del navegador retorna la instantània desada mentre un màxim de dos
workers l’actualitzen; la cua conjunta de feina en curs i pendent es limita a
vuit tasques. Les peticions del mateix índex comparteixen aquesta feina. Un primer
índex sense dades desades utilitzables continua esperant l’escaneig inicial.

`GET /api/vault/media` informa de `X-Gnosi-Media-Index` (`fresh`, `refreshing`
o `failed`), un `X-Gnosi-Media-Index-Revision` opac i `X-Gnosi-Media-Next-Offset`.
El cos manté el contracte existent. Els fitxers eliminats des de la instantània
s’ometen dels elements, però les posicions i el total es mantenen estables;
els consumidors avancen amb la capçalera de desplaçament següent, incloses les
finestres buides. Les actualitzacions fallides conserven la instantània desada
i retornen una espera `Retry-After` de fins a 30 segons. La galeria consulta una
actualització cada cinc segons, fins a 60 vegades, i després ofereix reintent manual.
Conserva les fotos carregades i substitueix tot el prefix carregat només després
de comprovar revisions coincidents entre pàgines. Els canvis d’arrel, àlbum,
filtres o vault i els desmuntatges cancel·len peticions i temporitzadors.

Els escanejos parcials no poden substituir un índex complet. La invalidació retira
la generació de publicació i la persistència substitueix atòmicament un fitxer
temporal codificat. Un índex llegit completament continua sent utilitzable en
memòria si falla l’escriptura de la cache. Els consumidors Python antics conserven
lectures bloquejants i els resultats parcials disponibles, però no publiquen
escanejos parcials. El format JSON històric no pot certificar retrospectivament
que un índex antic fos complet; se’n valida l’estructura en carregar-lo. Una cache
que no es pot escriure no sobreviu a un reinici del procés.

La configuració social resol només la seva secció d’integració, conservant llistes
explícitament buides i valors predeterminats sense obrir credencials no relacionades.

Les notificacions d’errors no gestionats s’executen en un worker perquè l’E/S de
bases de dades, fitxers i notificacions natives no bloquegi altres peticions HTTP.
L’arrencada diferida del planificador també s’executa en un worker. La cancel·lació
espera que acabi l’arrencada en curs abans que l’aturada cridi stop, evitant que
un planificador s’iniciï després d’haver-se aturat. Aquests límits conserven els
ContextVars de petició i la resposta 500 segura existent.

La configuració de complements carrega els complements instal·lats i els permisos
independentment del mercat. El catàleg i les dades de confiança es carreguen quan
s’obre la seva secció, i una lectura pendent de confiança no amaga un catàleg
disponible. Les lectures fallides mostren una acció de reintent abans de permetre
editar la configuració. El backend reutilitza l’estat descodificat dels complements
només quan coincideixen les dates de modificació i canvi, la mida i l’inode del
fitxer; desar-lo l’invalida, i cada document retornat és una còpia independent
limitada a la ruta del fitxer.

L’entrada del navegador inicia l’encaminament del vault i la descàrrega de la
pantalla demanada abans de carregar React DOM i la interfície principal. Comparteix
la lectura pendent d’encaminament amb aquesta interfície, que continua esperant
l’encaminament i l’idioma abans de representar-se. L’entrada estableix la galeta
del vault actiu abans de qualsevol petició inicial. La lectura d’encaminament
comença abans de les importacions especulatives de pantalles i té una prioritat
alta de petició; la programació del navegador s’ha de mesurar al host de destinació.
Els límits de compilació acoten separadament el codi necessari per iniciar aquestes
peticions i conserven l’arrencada dinàmica necessària dins del pressupost complet.
El catàleg de vaults llegeix el mode i l’emmagatzematge predeterminat d’una
instantània de configuració per petició; les posteriors llegeixen la configuració actual.

Els selectors de planificació de projectes demanen tots els identificadors i títols
de pàgina a l’endpoint `references` de la taula. Utilitza el mateix filtre de
plantilla i càrrega de títols que la resposta completa, però no transfereix metadades
inutilitzades. Les lectures concurrents comparteixen només vault, taula i filtre
idèntics; les posteriors es revaliden immediatament. Un editor de configuració obert
cancel·la les lectures de taules i referències en canviar de vault i no mostra
resultats de l’anterior, encara que els identificadors de taula coincideixin.
En el conjunt local de 748 tasques i 45 projectes, les dues respostes descodificades
sumaven 67,381 bytes en lloc d’1,130,202 bytes (94.04% menys), amb els mateixos
identificadors i títols ordenats. Les peticions de referències mesurades han trigat
118 ms i 22 ms; això no estableix el temps fins que es pot utilitzar el formulari
complet de configuració.

El calendari munta la graella mentre es carreguen les notes locals i preferències,
perquè l’interval visible real de FullCalendar pugui iniciar concurrentment les
lectures d’esdeveniments externs. La graella s’amaga i queda inerta només durant
la primera lectura local sense dades utilitzables. Les fonts locals completes
resideixen en una consulta limitada al vault i es revaliden a cada obertura
(`staleTime: 0`). Tornar a obrir mostra aquella instantània i els esdeveniments
complets del mateix interval mentre un indicador d’activitat identifica les
actualitzacions pendents; l’interval de frescor dels esdeveniments externs es manté
en 30 segons. Una actualització parcial no pot sobreescriure l’última instantània
local completa. Un primer resultat parcial encara pot mostrar notes útils, amb
error explícit i reintent. Les llistes, intervals, consultes de recordatoris i
invalidacions per mutació del calendari es limiten al vault; les dades provisionals
de l’interval anterior mai no travessen vaults. La visibilitat desada s’aplica
abans de seleccionar calendaris que arriben aviat. Actualitzar les notes conserva
la instància de la graella, el període seleccionat i la vista. Les proves amb
resposta ajornada exerciten el remuntatge real de FullCalendar amb un resultat
envellit del mateix interval; el contingut visible a cache i les dades acabades
d’actualitzar s’han de mesurar separadament al navegador del host.

Configuració ja no importa el registre complet de components Lucide. El selector
d’icones d’agents carrega noms cercables en obrir-se i representa només les icones
demanades, inclosos els àlies numerats desats. La compilació comprova les
importacions estàtiques transitives de Configuració, no només la mida del fitxer
d’entrada, per evitar milers de petites descàrregues d’icones.
El desament automàtic estableix la base només després que es carreguin tots els
documents editables; obrir o tancar una sessió de configuració que es carrega a poc
a poc no ha d’activar escriptures. La mateixa resposta de configuració proporciona
els paràmetres sanejats de proveïdors d’IA. La càrrega no obté una segona vegada
tot el catàleg de proveïdors i models només per obtenir aquells camps; les
referències de credencials, indicadors de disponibilitat i extensions es conserven.
Els editors de configuració es carreguen amb la secció seleccionada, i els diàlegs
secundaris només quan s’obren. La llista de complements instal·lats també ajorna
cada editor integrat fins que s’obre la seva configuració.
Els indicadors de càrrega es mantenen dins del contingut seleccionat perquè
la navegació de Configuració i el botó de tancament continuïn disponibles.

La safata de correu carrega el lector i el redactor només quan s’obre un missatge
o esborrany. El panell de detall buit és independent de l’editor de text enriquit
i les eines del calendari; la safata i una acció de tancament continuen disponibles
mentre es carrega qualsevol dels mòduls. Els formularis d’esdeveniments, les eines
de disponibilitat i la cerca global també es carreguen en obrir-se, sense canviar
el desament automàtic d’esborranys, la visibilitat d’esdeveniments ni les recurrències.
Les previsualitzacions de títols ajornen la targeta de pàgina i el renderitzador
Markdown fins que s’hi passa el cursor o s’obren des del teclat. Entrar-hi amb el
punter inicia la càrrega del mòdul durant el retard existent; sortir-ne continua
cancel·lant l’obertura i la navegació es manté utilitzable. Els límits de compilació
cobreixen els grafs complets d’importacions estàtiques del correu i del calendari,
inclòs el codi compartit d’arrencada, perquè una entrada de ruta petita no amagui
un editor carregat anticipadament.

Les subscripcions push del correu esperen asíncronament; les pestanyes inactives
ja no ocupen el conjunt compartit de workers entre esdeveniments. Les notificacions
originades en fils conserven els filtres de compte, l’ordenació limitada i la neteja
en cancel·lar o desconnectar. Les consultes de vistes i etiquetes locals del correu
utilitzen l’execució síncrona en workers de FastAPI, conservant el context del
vault actiu i deixant disponible el bucle de peticions. Les importacions inicials
del proveïdor híbrid també s’executen en workers i s’ometen en lectures de missatges
ja emmagatzemats a cache.

Les actualitzacions d’integracions conserven les referències al magatzem segur
i resolen només les credencials canviades. Les lectures de configuració que només
obtenen referències no esperen darrere d’un lector que desbloqueja credencials.
La sincronització IMAP resol el compte seleccionat des de qualsevol de les dues
seccions admeses, en lloc de desbloquejar tots els comptes de correu.
L’encaminament al proveïdor de calendari llegeix metadades de comptes sense
desbloquejar credencials. Els clients Google i CalDAV resolen només les identitats
de calendari/correu coincidents; Google també filtra per proveïdor i autenticació
OAuth abans d’accedir al magatzem segur. La prioritat de calendari abans de correu
i les lectures fresques de credencials no canvien. Les lectures concurrents de
credencials de Google Calendar comparteixen només la feina encara pendent per al
mateix correu, document de configuració i instantània de revisió/referències.
Les lectures completes o fallides s’eliminen immediatament; les crides posteriors
tornen a resoldre credencials. Cada consumidor rep dades de credencials independents
i construeix el seu client. Les rutes d’estat de recordatoris de reunions utilitzen
directament `resolve_data_dir()`, sense carregar paràmetres del vault ni crear
directoris durant la resolució de la ruta. L’escriptor atòmic prepara el directori
pare local quan cal desar l’estat.

La configuració reutilitza YAML descodificat de fitxers sense canvis, comprovant
dispositiu, inode, mida, dates de modificació/canvi i permisos a cada lectura.
Els lectors concurrents comparteixen una lectura inicial del mateix fitxer;
els vaults no relacionats mantenen lectures independents i tots els consumidors
reben documents independents. Les lectures fallides o inestables no es reutilitzen.
La cache conserva com a màxim 16 documents de fins a 1 MiB cadascun. L’entorn i
la selecció del vault actiu es mantenen frescos. La descoberta de rutes reutilitza
només la ubicació del checkout del mòdul i comprova els directoris existents abans
d’intentar crear-los; els directoris eliminats i els selectors de dades/vault
canviats mantenen el comportament habitual de reparació.

La disponibilitat de credencials resol els àlies d’entorn dels proveïdors a partir
de la instantània actual del catàleg, metadades locals descarregades o metadades
incloses al paquet. No actualitza models.dev, no consulta Ollama ni espera una
actualització en curs del catàleg de models. Les lectures explícites del catàleg
es continuen actualitzant normalment. Els índexs locals d’àlies són limitats i es
tornen a llegir després de substituir o modificar fitxers; la resolució de secrets
i els indicadors sanejats `has_api_key` mantenen la prioritat existent.
Les comprovacions concurrents de credencials comparteixen la descodificació inicial
de cada fitxer de catàleg sense canvis. Els fitxers diferents i les substitucions
avancen independentment; les lectures fallides s’alliberen i es reintenten a la
consulta següent sense conservar una entrada fallida a cache.

La navegació de Configuració i els editors de complements integrats utilitzen
transicions de React per mantenir disponibles els controls actuals mentre es
carrega un altre editor. Les lectures concurrents de taules i pàgines de taula
comparteixen una petició per vault, taula i filtre, inclosos els remuntatges de
desenvolupament; les lectures posteriors sempre es revaliden, i tancar un consumidor
no pot avortar-ne un altre.

Les lectures de pàgines de taula preparen noms actuals de camps, identificadors
immutables i àlies una vegada per lot. Les files amb claus que no necessiten
canviar de nom es copien sense comptabilitzar col·lisions. Es conserven la prioritat
de nom/identificador/àlies, l’ordre original de claus, les metadades locals opaques
i la validació HTTP de metadades. Els mapes preparats es mantenen dins d’una
lectura de taula; les consultes posteriors els reconstrueixen perquè els canvis
de nom i els esquemes de diferents vaults siguin independents.

El graf demana només el seu document de configuració a `/api/config/graph`.
La lectura hereta el control existent de permisos de configuració i el context
del vault, però mai no inspecciona credencials de proveïdors d’IA ni de contrasenya
del sistema. El document complet de Configuració conserva el comportament sanejat
de l’estat de credencials. Les actualitzacions de preferències del graf continuen
llegint la configuració actual després dels canvis.
Després de la projecció, la construcció del graf neteja l’emmagatzematge temporal
d’adjacència i atributs de NetworkX, inclosos els resultats parcials i les fallades.
Altrament, les seves vistes a cache poden retenir aquell emmagatzematge fins a
una recollida cíclica global del procés; la resposta projectada i la cache de nodes
analitzats conserven les seves dades independentment. Els grafs de vault incrustats
utilitzen les opcions explícites de vista i no obtenen un document global de
configuració inutilitzat en muntar-se, canviar la configuració o reintentar
resultats parcials.

L’entrada de Configuració, la navegació entre seccions i els botons de configuració
de complements integrats preparen el mòdul de l’editor seleccionat quan hi ha
intenció amb el punter, focus del teclat o toc. Els mateixos carregadors
d’importacions serveixen React.lazy; la preparació mai no munta una secció,
llegeix documents editables ni desa configuració. Les descàrregues especulatives
fallides s’ignoren perquè l’obertura de la secció continuï controlant la càrrega
i els errors habituals. Mesureu el temps des del clic fins a controls poblats i
habilitats separadament de la preparació del mòdul i del primer frame del modal;
avançar una descàrrega abans del clic no demostra que la càrrega de dades compleixi
l’objectiu de latència de navegació.

Abans d’acceptar peticions, l’arrencada visita en un worker els contextos de
validació de rutes incloses de FastAPI sense generar l’esquema públic opcional
de l’API ni executar dependències dels endpoints. Això evita construir rutes
de manera diferida en la primera petició del navegador i deixa la generació
i cache de l’esquema al camí habitual sota demanda. L’arrencada d’integracions
continua ajornada fins que acaba la preparació de rutes; l’autenticació i la
validació de paràmetres continuen executant-se a cada petició aplicable.

Les revisions d’esquema de vault `vault_0005`–`vault_0006` afegeixen índexs del
Lector per data de publicació, estat de lectura i font. Això evita escanejar
cossos d’articles i ordenar tota la taula abans d’aplicar el límit del llistat.
L’executor habitual de migracions fa una còpia de seguretat de la base de dades
i verifica l’esquema, la integritat i els recomptes de files; el contingut dels
articles i els camps de resposta del llistat es conserven. Un índex de cobertura
d’inventari evita que l’agregació de fonts i recomptes obri cossos d’articles.
Les proves del pla de consultes cobreixen les quatre variants de llistat i
l’agregació d’inventari. La interfície del Lector demana `include_content=false`
per a la llista d’articles, conservant metadades, filtres i ordre mentre exclou
els cossos desats de la consulta SQL i de la càrrega HTTP. Obrir un article n’obté
el cos complet separadament; una selecció nova cancel·la la petició anterior i
les fallades ofereixen reintent. L’API predeterminada de llistat i els enllaços
directes als articles conserven el contracte de contingut complet.

Planificació tracta un fitxer d’estat/historial existent però il·legible, o un
document d’estat corrupte, com a no disponible, mai com un pla nou buit. Les línies
individuals malformades de l’historial continuen seguint el comportament existent
d’omissió. Els errors temporals del proveïdor retornen 503 amb
`planning_storage_pending` i `Retry-After`; les consultes de lectura reintenten
dins d’una finestra limitada, mentre que les mutacions mai no es repeteixen
automàticament. Les claus de consulta de Planificació inclouen el vault actiu,
i les dades provisionals del projecte anterior només es reutilitzen dins d’aquell
vault. El projecte seleccionat es resol a partir de referències compactes de
pàgines abans de carregar-ne el calendari i les línies base.

Les respostes d’imatge distingeixen les descàrregues del proveïdor encara pendents
de les fallades confirmades mitjançant `X-Gnosi-File-Availability`. La miniatura
reintenta només després d’un error real d’imatge, respecta l’espera de reintent,
cancel·la en desmuntar-se i reutilitza els bytes de la resposta correcta.
Les descàrregues fallides mostren un reintent manual després d’una espera curta.
Una petició de preparació o un bloc de fitxer assignat no demostra disponibilitat:
el proveïdor comprova la llegibilitat en un worker. Completar la descàrrega del
núvol continua depenent del proveïdor de fitxers i s’ha de verificar amb fitxers reals.

Un timeout del catàleg de complements manté tancats els controls d’accés a funcions
i mostra una acció explícita de reintent a la interfície principal i al control
de la ruta de complements. Una lectura fallida del catàleg no demostra que els
complements estiguin desactivats; no substituïu l’estat no disponible per un catàleg
buit amb èxit. Les lectures i respostes pendents d’activació/configuració es limiten
al vault actiu; un èxit o una reversió tardans d’un vault anterior no poden
substituir l’estat actual.

Les reconstruccions del graf s’agrupen per vault; els encerts de cache eviten
reconstruir el registre. Després de 30 segons, el servei revalida les rutes i dates
de modificació indexades, dades del registre, columnes de contactes, propostes
pendents, configuració i sidecars gestionats. Una instantània completa sense canvis
conserva l’objecte del graf i els cossos codificats. Les lectures petites i correctes
de sidecars reutilitzen una LRU de com a màxim 512 documents de 64 KiB cadascun,
després de comprovar dispositiu, inode, mode, dates, mida i assignació. Les lectures
fallides o inestables mai no es conserven; els documents retornats són còpies
independents. Una instantània canviada es reconstrueix a partir de les entrades
capturades i es torna a comprovar abans de publicar-la. Les entrades no fiables
no poden renovar una resposta correcta. Les lectures de sidecars són estrictes
i limitades al vault de la petició; els canvis semàntics també actualitzen els
nodes analitzats d’aquell vault. Sense un índex canònic, la reconstrucció periòdica
habitual continua sent l’alternativa.
La compressió JSON del graf s’executa en un worker i reutilitza bytes de la mateixa
instantània immutable, conservant la invalidació i la gestió de resultats parcials.
Els recomptes de carpetes de correu utilitzen una connexió separada i de vida curta
perquè el seu escaneig no serialitzi el llistat de missatges a la mateixa connexió.
El llistat de capçaleres obté només els camps que consumeix; les credencials es
resolen de manera fresca quan s’utilitza el proveïdor. Configuració carrega taules
i bases de dades concurrentment i conserva qualsevol resultat correcte si l’altre
falla. L’arrencada solapa la lectura de salut amb la preparació de ruta, compartint
la petició pendent amb el control d’autenticació i la barra lateral.

Les lectures de missatges conserven el camp d’error explícit quan el proveïdor
no pot connectar-se, seleccionar o cercar la carpeta, o obtenir capçaleres.
Aquestes respostes mai no substitueixen una cache vàlida de llistat ni en renoven
la frescor. Els recomptes retornen 503 reintentable si fallen o superen el límit
global de lectura de 30 segons; una lectura compartida pot acabar en segon pla
per a un altre consumidor. Els GET de llistat i recompte de Microsoft també
utilitzen un timeout de xarxa de 20 segons, de manera que el worker subjacent
està limitat. La interfície publica els recomptes correctes dels comptes a mesura
que arriben i identifica comptes pendents o no disponibles i recomptes anteriors
conservats. Un llistat visible o una resposta de missatges HTTP200, per si sols,
no demostren una lectura fresca correcta de tots els comptes. Invalidar recomptes
també retira les identitats de lectures en curs, evitant que un worker antic
publiqui o renovi un recompte anterior a la mutació. La paginació publica cada
pàgina de compte independentment. Les pàgines fallides conserven el cursor i
els missatges visibles, i l’acció de reintent demana només aquelles pàgines.

Mesureu tant les primeres lectures com les repetides, i distingiu les respostes
API completes del contingut representat utilitzable. Un llistat en calent per
sota de 500 ms no estableix un pressupost de navegació de 500 ms: els escanejos
inicials del núvol, catàlegs externs, miniatures i representació del navegador
encara requereixen mesures separades.

## Build del frontend i enllaços directes

Executeu `corepack pnpm build:frontend` des de l’arrel del repositori. Les
comprovacions prèvies inclouen el contracte de la configuració real de Vite.
Per defecte, els recursos utilitzen `/`: els enllaços profunds i les recàrregues
resolen JavaScript, estils i icones des de l’arrel de l’origen. El mateix artefacte
serveix per al web HTTP i el protocol estàndard `app://gnosi` d’Electron;
Electron no necessita una base relativa `./`.

`VITE_BASE_PATH` es manté com a configuració explícita de la base dels recursos.
El valor `./` reintrodueix la resolució relativa a les rutes imbricades. Un prefix
de recursos no configura la base de l’encaminador ni demostra suport per muntar
tota l’app sota un prefix d’URL. Manteniu el valor per defecte per a les
estructures web i desktop estàndard. El servidor HTTP ha de retornar l’entrada
SPA per a les rutes de l’app, servir els recursos reals i enviar `/api` al backend.
Vite preview ja inclou aquest proxy d’API; és un servidor de validació, no una
prova d’acceptació del desplegament en producció.

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

Els 15 scripts històrics del runtime del host (instal·ladors, watchdogs i eines
del host), juntament amb els llançadors obsolets `run_brain.sh` i `run_prod.sh`,
s’han retirat del repositori públic. Les operacions del host pertanyen al
repositori privat `WorkspaceTools`. Executeu `pnpm check:runtime` després de
preparar els canvis revisats: CI rebutja scripts retirats, enllaços simbòlics i
estat local a l’índex Git. Les instal·lacions existents poden
escriure registres a `~/Library/Logs/Gnosi`; reviseu-ne la configuració real.
Són facilitats opcionals del host, no el contracte d’arrencada portable. Les
definicions de serveis específiques de cada màquina, les rutes privades i
l’historial d’incidents pertanyen al repositori privat `WorkspaceTools`,
no als requisits públics.

Aquesta neteja del checkout no modifica, migra ni desinstal·la els serveis
instal·lats del host. Els wrappers portables anteriors no instal·len ni eliminen
serveis existents del host. L’instal·lador històric `install_native_startup.sh`
atura els processos que escolten als ports 5002/5173 i recarrega LaunchAgents.
No executeu els instal·ladors o watchdogs preservats com a diagnòstic; reviseu
la configuració real instal·lada i els procediments privats.

Si una instal·lació encara utilitza una còpia preservada de `native_watchdog.sh`,
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

Docker és una destinació d’autoallotjament suportada i opcional. El fitxer base
`docker-compose.yml` no necessita cap directori de vault del host ni rutes
pròpies del mantenidor:

| Contingut persistent | Volum amb nom | Ruta al contenidor |
| --- | --- | --- |
| Bases de dades i credencials per dispositiu | `gnosi_local_data` (clau conservada) | `/data`, mitjançant `GNOSI_DATA_DIR` |
| Vaults | `gnosi_vaults` (volum nou) | `/vaults`, mitjançant `GNOSI_VAULTS_ROOT`; actiu predeterminat `/vaults/default` |

Els vaults existents del host no es copien automàticament al volum nou.
Conserveu el nom del projecte Compose quan actualitzeu: determina la identitat
dels volums amb nom. Canviar-lo pot seleccionar volums buits mentre les dades
antigues continuen existint. Feu còpies de seguretat de les bases de dades,
credencials i vaults abans de canviar res. No utilitzeu mai
`docker compose down -v` ni una purga generalitzada de volums per reparar
dependències.

Els ports publicats són `127.0.0.1:5002` i `127.0.0.1:5173` per defecte.
`GNOSI_BIND_ADDRESS`, `GNOSI_BACKEND_PORT` i `GNOSI_FRONTEND_PORT` configuren
la publicació al host; els ports interns continuen sent 5002/5173 i el frontend
fa de proxy cap a `backend:5002`. Compose força HTTP al frontend. Reviseu
l’autenticació, TLS i l’accés de xarxa abans de canviar l’adreça d’escolta per
exposar el servei.

Proporcioneu un `GNOSI_JWT_SECRET` privat i robust mitjançant el shell o el
`.env` local per a la interpolació de Compose. Un `env_file` del servei no
satisfà, per si sol, l’expressió obligatòria. Compose estableix explícitament
`GNOSI_REQUIRE_AUTH=1`; no desactiveu l’autenticació per superar una prova bàsica.

Compose llegeix un `env_file` compartit opcional seleccionat amb
`GNOSI_SHARED_ENV_FILE` (alternativa `.env.shared.disabled`) i després el
`.env` opcional; aquest últim preval en les claus repetides. Les entrades
explícites d’`environment` del servei prevalen sobre tots dos fitxers. Són
regles de l’entorn del contenidor: les variables arbitràries del shell del
host no es transmeten automàticament. Compose llegeix els fitxers al host,
sense muntar-los ni incloure’ls a les imatges, i buida `GNOSI_SHARED_ENV_FILE`
dins del backend per no tornar a carregar una ruta del host. No exigeix
implícitament cap `.env_shared` dels directoris pare.

El conjunt inclou el translation-server de Zotero internament al port 1969,
sense publicar-lo al host. `GNOSI_TRANSLATION_IMAGE` en selecciona la imatge;
`TRANSLATION_SERVER_URL` pren `http://translation-server:1969` només si no
està definida i conserva un valor buit explícit. La traducció és opcional per
a Gnosi, però aquest fitxer Compose declara el servei auxiliar sense un perfil
opcional.

Per utilitzar directoris existents del host, afegiu explícitament
`compose.vaults.yml`:

```sh
docker compose -f docker-compose.yml -f compose.vaults.yml up -d --build
```

Abans d’aquesta ordre, proporcioneu `VAULT_HOST_PATH` (vault actiu existent)
i `VAULTS_ROOT_HOST_PATH` (directori pare existent) a la interpolació de
Compose. Totes dues rutes són obligatòries; els dos muntatges utilitzen
`create_host_path: false` per rebutjar directoris inexistents. Preferiu rutes
absolutes; les relatives es resolen des del directori del Compose base.
La sobreescriptura substitueix el volum de `/vaults` segons la destinació al
contenidor, afegeix el muntatge actiu a `/vault` i estableix
`DIGITAL_BRAIN_VAULT_PATH=/vault`. Conserva `gnosi_local_data:/data` i
transmet les dues rutes del host seleccionades per traduir les accions sobre
fitxers. No copia dades ni configura serveis auxiliars del host.

El conjunt base no munta codi font, dependències del host, directori personal,
arbre privat `.antigravity`, directori de secrets ni socket Docker. La
sobreescriptura de vaults afegeix només els dos directoris seleccionats.
El CLI Docker de la imatge del backend no dona accés al motor del host sense
un socket o un endpoint configurat separadament. El codi i les dependències
pertanyen a les imatges: no hi ha recàrrega del codi del host ni volums anònims
de `node_modules` per renovar. Reconstruïu les imatges si canvien el codi o els
fitxers de bloqueig; preserveu els volums persistents.

`Dockerfile.frontend` utilitza Node 22.22.2, pnpm 11.19.0 i
`--frozen-lockfile`, i serveix Vite al port estricte 5173. El backend exporta
`uv.lock` amb `--frozen`, instal·la el wheel fixat de Torch només per a CPU i
després els requisits exportats; uvicorn s’executa sense `--reload`.
La disponibilitat del wheel, les compilacions i l’arrencada requereixen
validació per plataforma. Els tests estàtics de codi i contractes no
substitueixen la fusió real de Compose, les compilacions al motor, les proves
bàsiques dels contenidors ni l’acceptació per plataforma.

## Acceptació autenticada i límits de la QA

L’acceptació nativa ha de provar el registre real, la creació d’un workspace i
del primer vault, l’inici de sessió, `/api/auth/me`, les cookies HttpOnly i la
preparació d’autenticació de Playwright, amb arrencada i aturada netes. Al
navegador cal crear i editar una pàgina descartable, recarregar-la i reobrir-la
per verificar la persistència del títol i del cos, revisar la consola i
comprovar el tancament de sessió. Superar la fixture i el flux de navegador
no acredita tota la suite E2E, la matriu Docker/Electron ni una publicació.

La preparació E2E exigeix `GNOSI_TEST_EMAIL` i `GNOSI_TEST_PASSWORD` explícits
d’un compte de prova descartable ja creat abans d’accedir a la xarxa. Inicia
sessió i la verifica amb `/api/auth/me`; no registra comptes ni inventa una
identitat d’administrador. `GNOSI_TEST_WORKSPACE_ID` ha de correspondre a una
pertinença verificada; ometeu-lo només si n’hi ha exactament una.
`GNOSI_TEST_VAULT_ID` és opcional i no concedeix permisos. Mantingueu privat
l’estat de sessió, preferiblement en un `GNOSI_TEST_STORAGE_STATE` temporal,
i no activeu traces, captures, vídeo o registres de diagnòstic de la preparació
que puguin contenir credencials.

`backend/tests/test_vault_creation_membership.py` cobreix la creació del
primer vault amb pertinença autenticada owner/admin/editor, rebutja peticions
sense autenticar, de només lectura o d’altres workspaces, i comprova el
confinament de rutes i el llistat d’organització sense registrar el vault
personal. Aquesta cobertura de regressió no substitueix la validació real
de l’aplicació i del navegador. El responsable de la integració manté les
comprovacions completes de navegador, CI, SOP i acceptació per plataforma.

Des de l’arrel del repositori, `corepack pnpm test:e2e:contracts` executa els
contractes d’autenticació, JSON i rutes d’API sense xarxa, i després comprova
estrictament els tipus de tots els fitxers TypeScript E2E actius i de suport:
proves de funcionalitats, anònimes, d’accessibilitat i visuals. L’àlies específic
`typecheck:auth` continua disponible. No inicia l’aplicació ni substitueix
l’acceptació real d’inici de sessió i navegador; els tests JavaScript arxivats
queden fora d’aquesta comprovació.

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
