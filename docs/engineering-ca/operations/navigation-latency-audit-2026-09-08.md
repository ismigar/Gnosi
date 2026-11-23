---
status: partial
last_verified: 2026-09-09
source_paths:
  - backend/app/errors.py
  - backend/app/lifespan.py
  - frontend/src/shared/api/useCalendarData.ts
  - frontend/src/features/calendar/page/useCalendarLocalSources.ts
  - frontend/src/features/calendar/page/CalendarPageWorkspace.tsx
  - backend/services/auth_service.py
  - backend/services/auth_public_surface.py
  - backend/config/directory_preparation.py
  - backend/services/active_vault_middleware.py
  - backend/domains/graph/cache_inputs.py
  - backend/domains/calendar/google.py
  - backend/domains/calendar/timing.py
  - backend/utils/request_profile.py
  - backend/services/meeting_reminders.py
  - backend/domains/media/roots.py
  - backend/domains/media/scan_cache.py
  - backend/domains/media/index_refresh.py
  - backend/domains/media/query.py
  - backend/domains/vault/media/routes.py
  - frontend/src/shared/api/media-browser.ts
  - frontend/src/features/media/browser/useMediaCollection.ts
  - frontend/src/features/media/browser/MediaGallery.tsx
  - frontend/scripts/native-preview.ts
  - frontend/vite.config.js
  - scripts/runtime/run_native_frontend.sh
  - frontend/src/shared/graph/viewer/useGraphViewerRenderer.ts
  - frontend/src/features/graph/page/useGraphPageController.ts
  - backend/app/factory.py
  - backend/domains/graph/nodes.py
  - backend/domains/graph/projection.py
  - backend/domains/vault/files/serving.py
  - frontend/src/shared/graph/viewer/graphViewerPhysics.ts
  - frontend/src/features/media/browser/useThumbnailVisibility.ts
  - backend/api/planning_routes.py
  - backend/api/vault_graph_routes.py
  - backend/domains/mail/routes/messages.py
  - backend/platform/files/on_demand.py
  - frontend/src/app/startup.ts
  - frontend/src/app/App.tsx
  - frontend/src/shared/plugins/usePlugins.ts
  - frontend/src/features/settings/global-settings/GlobalSettingsView.tsx
  - docs/engineering/operations/navigation-latency-observations-2026-09-08.json
tests:
  - backend/tests/test_app_async_boundaries.py
  - frontend/src/shared/api/useCalendarData.test.tsx
  - frontend/src/features/calendar/page/useCalendarSources.cache.test.tsx
  - frontend/src/features/calendar/page/CalendarPageWorkspace.test.tsx
  - backend/tests/test_auth_policy_singleflight.py
  - backend/tests/test_health_vault_independence.py
  - backend/tests/test_active_vault_async_singleflight.py
  - backend/tests/test_vault_identity_directory_reads.py
  - backend/tests/test_directory_preparation_cache.py
  - backend/tests/test_graph_input_revalidation.py
  - backend/tests/test_calendar_pending_credentials.py
  - backend/domains/calendar/tests/test_timing.py
  - backend/tests/test_request_profile.py
  - backend/tests/test_graph_request_timing.py
  - backend/tests/test_graph_response_compression.py
  - backend/tests/test_meeting_reminder_local_reads.py
  - backend/tests/test_media_tree_reads.py
  - backend/tests/test_media_persisted_entry_reads.py
  - backend/tests/test_media_index_refresh.py
  - backend/tests/test_component_read_responsiveness.py
  - frontend/src/shared/api/media-browser.test.ts
  - frontend/src/features/media/browser/useMediaCollection.test.tsx
  - frontend/src/features/media/browser/MediaCenter.test.tsx
  - frontend/tests/native-preview.test.ts
  - frontend/tests/vite-config.test.ts
  - frontend/src/app/startup.test.ts
  - frontend/src/app/App.pluginRecovery.test.tsx
  - frontend/src/app/App.loginPluginRecovery.test.tsx
  - frontend/tests/preview-asset-cache.test.ts
  - pipeline/tests/test_native_runtime_wrappers.py
  - frontend/src/features/graph/page/useGraphPageController.timeline.test.tsx
  - backend/tests/test_route_preparation.py
  - backend/tests/test_graph_request_timing.py
  - backend/tests/test_image_metadata_scheduling.py
  - frontend/src/shared/graph/viewer/graphViewerPhysics.test.ts
  - frontend/src/features/media/browser/Thumb.visibility.test.tsx
  - backend/tests/test_planning_storage_recovery.py
  - backend/tests/test_graph_response_compression.py
  - backend/tests/test_image_download_recovery.py
  - frontend/src/features/settings/global-settings/settingsController.test.tsx
  - frontend/src/features/media/browser/Thumb.recovery.test.tsx
---

# Revisió de càrrega del 8 de setembre de 2026

L'objectiu de carregar totes les pantalles amb dades en 0,5 s **encara no està assolit**.
S'ha reprès la comprovació amb el Mac desbloquejat, el backend natiu i el navegador
integrat. HTTPS funciona amb verificació del certificat local; HTTP retorna 307
cap a HTTPS al mateix port 5173.

## Fase del 9 de setembre: cua inicial reduïda, càrrega completa encara lenta

L’objectiu actual continua sent mostrar les dades necessàries de cada pantalla
en 0,5 s, inclosa la primera obertura. **L’estat es manté parcial: no s’ha
demostrat una millora global suficient.** Les correccions estan actives,
validades i la neteja de l’auditoria està acabada. Les darreres obertures
directes han costat 22,128 s al graf i 16,081 s al calendari; en calent,
7,447 s al graf i 5,392 s fins a dades fresques del calendari. Els 398 ms
fins a veure dades ja carregades del calendari no equivalen a dades fresques.
La lectura inicial de 63,577 s i les sèries del 8 de setembre es conserven
com a històric, sense atribuir causalitat a comparacions no controlades.

La mesura anterior amb cache de navegador buida tenia 121 recursos compilats;
115 havien començat abans del despatx de les API inicials. Salut i espais
començaven als 1.709 ms, però `requestStart` arribava als 6.553 ms: 4.843 ms de
cua, amb DNS, connexió i TLS a zero. Això acredita espera anterior al servei,
però no demostra per si sol un límit concret de streams HTTP/2.

Ara són actius dos canvis: es dona un torn al navegador perquè les peticions
inicials es despatxin abans de carregar les rutes i el shell, sense esperar-ne
les respostes; i s’agrupen explícitament 51 icones petites del shell. La cache
immutable dels recursos compilats es conserva. La comparació dels manifests
mostra:

| Graf estàtic compilat | Abans | Després |
| --- | ---: | ---: |
| Entrada i bootstrap: chunks | 84 | 36 |
| Entrada i bootstrap: bytes | 538.828 | 529.350 |
| Amb Calendari: chunks | 112 | 64 |
| Amb Calendari: bytes | 963.474 | 952.874 |
| Cicles d’importació a tot el manifest | 0 | 0 |
| Entrades dinàmiques individuals d’icones | 1.546 | 1.546 |

El catàleg dinàmic i els editors pesants no s’han avançat a l’arrencada.
Activity i Heart, que ja s’importaven estàticament, ara ocupen dos chunks de
329 i 353 B fora del grup: això explica els 36 chunks en lloc dels 34 esperats.
Han passat 67 proves, les comprovacions de tipus i ESLint, i la compilació
completa de 55,83 s d’aquesta activació.

La prova freda al port 5187 registra cues de 13/12 ms i només nou recursos
anteriors al despatx inicial, però l’API d’espais retorna 401: **queda exclosa
de les mesures funcionals del calendari**. La primera activació a `localhost`
també retorna 401 i mostra recuperació de configuració, amb cues de 3/3 ms;
tampoc és una càrrega funcional completada. La lectura amb accés a dades a
`127.0.0.1:5173` té cues inicials de 57/56 ms, 73 recursos compilats dels quals
29 es reutilitzen, però el servidor necessita 47,181 s per als calendaris i
51,897 s per als esdeveniments. La millora del despatx i de la fragmentació és
verificable; aquesta sèrie no permet afirmar que tota la pantalla sigui més
ràpida. L’activació del frontend havia costat 66,1 s, una durada separada de
la navegació. La instància temporal 5187 s’ha retirat.
El mètode d’autenticació d’aquest accés a dades no s’ha verificat.

Un perfil natiu **posterior** de 15 s aporta 1.346 mostres per fil, comptades
de manera exclusiva, sense sumar pares i fills. El fil principal passa un
55,35% de les mostres esperant esdeveniments i un 35,59% en contenció del GIL;
un treballador combina runtime Python i lectura de fitxers. Dos fils esperen
lectures SSL tota la finestra, però no hi ha identificació de les peticions
corresponents. Les 21 lectures de salut retornen 200, amb mediana de 175 ms i
rang de 10–779 ms; el procés ocupa 406,1 MB, amb pic de 472,1 MB segons el
perfil. **Aquest perfil no explica causalment els 51,897 s anteriors:** no
s’atribueixen al GIL, al sistema operatiu ni a aquests sockets sense més prova.

La recuperació de galeta de sessió invàlida ja està activada. Han passat les
18 proves aïllades, tipus i ESLint; la compilació Vite ha costat 1 min 9 s,
conserva zero cicles d’importació, i l’activació ha trigat 52,0 s. Aquest cas
addicional no s’ha exercitat amb una sessió real invàlida al navegador: no es
presenta com la solució del bloqueig actual ni com una millora de latència
mesurada.

La classificació temporal de les respostes 401 a `localhost` confirma
`authentication_required` a `/api/vaults` i `/api/vault/plugins`, mentre
`/api/auth/me` informa `anonymous`. **No s’ha identificat una sessió caducada.**
No s’ha fet logout ni s’han llegit credencials. El cas actual és accés anònim
a dades que exigeixen autenticació. La correcció `authenticationRequired` de
`usePlugins` i App ja està codificada perquè es mostri Login quan el catàleg de
complements exigeixi autenticació, encara que la instantània de salut indiqui
el contrari. Han passat les 17 proves inicials, la comprovació focalitzada de
tipus, ESLint dels quatre fitxers revisats i la compilació de 67 s amb els
límits de mida correctes. Aquesta compilació té 531.032 B estàtics d’arrencada
i 954.556 B amb Calendari, conserva 36/64 chunks, zero cicles i 1.546 entrades
dinàmiques d’icones. Una prova d’integració addicional d’App confirma que iniciar
sessió al mateix espai recarrega els complements i abandona Login. Aquesta
prova i el seu ESLint han passat. El frontend s’ha activat en 74,2 s
amb TLS verificat. A `https://localhost:5173/@vault/calendar`, el navegador
mostra Login i ja no mostra l’error de configuració; no hi ha cap calendari
carregat ni instrumentació temporal present. Això confirma la recuperació de
la pantalla d’accés, no una càrrega funcional del calendari. No s’ha fet cap
inici o tancament de sessió real ni s’han llegit credencials.
Abans de la instrumentació de temps descrita a continuació, el recompte del
torn era de **96 proves úniques passades**; les bateries parcials se solapen
i no s’han de sumar com si fossin casos diferents. La bateria de calendari
posterior es registra separadament, sense inferir un nou total únic.

S’ha instal·lat py-spy 0.4.2 per obtenir noms de funcions Python. La captura
requereix privilegis: `sudo -n` confirma que cal contrasenya. El diàleg de
macOS per a una captura de 15 s, sense variables locals, ha expirat als 120 s
sense autorització. **No s’ha fet ni desat cap captura** (`saved=false`), ni
s’han llegit contrasenyes. No queda cap resultat d’aquesta captura pendent
d’analitzar ni se n’extreu cap conclusió causal.

La diagnosi continua sense dependre d’aquesta autorització administrativa:
la instrumentació optativa de `Server-Timing` està implementada a les rutes
de calendaris i esdeveniments i s’activa amb `X-Gnosi-Calendar-Timing: 1`.
Només exposa durades, per distingir espera en cua, resolució de credencials
i HTTP; no valors de credencials ni contingut del calendari. Propaga només
el context `CalendarTiming`, sense alterar el context d’espai o autenticació
ni els resultats de les consultes. Els temps són inclusius i poden ser
concurrents: **no s’han de sumar** per reconstruir el total. `cal_total`
exclou el middleware i la validació de la resposta, de manera que tampoc
equival a tota la durada HTTP.

Han passat 35 proves de calendari: 9 de noves i 26 d’existents. Les 9 noves
han tornat a passar després de limitar la propagació del context; aquesta
repetició no afegeix casos únics. També han passat Ruff de 7 fitxers, mypy de
6 fitxers de codi i la comprovació d’espais del diff seleccionat. El backend
s’ha activat en 178,8 s; aquesta arrencada es registra separada de la càrrega
de la interfície. La lectura posterior del calendari a l’adreça de loopback,
amb accés a dades i la còpia temporal del frontend instrumentada, ha acabat
amb totes les respostes HTTP 200, un calendari, dos esdeveniments i cap error.
Les dades visibles i fresques han arribat als **10.557 ms**; la petició
d’esdeveniments ha acabat als 10.445 ms. Salut i espais han costat 976 i
1.178 ms, amb 4 ms de cua. S’han carregat 73 recursos compilats, 25 des de
cache, amb 322.304 B transferits.

| Petició | Durada HTTP | Espera del servidor | Cua del navegador |
| --- | ---: | ---: | ---: |
| Calendaris | 6.037 ms | 5.991 ms | 44 ms |
| Esdeveniments | 7.244 ms | 7.193 ms | 45 ms |

| Fase `Server-Timing` | Calendaris (ms) | Esdeveniments (ms) |
| --- | ---: | ---: |
| `cal_total` | 5.303,319 | 6.492,143 |
| Cua del worker | 9,221 | 46,336 |
| Integracions | 2,905 | 142,198 |
| Lectura de calendaris/esdeveniments | 2.215,899 | 6.327,889 |
| Filtrat de calendaris ocults a la base de dades | — | 5,467 |
| Credencials | 824,473 | 692,416 |
| Servei (`cal_service`, fase inclusiva) | 1.406,349 | 1.210,476 |
| HTTP del proveïdor | 744,555 | 1.048,494 |

Aquestes fases inclusives i concurrents no són una partició del total. La
mesura mostra trams locals que encara no queden explicats; tampoc permet
atribuir la diferència entre l’espera del servidor i `cal_total`. No s’ha
reproduït l’espera anterior de 47–52 s i no es demostra una millora integral
atribuïble a aquesta instrumentació, que és diagnòstica. La causa dels pics
continua oberta.

El mostreig Python dins del procés està implementat a
`backend/utils/request_profile.py`, amb punts d’entrada al calendari i al graf.
Al graf s’activa amb `X-Gnosi-Graph-Profile: 1`; als esdeveniments del calendari,
amb `X-Gnosi-Calendar-Profile: 1` i també `X-Gnosi-Calendar-Timing: 1`.
Hi ha un únic mostrejador simultani, limitat a 15 s a 20 Hz, que observa el
fil principal i els workers registrats explícitament. Només agrega rutes de
codi normalitzades, noms de funció i números de línia: no llegeix variables
locals o globals, arguments, noms de fils ni contingut de l’usuari. No inclou
traçat del correu i no requereix permisos administratius.

El fitxer `/tmp/gnosi-request-profile-<id>.json`, amb permisos `0600`, conté
com a màxim 256 piles de fins a 32 frames, més el PID i l’inici monotònic.
Es desa automàticament en acabar els 15 s encara que la petició continuï
pendent; l’espera d’aturada està limitada a 250 ms. Si el fitxer ja és
disponible quan acaba la ruta, la resposta n’indica l’identificador a
`X-Gnosi-Request-Profile-Id`.

La nova bateria ha passat **35 proves**: 6 del mostrejador, 9 de temps de
calendari, 6 de peticions del graf i 14 de compressió. També han passat Ruff
de 6 fitxers i mypy de 4. Aquesta bateria se solapa amb les anteriors i no
s’afegeix sencera al recompte de proves úniques. L’última activació del backend
ha acabat en 199,3 s, separats del temps de càrrega de la interfície, i la
còpia temporal del frontend d’auditoria està preparada. L’instrument també s’ha
corregit perquè inclogui les peticions anticipades que comencen abans del
clic i acaben després.

En la verificació real dels complements s’han vist 39 controls, tots
habilitats: controls als 185 ms i dades als 710 ms. El catàleg ha trigat
489 ms i els complements instal·lats 504 ms, amb HTTP 200. Al graf encara
hi havia l’indicador de càrrega als 29.395 ms; una lectura posterior del DOM
mostra 9 elements `canvas`, cap indicador de càrrega i cap error. No es va
capturar l’instant final: aquesta comprovació confirma el resultat visual,
però **no permet donar un temps exacte de càrrega del graf**.

En una nova lectura amb el mostrejador ja activat, el primer resultat visible
del graf ha arribat als **19.949 ms**, amb 9 elements `canvas`, sense errors
ni indicador de càrrega. `/api/graph` ha trigat 16.513 ms, amb 16.363 ms
d’espera del servidor i 109 ms de cua al navegador. És una mesura diferent
de la comprovació anterior sense instant final.

| Fase del graf | Durada inclusiva (ms) |
| --- | ---: |
| `graph` | 15.288,924 |
| `node_cache_load` | 6.254,548 |
| `revalidate` | 3.526,171 |
| `input_sidecars` | 2.399,317 |
| `input_contacts` | 1.287,776 |
| `pages` | 1.406,984 |
| `edges` | 1.698,292 |
| `verify_inputs` | 1.939,740 |
| `json` | 442,212 |
| `gzip` | 486,480 |

La captura `/tmp/gnosi-request-profile-ox2798gk.json`, del procés 64601,
s’ha completat sense permisos administratius: 39 mostres dins d’una finestra
màxima de 15 s, 33 piles agregades i cap pila descartada. Els 50 ms són
l’interval nominal; la freqüència real no ha estat constant. En 37 de les
39 observacions del fil principal apareix el runner d’uvloop, amb execució
interna en C que aquesta captura no resol: **no permet distingir repòs de
treball en C**. Als workers hi ha 6 observacions de lectura/`stat` de
`managed_metadata`, 4 de lectura SQL i 2 de descodificació de la cache JSON.
Aquests recomptes no són durades ni es poden multiplicar per 50 ms per
atribuir temps. Les fases de la taula també són inclusives i no s’han de
sumar com una partició del total.

La captura posterior del calendari
`/tmp/gnosi-request-profile-876xneks.json`, del mateix procés 64601, conté
34 mostres, 19 piles agregades i cap pila descartada. Les 34 observacions
del fil principal tornen a mostrar el runner en C, sense distingir repòs de
treball natiu. Als workers s’han observat esperes del coordinador de tasques
(31), del bloqueig de la cache de calendaris (12), de la resolució pendent
de credencials (5) i d’autodetecció de cache antiga de Google dins de
`_retrieve_discovery_doc` (5). Són observacions potencialment solapades,
no segons ni parts additives del total.

En aquesta lectura, la interfície del calendari ha arribat als **16.653 ms**.
Calendaris ha costat 10.523 ms, amb 88 ms de cua i 10.431 ms d’espera del
servidor; esdeveniments, 11.637 ms, amb 96 ms de cua i 11.539 ms d’espera.

| Fase `Server-Timing` | Calendaris (ms) | Esdeveniments (ms) |
| --- | ---: | ---: |
| `cal_total` | 7.426,349 | 8.582,591 |
| Cua del worker | 96,196 | 2,795 |
| Integracions | 98,037 | 209,282 |
| Lectura de calendaris/esdeveniments | 7.308,173 | 8.252,931 |
| Filtrat de calendaris ocults a la base de dades | — | 124,246 |
| Credencials | 1.763,370 | 1.791,605 |
| Servei (`cal_service`, fase inclusiva) | 4.415,920 | 4.029,862 |
| HTTP del proveïdor | 2.604,519 | 967,321 |

Aquestes fases continuen sent inclusives. La diferència respecte de la
durada HTTP no queda atribuïda per aquesta captura, i els temps entre
lectures continuen variant.

S’han implementat dues correccions acotades: descodificar la cache JSON amb
`pydantic_core`, amb alternativa de la biblioteca estàndard, i evitar
expulsions repetides de la cache de metadades durant passades K2/N3 quan hi
ha més de 512 sidecars, mantenint la capacitat de 512. El nombre de sidecars
actual **no està confirmat**. Una prova sintètica del descodificador mostra
aproximadament un 40% menys de CPU, amb temps real variable; no demostra que
els 6,25 s de `node_cache_load` siguin temps de parseig. Una tercera correcció
fa que `build` del client Google utilitzi `cache_discovery=False` i
`static_discovery=True`. El codi local de `discovery.py` confirma que
l’autodetecció de la cache precedia la lectura del document inclòs al paquet;
aquest camí apareix a la captura. Això justifica eliminar aquella consulta
innecessària, però no atribueix tota l’espera observada a aquesta funció.

La bateria de 80 proves ha donat inicialment 75 resultats correctes i 5
fallades de fixtures (4 de context manager d’escaneig i 1 de paràmetre d’un
mock). Les fixtures s’han corregit i la repetició dels dos fitxers afectats
ha passat els seus 35 casos, inclosos els 5 que havien fallat: el resultat
final és de **80 casos únics correctes**, no 110. També han passat Ruff de
7 fitxers, mypy de 3 i la comprovació del diff. El codi de les tres correccions
està estable i validat i l’activació final del backend ha acabat en 185,3 s,
separats de la durada de càrrega de les pàgines.

Les primeres obertures directes amb les tres correccions actives s’han
mesurat només amb `Server-Timing`, sense mostreig de piles. Els recursos
compilats ja eren a la cache del navegador: 64 de 64 al graf i 73 de 73 al
calendari, amb zero bytes transferits en aquests recursos. Per tant, no són
mesures amb la cache de recursos del navegador buida.

| Obertura directa final | Graf | Calendari |
| --- | ---: | ---: |
| Primer resultat visible | 22.128 ms | 16.081 ms |
| Dades fresques | — | 16.081 ms |
| Final de les peticions necessàries | — | 15.882 ms |
| Salut | 1.310 ms | 133 ms |
| Espais | 2.894 ms | 534 ms |
| Cua inicial de salut/espais | 2 ms | 2 ms |

El graf ha acabat sense errors ni indicador de càrrega. La seva petició ha
retornat HTTP 200 en 13.856 ms, amb 13.746 ms d’espera del servidor i 3 ms
de cua. La càrrega de la cache de nodes ha costat 338,287 ms: lectura
16,732 ms, parseig 220,779 ms i hash 3,579 ms. L’observació anterior de
6.254,548 ms tenia condicions diferents i mostreig activat: **aquesta
comparació no demostra una millora causal de la càrrega total**.

| Fase final del graf | Durada inclusiva (ms) |
| --- | ---: |
| `graph` | 11.136,317 |
| `revalidate` | 4.772,679 |
| `input_sidecars` | 1.158,005 |
| `input_contacts` | 1.427,903 |
| `input_suggestions` | 146,737 |
| `pages` | 1.011,945 |
| `edges` | 1.208,925 |
| `project` | 1.849,321 |
| `verify_inputs` | 1.459,192 |
| `json` | 1.235,445 |
| `gzip` | 378,968 |

Al calendari, el llistat ha costat 13.387 ms, amb 8 ms de cua i 13.377 ms
d’espera del servidor. Esdeveniments ha costat 14.252 ms, amb 24 ms de cua
i 14.227 ms d’espera del servidor.

| Fase final `Server-Timing` | Calendaris (ms) | Esdeveniments (ms) |
| --- | ---: | ---: |
| `cal_total` | 10.494,416 | 11.513,481 |
| Cua del worker | 0,899 | 87,681 |
| Integracions | 227,858 | 177,671 |
| Lectura de calendaris/esdeveniments | 9.827,250 | 11.247,108 |
| Filtrat de calendaris ocults a la base de dades | — | 118,618 |
| Credencials | 394,340 | 443,186 |
| Servei (`cal_service`, fase inclusiva) | 5.402,739 | 5.660,345 |
| HTTP del proveïdor | 4.009,729 | 899,131 |

Les fases són inclusives i no s’han de sumar. `cal_service` inclou la capa
d’accés, la importació de discovery abans de les credencials imbricades i
la construcció del client; **no és una mesura exclusiva de `build`**. No
s’atribueixen els aproximadament 5,5 s sencers a construir el client.
Aquestes lectures mantenen esperes rellevants al servidor i no demostren
una millora global ni l’objectiu de 0,5 s.

En la navegació final amb dades ja carregades, el graf ha estat visible als
**7.447 ms**, amb 9 elements `canvas`, sense errors ni indicador de càrrega.
L’API ha retornat HTTP 200 en 6.410 ms, amb 8 ms de cua i 6.319 ms d’espera
del servidor.

| Fase del graf en calent | Durada inclusiva (ms) |
| --- | ---: |
| `graph` | 4.305,445 |
| `revalidate` | 4.162,823 |
| `input_sidecars` | 1.075,912 |
| `input_contacts` | 943,582 |
| `input_suggestions` | 50,621 |
| `json` | 1,938 |
| `gzip` | 0,063 |

El calendari en calent ha mostrat els dos esdeveniments als **398 ms**, però
les dades fresques han arribat als **5.392 ms**, amb final de les peticions
necessàries als 5.372 ms. Calendaris ha costat 4.963 ms i esdeveniments
5.048 ms; totes les API han retornat HTTP 200 i no hi havia errors. Aquesta
diferència entre visibilitat i frescor es manté explícita.

La vista final s’ha deixat al calendari mensual de l’adreça accessible
`127.0.0.1`, sense consulta d’auditoria: 24 esdeveniments, un mes, cap alerta
ni indicador d’estat, sense Login ni instrumentació. La comprovació anterior
de `localhost` mostrava correctament Login. No s’han fet accions
d’autenticació. S’ha restaurat l’HTML de la còpia nativa, s’ha retirat el
script temporal de temps i s’han eliminat només les dues captures creades,
`ox2798gk` i `876xneks`; els artefactes temporals de treball i execució han
quedat nets.

La comprovació final de transport confirma HTTPS a `localhost` amb HTTP 200,
verificació TLS correcta (`verify=0`), HTML `no-cache` i cap instrumentació.
HTTP retorna 307 cap a `https://localhost:5173/`. Un recurs compilat retorna
200 amb `public, max-age=31536000, immutable`. L’ús de swap observat era de
18.739,81 MiB (18,30 GiB): és context del sistema, **no prova causal** dels
temps de càrrega. Una lectura posterior de `vm_stat` durant 5,02 s, amb
pàgines de 16 KiB, confirma swap actiu: entrades de 85,73 MiB/s, sortides
de 81,97 MiB/s, compressió de 277,09 MiB/s i descompressió de 318,46 MiB/s.
Acredita activitat en aquell interval, sense atribuir-hi tota la latència
dels endpoints; no s’ha aturat cap altra aplicació. S’ha identificat la possibilitat de reutilitzar text
immutable de l’esquema, però no s’ha implementat ni acreditat com a cost
principal; no és un bloqueig d’autorització.

### Tancament d’aquesta fase: verificació completada, objectiu parcial

- Recuperació de sessió invàlida: proves, tipus, ESLint, compilació i activació
  verificats; cas real de sessió invàlida no exercitat.
- Indicació d’autenticació del servidor a App: compilació, límits de mida,
  tipus, 17 proves inicials, una prova d’integració, activació i pantalla Login
  al navegador verificats; ESLint de la nova prova també verificat.
- Instrumentació optativa de temps del calendari: implementació, proves,
  Ruff, mypy, activació i mesura real amb accés a dades verificats.
- Mostreig Python optatiu dins del procés: implementació, 35 proves de la
  bateria, Ruff, mypy, activació i captures del graf i calendari verificats.
  Els trams locals no explicats continuen oberts.
- Correccions de descodificació JSON, admissió a la cache de metadades i
  descobriment estàtic de Google: implementades, 80 proves úniques, Ruff,
  mypy, diff i activació verificats. Primeres obertures directes mesurades
  sense mostreig i navegacions en calent verificades.
- Transport HTTPS, redirecció HTTP i cache immutable de recursos verificats.
- Neteja final dels elements temporals d’auditoria i restauració de la vista
  mensual completades. La latència general continua per sobre de 0,5 s;
  l’estat de l’objectiu es manté parcial.

## Correcció de les esperes observades a l’adreça habitual

El servei habitual de `https://localhost:5173` serveix ara una còpia independent
de la compilació, amb la mateixa API i el mateix certificat. Les eines de
transformació de desenvolupament ja no intervenen en cada navegació. El mode
de desenvolupament continua disponible de manera explícita. L’instantani inclou
els fitxers enllaçats, conserva els recursos durant altres compilacions i
s’elimina en aturar el procés que el posseeix.

En aquesta passada s’han eliminat altres treballs repetits:

- La resolució simultània d’una identitat d’espai espera una mateixa tasca
  asíncrona; els seguidors no ocupen fils bloquejats. Comprovar una carpeta
  existent ja no intenta crear-la de nou.
- La ruta pública de salut no resol l’espai indicat per galeta, capçalera o
  consulta: respon amb la instantània global d’arrencada. Només s’exclou aquesta
  ruta GET exacta; la resta conserva la resolució i els controls d’accés.
- L’autodetecció de la política d’accés comparteix la lectura en curs. Els
  seguidors HTTP esperen al bucle asíncron; la caducitat continua sent de cinc
  segons des de l’inici. Un reset retira la generació anterior i les variables
  explícites es tornen a comprovar abans de retornar. Les sessions DB explícites
  mantenen la comprovació fresca i un error continua exigint autenticació.
- La preparació de directoris de configuració reutilitza durant 30 segons
  comprovacions correctes, amb un límit de 256 rutes; errors i canvis de selecció
  conserven els reintents. Les lectures directes de rutes mantenen la reparació.
- El graf revalida les fonts als 30 segons i conserva la resposta codificada
  quan no han canviat. La cache persistent de nodes verifica la revisió semàntica
  i el resum del JSON real. Només les lectures completes poden certificar-la.
  Les metadades laterals petites i correctes es reutilitzen després de comprovar
  la seva identitat i dates; els errors no es retenen.
- El navegador demana l’índex global només quan els filtres de camps el necessiten,
  amb consultes separades per espai. Sigma rep la projecció i els filtres abans
  d’indexar-la; la data inicial ja no reinicia immediatament la física del graf.
- Fotos valida el conjunt complet de 57.150 entrades persistides i prepara rutes
  només per als elements seleccionats. Filtres i ordenacions encara recorren
  totes les dades quan cal. L’arbre comparteix lectures simultànies i limita
  globalment a quatre les exploracions de directoris, sense retenir resultats
  completats d’una petició a l’altra.
- Google Calendar comparteix només la lectura de credencials que encara està
  en curs per al mateix compte i revisió. Cada consumidor construeix el seu
  client. Llegir la ruta local dels recordatoris ja no carrega la configuració
  de l’espai ni prepara directoris.

- El calendari conserva una instantània completa de les fonts locals per espai
  i la revalida a cada obertura. Els esdeveniments ja disponibles es mostren
  mentre arriba l’actualització, identificada amb un indicador d’activitat.
  Una resposta parcial no substitueix l’última instantània completa; els errors
  continuen visibles amb reintent. La primera resposta parcial pot mostrar
  notes útils. Les consultes, els recordatoris i les invalidacions tardanes
  queden separats per espai, sense ampliar els 30 segons de frescor externa.

Les 36 proves finals del calendari cobreixen el remuntatge real de FullCalendar
amb quatre respostes ajornades, dades envellides del mateix rang, errors parcials,
canvis d’espai i mutacions tardanes. Han passat després de substituir una API de
cancel·lació absent a jsdom per un controlador amb neteja de listener i temporitzador.

Validació d’aquesta passada: 35 proves de calendari/recordatoris/identitat,
29 de Fotos i 32 de graf a la interfície. Les dues proves de línia temporal
s’han repetit després de l’últim ajust de les seves esperes. Han passat també
les bateries de persistència/revalidació del graf, les 124 proves dels scripts
d’arrencada, les 18 d’instantani natiu i les 21 de configuració de Vite.
La comprovació completa de tipus de la interfície, ESLint, Mypy dels mòduls
modificats i la compilació amb els controls de contracte i mida són correctes.
La mida estàtica inicial continua en 538.828 B. La darrera bateria afegeix
116 comprovacions de política d’accés, salut i encaminament; Mypy dels tres
mòduls implicats també és correcte.

### Comprovació del calendari amb continuïtat de dades

| Component | Visible amb dades disponibles | Actualització completa |
| --- | --- | --- |
| Calendari, tres reobertures | 0,306 / 0,210 / 0,212 s | 0,658 / 0,639 / 1,744 s |
| Graf complet | 1,618 s | 1,618 s |
| Complements instal·lats | 0,179 s | 0,421 s |
| Planificació, 67 controls i 834 opcions | 0,843 s | 0,843 s |
| Fotos amb índex vigent, 50 elements i tres imatges visibles | 0,525 s | 0,525 s |

Les reobertures del calendari han mostrat els esdeveniments mentre s’actualitzaven
les fonts, amb dos esdeveniments a la vista diària i 24 a la mensual. La primera
obertura del document ha necessitat 8,084 s i queda separada d’aquestes mesures.
Uns 1,6 s de les dues peticions inicials transcorren abans de `requestStart`;
no es compten com a temps de servei del backend ni se’n dona per provada la causa.
La mesura del formulari exigeix totes les opcions: tenir els controls buits als
0,193 s no és càrrega completa.

La prova ha detectat un altre límit concret a Fotos: l’índex anterior caducava
al voltant de les 21:57, després de 24 hores. La mateixa clau d’índex ha necessitat
113,6 s per reindexar les 57.150 entrades, acabant a les 22:04:03. La validació de
les files és correcta i no hi ha canvi de clau; el bloqueig prové de l’escaneig
síncron quan venç el termini. La primera visita de Fotos queda registrada com a
incompleta al navegador; la mostra de 0,525 s és posterior a la reindexació.

La sèrie conserva el pic complet de 22,384 s del graf: diverses peticions de
configuració i dades van esperar uns 21 s. Un altre intent de graf es va abandonar
abans de rebre l’API i queda identificat com a incomplet. Durant la revisió, les
dades del graf van passar de 2.509 nodes / 7.250 arestes a 3.237 / 7.244, amb un
resum diferent i reconstrucció verificada; aquesta petició d’11,321 s no és una
mesura de reutilització sobre dades immutables. La revalidació anterior sense
canvis havia costat 1,756 s. No s’ha inspeccionat l’origen concret del canvi de
dades ni s’atribueixen causalment els pics a una única observació de memòria.

El compte de correu continua fora de l’abast. Les sèries de les seccions següents
són històriques i no descriuen totes aquesta última activació.

### Correcció de la caducitat diària de Fotos

La ruta de Fotos retorna ara l’últim índex complet quan venç el termini de
24 hores i encarrega l’actualització a dos treballadors, amb un màxim de vuit
tasques en curs o pendents. Les peticions de la mateixa clau comparteixen la
tasca. La primera exploració d’una biblioteca sense índex encara ha d’acabar
abans de mostrar-ne les dades.

La interfície identifica l’actualització, conserva les fotos davant d’un error
i permet reintentar després del termini indicat. Comprova el resultat cada cinc
segons, com a màxim 60 vegades. Canviar d’espai, carpeta o filtre cancel·la les
lectures de la selecció anterior. Si l’índex canvia durant la paginació, recupera
el conjunt ja carregat i el substitueix complet: no barreja versions. Un cursor
de posició independent dels elements retornats permet avançar encara que alguns
fitxers hagin desaparegut.

Una exploració parcial no es publica com a índex complet. La persistència és
atòmica i les invalidacions impedeixen que una tasca antiga torni a publicar.
Si falla l’escriptura de cache, una exploració completa continua disponible en
memòria. Els índexs històrics conserven el format i passen validació estructural;
el format antic no permet demostrar retrospectivament que una exploració no
fos parcial.

Validació final d’aquesta correcció: **70 proves de servidor i 45 de la
interfície**, Mypy de cinc mòduls, tipus dels fitxers afectats i dependències,
i ESLint correctes. Les dues proves de capçaleres i cursor s’han repetit després
de l’últim ajust de tipus. La compilació final ha passat en 50,72 s, amb els
controls de contracte, idiomes i mida; la mida estàtica inicial continua en
538.828 B. La caducitat, les exploracions lentes, els errors i les invalidacions
s’han provat amb dades aïllades. No s’ha alterat ni fet caducar expressament
l’índex real per repetir l’escaneig de 113,6 s.

La correcció està activada al servidor natiu i a la interfície compilada amb
HTTPS verificat. La consulta HTTP real retorna 50 elements de 57.150, estat
`fresh`, revisió present i cursor 50, en 0,702 s. La comprovació visible ha
mostrat les 50 targetes i les tres imatges visibles carregades, sense errors.

| Comprovació final després de l’activació | Visible amb dades | Actualització completa |
| --- | --- | --- |
| Fotos, primera obertura del document | 29,128 s | 29,128 s |
| Calendari, primera visita d’aquesta sessió | 19,976 s | 19,976 s |
| Fotos, reobertura | 1,982 s | 1,982 s |
| Calendari, reobertura | 0,484 s | 6,160 s |

Aquesta passada confirma la funcionalitat però **no resol els pics generals
de latència**. La primera petició de salut ha inclòs 3,712 s abans de
`requestStart` i 8,332 s fins al primer byte; el catàleg d’espais ha trigat
11,570 s des de `requestStart` al primer byte. Les lectures de Fotos no comencen
fins als 20,734 s. Les fonts locals del primer calendari han necessitat 5–7 s
i les lectures externes 16–18 s. Les mesures lentes es conserven i no es
substitueixen per les reobertures més ràpides. El calendari reobert sí que mostra
les dades anteriors durant l’actualització, tal com es pretenia.

Una comprovació posterior de només lectura ha retornat sis respostes de salut
200: 104–361 ms directament i 189–857 ms a través del frontal, amb 55–708 ms de
negociació TLS. No ha reproduït l’espera de vuit segons. El Mac mostrava
19,18 GiB de swap, 60–64 MiB de memòria lliure i 7,1–7,5 GiB al compressor.
Entre dues lectures han augmentat 5,58 GiB les entrades de swap i 4,98 GiB les
sortides; són diferències entre mostres, no taxes per segon. La pressió de
memòria és compatible amb pauses globals, però no demostra la causa dels pics
ni identifica una altra correcció concreta del codi.

La instrumentació temporal s’ha retirat i s’ha restaurat el document compilat.
HTTPS retorna 200 amb verificació del certificat correcta; HTTP retorna 307
cap a HTTPS conservant el camí i la consulta. El document final no conté el
client de desenvolupament ni el script de mesura; el navegador no conserva
l’atribut de l’auditoria després de recarregar l’adreça neta.

## Continuació: bloquejos del servidor i recàrregues

Una captura nativa de 30 segons durant la càrrega del calendari ha recollit
51 respostes de salut correctes, amb mediana de 32 ms i màxim de 853 ms. El fil
principal estava esperant esdeveniments de xarxa en 1.674 de 2.644 mostres;
també hi havia esperes pel GIL. La captura no ha reproduït la pausa llarga
anterior. Els frames imbricats de les piles no són temps independents que es
puguin sumar.

S’han corregit dos bloquejos demostrables amb proves sintètiques: la notificació
síncrona d’un error podia retenir el fil principal mentre escrivia fitxers,
SQLite o cridava la notificació nativa; l’inici diferit del planificador també
hi feia I/O. Ara totes dues operacions s’executen en un treballador. La
cancel·lació de l’inici espera que el treballador acabi abans d’aturar el
planificador, per evitar un inici posterior a l’aturada. Es conserven el context
de l’espai i la resposta 500 sense contingut privat. Han passat 14 proves i
Mypy dels dos mòduls. Els canvis ja estan activats; no es presenten com a causa
provada del pic anterior.

La recàrrega del calendari amb la versió anterior ha fet **121 consultes de
recursos compilats**, totes amb transferència indicada pel navegador: 36.300 B
de transferència agregada i 1.488.184 B de contingut descodificat. El recurs
inicial retornava `Cache-Control: no-cache`. El calendari ha mostrat dos
esdeveniments als 10,838 s, amb l’última lectura necessària als 10,613 s.

La compilació inclou ara el manifest de Vite i el servidor reconeix exactament
els seus recursos amb hash. Només aquests fitxers públics poden usar cache
immutable en GET/HEAD i respostes 200, 206 o 304. HTML, API, recursos inexistents,
altres mètodes i reescriptures cap a HTML queden exclosos. Un canvi de contingut
produeix una URL diferent. Un instantani antic sense manifest conserva la
política anterior. Han passat 45 proves, inclosa una integració amb Vite real,
la comprovació de tipus dels fitxers afectats i ESLint.

La versió està activada amb HTTPS verificat. La compilació completa ha passat
en 13,15 s; el canvi final de la guarda de capçaleres només afecta el middleware
que es carrega en arrencar preview. Després d’aquest ajust s’han repetit les
45 proves, incloses dues compilacions mínimes reals, tipus i ESLint.

| Document del calendari | Amb dades i actualització completa | Recursos compilats reutilitzats | Transferència d’aquests recursos |
| --- | --- | --- | --- |
| Abans de la nova política | 10,838 s | 0 de 121 | 36.300 B |
| Primera recepció de les noves capçaleres | 4,852 s | 0 de 121 | 497.910 B |
| Recàrrega posterior | 1,178 s | 121 de 121 | 0 B |
| Segona recàrrega posterior | 1,218 s | 121 de 121 | 0 B |

Les tres visites finals mostren dos esdeveniments i cap error. La reutilització
dels 121 recursos sense transferència està comprovada directament. La durada
total també inclou les dades: l’API d’esdeveniments passa de 2,365 s a 0,199 i
0,224 s en les dues recàrregues, amb dades ja en cache. No s’atribueix tota la
millora de la pàgina a la nova política, ni es dona per resolt el pic històric
de 29 s o garantit l’objectiu general de 0,5 s.

La instrumentació s’ha retirat. L’adreça habitual queda oberta amb 24
esdeveniments a la vista mensual, sense errors ni actualitzacions pendents.
HTTPS i la redirecció s’han tornat a verificar; el document HTML conserva
`no-cache` i els recursos compilats la política immutable.

## Millores addicionals: arrencada, graf i fotos

Les seccions següents són històriques; l’última comprovació dels pics restants
es recull a «Continuació: bloquejos del servidor i recàrregues».

El compte de correu queda **fora de l’abast**, tal com ha demanat l’usuari.
Les millores següents estan implementades i validades; el límit general de 0,5 s
continua pendent.

- L’arrencada prepara les rutes sense generar anticipadament la documentació de
  l’API. En una prova amb l’app real i dades temporals, preparar les rutes ha costat
  10,187 s; generar després l’esquema ha afegit 16,635 s. Aquest segon treball ja no
  retarda la disponibilitat del servei. Els 452 camins i el contingut de l’esquema
  coincideixen exactament amb el contracte publicat. Es mantenen permisos,
  validació de peticions/respostes i compatibilitat amb encaminadors antics.
- El graf reutilitza l’esquema de les pàgines sense taula i calcula cada color de
  grup una vegada. La física construeix directament les dades D3, sense una còpia
  addicional de Graphology. El benchmark sintètic de preparació passa de 28,38 a
  5,01 ms amb 1.000 nodes i de 73,34 a 14,33 ms amb 5.000 nodes (5,1–5,7 vegades
  més ràpid). Això mesura preparació, no la càrrega completa de la pantalla.
- Les fotos comproven contenció, tipus i metadades fora del bucle principal,
  sota el límit de concurrència existent. FileResponse reutilitza la mateixa
  lectura de metadades. La galeria manté tots els elements, comparteix un observador
  amb marge de 160 px i evita el retard d’animació acumulat. Fonts originals,
  recuperació d’errors i comprovacions de contenció es conserven.

La primera API de graf observada abans dels canvis ha costat 27,820 s; després
reiniciar, 10,475 s, amb els mateixos 2.509 nodes i 656.492 bytes comprimits.
Les lectures immediatament repetides han costat 186 i 26 ms. És una observació
amb càrrega variable, **no una comparació causal controlada**. La instrumentació
optativa `X-Gnosi-Graph-Timing: 1` retorna només temps i recomptes agregats.
Ha separat 4,700 s de càrrega de cache, 2,163 s de pàgines, 1,414 s de JSON i
0,530 s de compressió en aquella primera petició. La mateixa cache (2,97 MB,
1.884 entrades) s’ha llegit posteriorment en 2 ms i interpretat en 72 ms; aquesta
lectura en calent no explica tota l’espera inicial.

### Passada visible de la nova compilació

| Comprovació | Temps fins al contingut complet |
| --- | --- |
| Graf, tres navegacions amb altres comprovadors actius | 17,679 / 7,962 / 11,581 s |
| Graf, després d’acabar els altres comprovadors | 8,149 s |
| Fotos visibles, tres navegacions | 6,677 / 0,985 / 0,588 s |
| Fotos i arbre de carpetes complets | 6,677 / 1,671 / 0,736 s |
| Document complet de calendari, vista diària | 16,595 / 4,627 s |

La vista utilitzada mesura 596 × 784 px: conté tres fotos visibles i una targeta
no fotogràfica, amb 50 elements totals. Les cinc peticions d’imatge per navegació
inclouen les fonts properes al límit visible. No és comparable directament amb
les 19 fotos visibles de la passada anterior. S’ha obert i tancat una foto
inicialment fora de pantalla; després del desplaçament hi havia 15 imatges
carregades, sense errors ni recuperacions pendents. El calendari diari ha mostrat
els seus dos esdeveniments; en seleccionar el mes, els 24 esdeveniments complets.
Un graf reutilitzat abans de rebre la resposta nova no s’ha comptat com a dades
fresques.

El Mac ha arribat a 19,8 GB de memòria d’intercanvi ocupada. Les primeres mesures
coincidien amb comprovadors d’altres feines; la darrera del graf ja no, però
continuaven actives altres aplicacions. Per tant, la primera càrrega **encara no
és estable** i aquesta passada no acredita una millora general dels temps visibles.

Validació: 70 proves backend diferents i 52 frontend; comprovació completa de
tipus frontend, Mypy dels set mòduls modificats, ESLint i compilació amb límits
de mida correctes. La bateria final de compatibilitat i cicle de vida inclou
10 proves, ja comptades dins les 70 del backend. La mida estàtica inicial es
manté en 538.828 B.

La documentació valida 31 pàgines revisades i nou generades; `diff --check` és
correcte. S’ha aturat i eliminat la previsualització temporal. Gnosi queda a
HTTPS 5173 (certificat verificat), amb HTTP→HTTPS 307 i el calendari mensual
amb 24 esdeveniments, sense alertes ni càrrega pendent. La pàgina habitual no
conté instrumentació temporal.

## Resultat anterior dels cinc punts

| Punt | Canvi i evidència final | Límit pendent |
| --- | --- | --- |
| 1. Planificació i Fotos | Historial disponible sense errors; 19 de 19 fotos visibles carregades, inclosa una recuperació 503→200. | No s’ha comprovat cada fitxer fora de la pantalla. |
| 2. Esperes de dades | Graf comprimit i lectures compartides; selectors compactes; correu i paginació publiquen cada compte disponible i conserven errors explícits. | Un compte de correu esgota la connexió; no s’ha recuperat la seva disponibilitat. |
| 3. Primera càrrega | Preparació solapada, peticions compartides i recuperació explícita després del timeout del catàleg. | L’arrencada continua variable; una obertura completa de taula ha necessitat 5,20 s per a dades i controls. |
| 4. Cobertura funcional | 19 apartats d’ajustos, dues taules, pàgina i tauler personalitzat, tauler principal, editors de complements i detalls d’article, correu i quadern. | És cobertura representativa, no cada registre, vista o complement desactivat. |
| 5. Acceptació repetida | Tres càrregues completes de calendari, graf i lector, amb mínim/mediana/màxim separats de les observacions inicials. | El límit general de 0,5 s no passa. |

## Mesures de la compilació final

| Component | Mostres completes | Mínim | Mediana | Màxim |
| --- | ---: | ---: | ---: | ---: |
| Calendari | 3 | 0,685 s | 0,806 s | 3,525 s |
| Graf | 3 | 2,289 s | 2,429 s | 6,004 s |
| Lector | 3 | 0,907 s | 1,133 s | 1,225 s |

S’ha exclòs un intent de calendari abandonat abans de rebre els esdeveniments.
No s’han convertit aquestes mostres petites en percentils. En aquestes mesures
no hi havia proves ni compiladors d’aquesta revisió en marxa; continuaven actives
altres aplicacions i hi havia pressió de memòria. No són una comparació controlada
amb la primera sèrie.

Observacions addicionals: Planificació 0,425 s; catàleg de complements 0,293 s;
configuració de Planificació verificada a 1,54 s amb set desplegables habilitats
i 834 opcions; fotos visibles 5,688 s; dues taules amb 12 i 19 files a 5,195 s
(obertura completa) i 1,952 s (navegació), respectivament. Aquestes dues últimes
mesures acrediten dades i controls, no totes les miniatures.

El correu ha mostrat els missatges dels comptes disponibles a 3,195 s i 1,479 s
en dues navegacions; els seus recomptes estaven disponibles a 3,274 s i 3,196 s.
El compte restant ha quedat explícitament no disponible aproximadament als
21–22 s, amb 503 en recomptes i error de proveïdor en llistat. S’han conservat
els 20 missatges visibles dels altres comptes. Aquestes són mesures de
**disponibilitat parcial**, no càrregues completes de tots els comptes.

Un article ha mostrat el cos als 0,223 s. El detall d’un quadern existent ha
mostrat contingut i 68 controls als 2,494 s; el catàleg conté dos quaderns.
S’ha obert un correu ja llegit: resposta de detall 0,780 s i cos renderitzat
en iframe, sense atribuir-li un temps de navegació complet perquè aquest clic
no reiniciava el comptador temporal. El tauler principal ha mostrat contingut
i 56 controls als 1,928 s. «Configura» d’Automatitzacions ha obert IA →
Automatitzacions amb set controls, sense pantalla buida.

La comprovació completa de tipus frontend, la compilació final i els límits
de mida han passat. La compilació ha validat API, quatre idiomes, notes de versió
i 14 casos de configuració Vite. Mida estàtica inicial: 538.828 B; correu:
727.009 B. Les darreres regressions han passat: cinc de complements, cinc de
configuració de Planificació, 16 de llistat/paginació del correu i 27 backend
de disponibilitat/independència de llistat. Les altres bateries es detallen més avall.
La documentació valida 31 pàgines revisades i nou generades.

S’ha retirat la instrumentació i aturat la previsualització temporal del port
5174. L’aplicació habitual ha quedat oberta a HTTPS al port 5173 amb el calendari,
24 esdeveniments visibles i sense càrrega pendent ni alertes.

## Observacions anteriors

Les seccions següents documenten el punt de partida i les comprovacions intermèdies.
Les incidències que s’hi descriuen no substitueixen el resultat final anterior.

## Com s'ha mesurat

S'han observat navegacions reals, les respostes de xarxa i els canvis del contingut
renderitzat. La instrumentació temporal només registra recomptes i temps.
Una pantalla buida, un esquelet, dades antigues en memòria o un formulari pendent
de rebre valors no acrediten una càrrega completa. Els anunciadors accessibles
buits tampoc s'han comptat com a indicadors de càrrega bloquejada.

La columna compilada correspon a una previsualització local temporal al port 5174,
amb el mateix backend. Són observacions de la sessió, no percentils ni una comparació
controlada amb memòries cau equivalents. Les dades i preferències locals del navegador
poden variar entre ports. No hi havia proves ni compilacions d’aquesta revisió executant-se durant les mesures; a la segona sèrie sí que hi havia comprovacions d’una altra feina i pressió de memòria, indicades explícitament més avall.

## Resultats observats

| Pantalla o acció | Desenvolupament, 5173 | Compilada, 5174 | Què acredita la mesura |
| --- | ---: | ---: | --- |
| Calendari, recàrrega repetida | 3,09 s | 2,23 s | Dos esdeveniments visibles i càrrega acabada. |
| Calendari, primera càrrega observada | 34,58 s | 7,02 s | Mostra la variabilitat inicial; no són arrencades en condicions equivalents. |
| Configuració general | ≥2,12 s | ≥0,88 s | Última resposta necessària; el primer formulari apareix abans. |
| Catàleg de complements | 0,83 s | 0,44 s | Catàleg i complements instal·lats carregats. Només aquesta observació compilada entra en 0,5 s. |
| Configuració del complement de planificació | 4,17 s | 0,77 s | Set desplegables habilitats, amb 834 opcions. |
| Correu | 6,25 s | 5,91 s | Llista actualitzada; les darreres etiquetes acaben a 6,30 s i 6,79 s respectivament. |
| Graf | 5,99 s | 6,40 s | Renderitzador present sense indicador de càrrega; dibuix verificat visualment en la sessió nativa. |
| Tauler de control | ≥1,83 s | No repetit | Últimes lectures; el contingut inicial apareix a 1,39 s. |
| Catàleg de Coneixement | ≥2,33 s | ≥1,10 s | Inclou la lectura de configuració de Wiki. |
| Una taula existent | No mostrejada | 3,53 s | Contingut amb 12 files; lectures addicionals fins a 9,88 s. No acredita totes les taules. |
| Lector | No repetit | 4,22 s | Llista d'articles renderitzada. No s'han obert cossos d'articles. |
| Quaderns | No repetit | 0,91 s | Pantalla amb les dades del catàleg. |
| Cerca bibliogràfica | No repetit | ≥2,15 s | Lectura de cerques guardades; no s'ha executat una cerca externa. |
| Social | No repetit | 4,83 s | Les dues llistes carregades; imatges observades fins a 5,14 s. |
| Contactes | No repetit | 0,63 s | Llista renderitzada; imatges i alternatives fins a 1,02 s. Accés verificat amb el teclat. |
| Planificació principal | No repetit | Error | Apareix una alerta cap als 13,09 s; lectures d'historial retornen 500. |
| Fotos | Incidència | No repetit | Nou elements acaben mostrant «No descarregat» després de reintents amb 503. |

Les peticions repetides a un mateix camí no demostren per si soles una duplicació:
per exemple, el correu pot consultar comptes diferents. No s'han conservat els
paràmetres privats per interpretar aquestes peticions com si fossin idèntiques.
Tampoc s'han comptat les imatges fora de pantalla amb càrrega diferida com a errors.

## Els cinc punts de partida

1. **Resoldre les incidències funcionals.** Les lectures de línies base i registres
   de treball fallen a `PlanningStore.history`, en llegir l'historial, amb
   `OSError: [Errno 11] Resource deadlock avoided`. Cal tractar la disponibilitat
   del fitxer sense substituir l'historial per dades buides. A Fotos, cal verificar
   i completar la materialització dels fitxers pendents: els registres confirmen
   peticions de descàrrega i respostes 503, però no que les descàrregues acabin.
2. **Reduir les esperes de dades.** En la sessió compilada, les lectures remotes del
   correu duren aproximadament 3,6–4,8 s; la petició del graf, 4,85 s; els articles
   del lector, 3,42 s. Els ajustos encara esperen les lectures de configuració,
   i el formulari de planificació supera 0,5 s tot i la resposta més petita.
3. **Estabilitzar la primera càrrega.** El calendari repetit és més ràpid que la
   primera càrrega observada. Cal separar inicialització, lectura del catàleg,
   resposta dels serveis externs i temps de renderització abans d'atribuir-ho tot
   al navegador o a la pressió de memòria del Mac.
4. **Completar la cobertura funcional.** Falten pàgines individuals representatives,
   més taules i vistes, taulers personalitzats, els altres apartats de configuració
   i editors de complements, detalls de quaderns/articles/correus i variants de
   navegació compacta amb ratolí. Els desplegables de dades i l'accés a Contactes
   han funcionat amb el teclat; els intents amb punter requereixen una comprovació
   específica abans de concloure si hi ha un problema de l'aplicació o de l'automatització.
5. **Repetir l'acceptació després dels canvis.** Mesurar càrregues inicials i repetides
   amb dades actuals i controls utilitzables, i obtenir distribucions de temps.
   Una observació de 0,44 s del catàleg de complements no permet donar per assolit
   l'objectiu general.

## Canvis previs i validació

La càrrega local i externa del calendari ja se solapa. La configuració de
planificació ja demana referències de pàgina amb identificador i títol: per als
793 registres mesurats, la resposta conjunta passa de 1.130.202 a 67.381 bytes
(94,04 % menys), conservant els identificadors, els títols i el filtratge.
Les mesures de la interfície anteriors mostren que la reducció de mida no garanteix
el pressupost de temps de tota la pantalla.

La validació prèvia del canvi del calendari inclou 17 proves de component,
comprovació de tipus, lint i compilació amb els límits de mida. Aquesta revisió
afegeix comprovacions de navegador; no presenta aquelles proves com a substitut
de l'acceptació de rendiment ni com una suite completa de tota l'aplicació.

## Segona intervenció: els cinc punts

S'han repartit en tres revisions independents la recuperació de Planificació,
la disponibilitat de Fotos i les lectures de graf/correu. La integració afegeix
la revisió de navegació, configuració, arrencada i validació conjunta.

### Correccions incorporades

- Planificació conserva l'error explícit quan un fitxer existent no es pot
  llegir; no el substitueix per un historial buit. Les lectures temporalment
  pendents demanen recuperació al proveïdor i es reintenten amb un límit. Les
  consultes i les dades provisionals queden separades per vault. La selecció
  real del projecte precedeix les lectures de calendari i línies base.
- Fotos distingeix una descàrrega pendent d'una fallada confirmada. La miniatura
  recupera els bytes sense una segona descàrrega, cancel·la en sortir i permet
  reintentar els errors confirmats. La disponibilitat es comprova amb lectura
  real, no amb el nombre de blocs assignats al fitxer.
- El graf comparteix reconstruccions concurrents del mateix vault, evita
  rellegir el registre en encerts de memòria cau i comprimeix fora del bucle
  principal del servidor. El correu separa la connexió de recomptes de carpetes
  de la llista de missatges i només demana les capçaleres utilitzades.
- Els ajustos carreguen taules i bases de dades alhora, mantenint el resultat
  disponible si l'altra lectura falla. El Lector reutilitza el formatador de
  dates de la llista. L'arrencada solapa salut del servidor i preparació de ruta.
- S'ha corregit una capa que tapava els accessos ràpids amb el ratolí en mode
  compacte. «Configura» d'Automatitzacions obre ara IA → Automatitzacions, en
  lloc de seleccionar un apartat inexistent i deixar els ajustos buits.
- El servei natiu evita una reinstal·lació automàtica de dependències en
  reiniciar-se si una altra feina ha canviat els manifests del projecte.

### Cobertura addicional

En el navegador s'han obert els 19 apartats disponibles d'ajustos, sense alertes
de càrrega. Notes diàries ha mostrat dos desplegables amb 18 opcions; captura
web, quatre amb 55 opcions; Wiki, 45 controls amb 238 opcions. No s'han canviat
valors ni activat complements. Genogrames i Importar Notion estaven desactivats
en el catàleg; aquesta revisió no els activa per simular una cobertura real.
La comprovació amb ratolí de Contactes ha confirmat l'accés després de corregir
la capa superposada. Les comprovacions de contingut dels altres components i
les mesures finals es documenten a continuació un cop acabades.

Les proves addicionals inclouen 43 casos de cicle de vida i navegació de pàgines,
taules i vistes incrustades amb renderitzadors reals; 23 de configuració, inclòs
el clic real d'Automatitzacions sense escriptures; 20 d'arrencada i agrupació de
peticions; 12 de Lector; 17 de Fotos; i 12 de Planificació, inclòs el canvi de
vault amb respostes pendents. Les 14 proves de compressió cobreixen també el
rebuig 406 quan el client no accepta cap codificació disponible. Les proves
backend de recuperació i correu/graf consten als resultats dels tres treballs.
Ruff i Mypy han passat sobre els deu fitxers backend integrats.

La primera comprovació completa de tipus frontend ha passat. Una repetició
posterior ha detectat dos errors en la feina concurrent de genogrames; s'ha
coordinat la integració amb aquella feina i es registra separadament la
compilació final. Cap resultat anterior acredita automàticament l'estat de
fitxers modificats després.

### Compilació i arrencada observada

La compilació anterior a les darreres correccions de correu i complements ha passat, inclosos contracte API, frontera API, quatre
idiomes, notes de versió, 14 proves de configuració Vite i límits de mida.
Mides sense comprimir: entrada 21.521 B; petició inicial 83.336 B; conjunt
estàtic inicial 538.770 B; correu 724.853 B; calendari 960.269 B; fragment
més gran 1.375.866 B. No s'han incrementat els límits per fer passar aquesta
validació.

Els dos serveis natius han estat reiniciats. Han acabat responent 200; HTTPS
verifica correctament el certificat i HTTP retorna 307 a HTTPS. L'arrencada del
backend ha trigat diversos minuts mentre hi havia comprovadors d'altres feines
actius. Una mostra d'un segon ha trobat un worker en Pydantic i recollida de
memòria, coherent amb preparació d'OpenAPI. No acredita que aquesta fase expliqui
tota l'espera; no s'han canviat globalment els paràmetres de memòria a partir
d'aquesta única mostra.

Per evitar canvis de fitxers durant la prova, s'ha servit una còpia temporal
independent de la compilació. Les primeres observacions de la segona intervenció
s'han fet amb càrrega concurrent i no constitueixen una comparació controlada
amb les xifres anteriors. En aquesta situació fins i tot salut del backend i
HTML natiu han trigat 5,44 s i 4,25 s. No es poden atribuir aquestes esperes
només als proveïdors externs.

Planificació ha recuperat les dues lectures d'historial: 503 pendent seguit de
200, sense alerta final. Fotos ha arribat a mostrar 16 imatges visibles
correctes, dues pendents i una fallada visible. Això és recuperació parcial,
no confirmació que tots els fitxers hagin acabat de baixar.

### Distribució de les observacions sota càrrega concurrent

S'han separat les recàrregues completes de les navegacions del menú. El temps
arriba fins al primer fotograma amb contingut després de les respostes
necessàries; exclou recordatoris periòdics que arriben quan la pantalla ja és
utilitzable. Són mostres petites d'una sessió amb pressió de recursos, no p 95
ni estimacions d'una màquina en repòs.

| Component | Mostres de navegació | Mínim | Mediana | Màxim | Estat |
| --- | ---: | ---: | ---: | ---: | --- |
| Calendari | 3 | 2,734 s | 3,626 s | 18,118 s | 24 esdeveniments, sense alertes. |
| Lector | 3 | 8,458 s | 9,348 s | 9,769 s | 500 articles renderitzats. |
| Planificació | 2 | 0,677 s | — | 5,665 s | Historial recuperat, sense alertes. |
| Graf | 2 completes | 5,620 s | — | 17,650 s | Nou superfícies de dibuix, sense càrrega pendent. Una altra mostra només acredita resposta API als 45,95 s. |
| Correu | 3, abans de la correcció final | — | — | — | No acrediten frescor: s'ha detectat fallback silenciós i un recompte 500. |

Les recàrregues completes separades han donat 14,898 s per al calendari i 18,359 s
per a Planificació, aquesta última incloent recuperació 503→200 de l'historial.
Aquests resultats **no acrediten una millora general ni el límit de 0,5 s**.
S'han guardat les observacions sense contingut privat a
[navigation-latency-observations-2026-09-08.json](navigation-latency-observations-2026-09-08.json).

### Incidències addicionals descobertes durant la cobertura

Una pàgina favorita i un tauler personalitzat s'han obert amb editor i contingut,
sense error ni indicador de càrrega pendent. L'intent posterior d'obrir una
taula ha quedat bloquejat durant l'arrencada: no s'ha registrat error JavaScript;
la recàrrega ha rebut salut als 28,3 s i catàleg de vaults als 47,6 s, i després
les lectures d'autenticació/complements han esgotat els 10 s. El codi ignorava
`loadError` del catàleg i continuava mostrant només «Carregant» indefinidament.
S'ha afegit una recuperació explícita als dos punts que mantenen tancades les
funcions fins a conèixer l'estat dels complements. Aquest cas de taula no es
compta com una validació funcional satisfactòria.

La revisió del correu ha confirmat que una fallada IMAP podia convertir-se en
llista buida 200 i quedar desada a la cache. També s'esperaven tots els recomptes
abans de publicar els que ja havien respost. La correcció conserva errors
explícits, evita cachejar la fallada, publica els comptes disponibles i identifica
els pendents o no disponibles sense convertir-los en zero. El límit exterior
és 30 s; els GET de Microsoft tenen, a més, límit de connexió de 20 s. Les durades
observades d'uns 25 s no s'interpreten com un timeout configurat exactament de 25 s.

Aquesta darrera correcció del correu té 38 proves backend i 7 frontend passades.
La validació de documentació ja passa:31 pàgines revisades i 9 generades. La
validació conjunta final i la comprovació de recuperació del catàleg es registren
després; no es reutilitzen les captures antigues com si verifiquessin aquests
últims canvis.

### Tancament de les regressions detectades

La recuperació del catàleg té cinc proves passades: timeout, clic real de reintent,
rebuig, respecte de l’autenticació, i canvi de vault amb lectures o mutacions
pendents. Les respostes i els retrocessos del vault anterior ja no s’apliquen
al vault actual. El controlador de configuració de Planificació té cinc casos
passats: les lectures de taules i referències es cancel·len i es tornen a fer
en canviar de vault, fins i tot amb identificadors de taula iguals.

Els recomptes de correu comparteixen només lectures de la mateixa generació:
una invalidació per acció de l’usuari impedeix reutilitzar i publicar el resultat
anterior. Les 27 proves conjuntes de disponibilitat i independència de llistat
han passat, així com Ruff i Mypy dels dos fitxers d’aquesta darrera correcció.
La paginació publica cada compte quan respon i conserva cursor, missatges i
selecció si falla un altre compte; el reintent consulta només les pàgines
fallides. Les 16 proves de llistat, accions i dades passen, inclosos els dos
casos nous d’error HTTP i de proveïdor.

El servidor natiu s’ha reiniciat amb aquests canvis. La comprovació ha obtingut
200 en salut i HTTPS amb verificació de certificat correcta, i 307 d’HTTP a HTTPS.
La memòria d’intercanvi ocupada del Mac era aproximadament 18,3 GiB; les mesures
posteriors no representen una màquina en repòs. No s’han aturat les aplicacions
ni les màquines virtuals de l’usuari.
