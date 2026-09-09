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

# Revue du chargement du 8 septembre 2026

L’objectif de charger tous les écrans avec leurs données en 0,5 s **n’est pas encore atteint**.
La vérification a repris avec le Mac déverrouillé, le backend natif et le navigateur
intégré. HTTPS fonctionne avec vérification du certificat local ; HTTP renvoie 307
vers HTTPS sur le même port 5173.

## Phase du 9 septembre : attente initiale réduite, chargement complet encore lent

L’objectif reste d’afficher les données nécessaires de chaque écran en 0,5 s,
première ouverture comprise. **L’état reste partiel : une amélioration globale
suffisante n’a pas été démontrée.** Les corrections sont actives et validées,
et le nettoyage de l’audit est terminé. Les dernières ouvertures directes ont pris
22,128 s pour le graphe et 16,081 s pour le calendrier ; à chaud, 7,447 s pour
le graphe et 5,392 s jusqu’aux données fraîches du calendrier. Les 398 ms pour
voir les données déjà chargées du calendrier ne correspondent pas à des données
fraîches. La lecture initiale de 63,577 s et les séries du 8 septembre sont
conservées comme historique, sans attribuer de causalité aux comparaisons non contrôlées.

La mesure précédente, cache navigateur vide, comprenait 121 ressources compilées ;
115 avaient démarré avant l’envoi des API initiales. Santé et espaces commençaient
à 1.709 ms, mais `requestStart` arrivait à 6.553 ms : 4.843 ms d’attente, avec
DNS, connexion et TLS à zéro. Cela établit une attente avant le service, mais
ne démontre pas à lui seul une limite précise de streams HTTP/2.

Deux changements sont maintenant actifs : laisser un tour au navigateur pour
envoyer les requêtes initiales avant le chargement des routes et du shell, sans
attendre leurs réponses ; et regrouper explicitement 51 petites icônes du shell.
Le cache immutable des ressources compilées est conservé. La comparaison des
manifestes montre :

| Graphe statique compilé | Avant | Après |
| --- | ---: | ---: |
| Entrée et bootstrap : chunks | 84 | 36 |
| Entrée et bootstrap : octets | 538.828 | 529.350 |
| Avec Calendrier : chunks | 112 | 64 |
| Avec Calendrier : octets | 963.474 | 952.874 |
| Cycles d’importation dans tout le manifeste | 0 | 0 |
| Entrées dynamiques individuelles d’icônes | 1.546 | 1.546 |

Le catalogue dynamique et les éditeurs lourds n’ont pas été avancés au démarrage.
Activity et Heart, déjà importés statiquement, occupent maintenant deux chunks
de 329 et 353 B hors du groupe : cela explique les 36 chunks au lieu des 34
attendus. Les 67 tests, les contrôles de types et ESLint ainsi que la compilation
complète de 55,83 s de cette activation ont passé.

Le test à froid sur le port 5187 enregistre des attentes de 13/12 ms et seulement
neuf ressources avant l’envoi initial, mais l’API des espaces renvoie 401 : **il
est exclu des mesures fonctionnelles du calendrier**. La première activation sur
`localhost` renvoie aussi 401 et affiche la récupération de configuration, avec
3/3 ms d’attente ; ce n’est pas non plus un chargement fonctionnel terminé.
La lecture avec accès aux données sur `127.0.0.1:5173` a des attentes initiales
de 57/56 ms et 73 ressources compilées, dont 29 réutilisées, mais le serveur
nécessite 47,181 s pour les calendriers et 51,897 s pour les événements.
L’amélioration de l’envoi et de la fragmentation est vérifiable ; cette série
ne permet pas d’affirmer que tout l’écran est plus rapide. L’activation du
frontend avait pris 66,1 s, durée distincte de la navigation. L’instance temporaire
5187 a été retirée. La méthode d’authentification de cet accès n’a pas été vérifiée.

Un profil natif **ultérieur** de 15 s apporte 1.346 échantillons par thread,
comptés exclusivement sans additionner parents et enfants. Le thread principal
passe 55,35% des échantillons à attendre des événements et 35,59% en contention
du GIL ; un worker combine runtime Python et lectures de fichiers. Deux threads
attendent des lectures SSL pendant toute la fenêtre, sans identification des
requêtes correspondantes. Les 21 lectures de santé renvoient 200, avec une médiane
de 175 ms et une plage de 10–779 ms ; le processus occupe 406,1 MB, avec un pic
de 472,1 MB selon le profil. **Ce profil n’explique pas causalement les 51,897 s
précédentes :** elles ne sont attribuées ni au GIL, ni au système d’exploitation,
ni à ces sockets sans preuve supplémentaire.

La récupération d’un cookie de session invalide est activée. Les 18 tests isolés,
les types et ESLint ont passé ; la compilation Vite a pris 1 min 9 s, conserve
zéro cycle d’importation, et l’activation a duré 52,0 s. Ce cas supplémentaire
n’a pas été exercé avec une session réellement invalide dans le navigateur :
il n’est présenté ni comme la solution du blocage actuel ni comme une amélioration
mesurée de latence.

La classification temporaire des réponses 401 sur `localhost` confirme
`authentication_required` sur `/api/vaults` et `/api/vault/plugins`, tandis que
`/api/auth/me` indique `anonymous`. **Aucune session expirée n’a été identifiée.**
Aucune déconnexion ni lecture d’identifiants n’a été effectuée. Le cas actuel
est un accès anonyme à des données exigeant l’authentification. La correction
`authenticationRequired` de `usePlugins` et App est codée pour afficher Login
lorsque le catalogue des plugins l’exige, même si l’instantanée de santé indique
le contraire. Les 17 tests initiaux, la vérification ciblée de types, ESLint des
quatre fichiers examinés et la compilation de 67 s avec les limites de taille
correctes ont passé. Cette compilation comporte 531.032 B statiques au démarrage
et 954.556 B avec Calendrier ; elle conserve 36/64 chunks, zéro cycle et 1.546
entrées dynamiques d’icônes. Un test d’intégration App supplémentaire confirme
que se connecter dans le même espace recharge les plugins et quitte Login.
Ce test et son ESLint ont passé. Le frontend a été activé en 74,2 s avec TLS
vérifié. Sur `https://localhost:5173/@vault/calendar`, le navigateur affiche
Login et plus l’erreur de configuration ; aucun calendrier n’est chargé et
aucune instrumentation temporaire n’est présente. Cela confirme la récupération
de l’écran d’accès, pas un chargement fonctionnel du calendrier. Aucune connexion,
déconnexion réelle ni lecture d’identifiants n’a eu lieu.
Avant l’instrumentation temporelle décrite ci-dessous, le total de ce tour était
de **96 tests uniques réussis** ; les batteries partielles se chevauchent et ne
doivent pas être additionnées comme des cas distincts. La batterie de calendrier
ultérieure est enregistrée séparément, sans en déduire un nouveau total unique.

py-spy 0.4.2 a été installé pour obtenir les noms des fonctions Python. La capture
requiert des privilèges : `sudo -n` confirme qu’un mot de passe est nécessaire.
La boîte de dialogue macOS pour une capture de 15 s sans variables locales a
expiré après 120 s sans autorisation. **Aucune capture n’a été effectuée ni
sauvegardée** (`saved=false`) et aucun mot de passe n’a été lu. Aucun résultat
de cette capture ne reste à analyser et aucune conclusion causale n’en est tirée.

Le diagnostic continue sans dépendre de cette autorisation administrative :
l’instrumentation facultative `Server-Timing` est implémentée sur les routes des
calendriers et événements, activée par `X-Gnosi-Calendar-Timing: 1`. Elle expose
uniquement des durées pour distinguer file d’attente, résolution des identifiants
et HTTP, sans valeurs d’identifiants ni contenu du calendrier. Elle ne propage que
le contexte `CalendarTiming`, sans modifier les contextes d’espace ou
d’authentification ni les résultats des requêtes. Les temps sont inclusifs et
peuvent être concurrents : **ils ne doivent pas être additionnés** pour reconstruire
le total. `cal_total` exclut middleware et validation de réponse et n’équivaut donc
pas non plus à toute la durée HTTP.

Les 35 tests de calendrier ont passé : 9 nouveaux et 26 existants. Les 9 nouveaux
ont repassé après limitation de la propagation du contexte ; cette répétition
n’ajoute pas de cas uniques. Ruff de 7 fichiers, mypy de 6 fichiers de code et
le contrôle des espaces du diff sélectionné ont aussi passé. Le backend a été
activé en 178,8 s ; ce démarrage est enregistré séparément du chargement de
l’interface. La lecture ultérieure du calendrier sur l’adresse de bouclage, avec
accès aux données et copie temporaire instrumentée du frontend, s’est terminée
avec toutes les réponses HTTP 200, un calendrier, deux événements et aucune erreur.
Les données visibles et fraîches sont arrivées à **10.557 ms** ; la requête
d’événements s’est terminée à 10.445 ms. Santé et espaces ont pris 976 et 1.178 ms,
avec 4 ms d’attente. 73 ressources compilées ont été chargées, dont 25 depuis
le cache, avec 322.304 B transférés.

| Requête | Durée HTTP | Attente du serveur | File du navigateur |
| --- | ---: | ---: | ---: |
| Calendriers | 6.037 ms | 5.991 ms | 44 ms |
| Événements | 7.244 ms | 7.193 ms | 45 ms |

| Phase `Server-Timing` | Calendriers (ms) | Événements (ms) |
| --- | ---: | ---: |
| `cal_total` | 5.303,319 | 6.492,143 |
| File du worker | 9,221 | 46,336 |
| Intégrations | 2,905 | 142,198 |
| Lecture des calendriers/événements | 2.215,899 | 6.327,889 |
| Filtrage des calendriers masqués en base | — | 5,467 |
| Identifiants | 824,473 | 692,416 |
| Service (`cal_service`, phase inclusive) | 1.406,349 | 1.210,476 |
| HTTP du fournisseur | 744,555 | 1.048,494 |

Ces phases inclusives et concurrentes ne partitionnent pas le total. La mesure
montre des segments locaux encore inexpliqués ; elle ne permet pas non plus
d’attribuer la différence entre l’attente du serveur et `cal_total`. L’attente
antérieure de 47–52 s n’a pas été reproduite et aucune amélioration intégrale
attribuable à cette instrumentation diagnostique n’est démontrée. La cause des
pics reste ouverte.

L’échantillonnage Python dans le processus est implémenté dans
`backend/utils/request_profile.py`, avec des points d’entrée au calendrier et au
graphe. Le graphe l’active avec `X-Gnosi-Graph-Profile: 1` ; les événements du
calendrier avec `X-Gnosi-Calendar-Profile: 1` et aussi
`X-Gnosi-Calendar-Timing: 1`. Un seul échantillonneur simultané est autorisé,
limité à 15 s à 20 Hz ; il observe le thread principal et les workers explicitement
enregistrés. Il agrège uniquement les chemins normalisés du code, noms de fonction
et numéros de ligne : ni variables locales ou globales, ni arguments, noms de
threads ou contenu utilisateur. Il n’inclut pas de traçage du courrier et ne
requiert pas de permissions administratives.

Le fichier `/tmp/gnosi-request-profile-<id>.json`, avec permissions `0600`, contient
au plus 256 piles de 32 frames, plus le PID et le début monotone. Il est enregistré
automatiquement au bout des 15 s même si la requête reste en cours ; l’attente
d’arrêt est limitée à 250 ms. Si le fichier est déjà disponible à la fin de la
route, la réponse indique son identifiant dans `X-Gnosi-Request-Profile-Id`.

La nouvelle batterie a passé **35 tests** : 6 de l’échantillonneur, 9 des temps
de calendrier, 6 des requêtes du graphe et 14 de compression. Ruff de 6 fichiers
et mypy de 4 ont aussi passé. Cette batterie chevauche les précédentes et ne
s’ajoute pas entièrement au compte de tests uniques. La dernière activation du
backend a pris 199,3 s, séparées du chargement de l’interface, et la copie
temporaire du frontend d’audit est prête. L’instrument a aussi été corrigé pour
inclure les requêtes anticipées qui commencent avant le clic et finissent après.

Lors de la vérification réelle des plugins, 39 contrôles ont été vus, tous
activés : contrôles à 185 ms et données à 710 ms. Le catalogue a pris 489 ms
et les plugins installés 504 ms, avec HTTP 200. Le graphe avait encore son
indicateur de chargement à 29.395 ms ; une lecture ultérieure du DOM montre
9 éléments `canvas`, sans chargement ni erreur. L’instant final n’a pas été
capturé : cette vérification confirme le résultat visuel, mais **ne permet pas
de donner un temps exact de chargement du graphe**.

Dans une nouvelle lecture avec l’échantillonneur activé, le premier résultat
visible du graphe est arrivé à **19.949 ms**, avec 9 éléments `canvas`, sans
erreur ni chargement. `/api/graph` a pris 16.513 ms, dont 16.363 ms d’attente
serveur et 109 ms de file navigateur. C’est une mesure distincte de la vérification
précédente sans instant final.

| Phase du graphe | Durée inclusive (ms) |
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

La capture `/tmp/gnosi-request-profile-ox2798gk.json`, du processus 64601, s’est
terminée sans permissions administratives : 39 échantillons dans une fenêtre
maximale de 15 s, 33 piles agrégées et aucune abandonnée. Les 50 ms sont
l’intervalle nominal ; la fréquence réelle n’a pas été constante. Dans 37 des
39 observations du thread principal apparaît le runner uvloop, avec exécution
interne en C que cette capture ne résout pas : **elle ne distingue pas le repos
du travail en C**. Les workers comprennent 6 observations de lecture/`stat` de
`managed_metadata`, 4 de lecture SQL et 2 de décodage du cache JSON. Ces comptes
ne sont pas des durées et ne peuvent être multipliés par 50 ms pour attribuer
du temps. Les phases du tableau sont aussi inclusives et ne doivent pas être
additionnées comme une partition du total.

La capture suivante du calendrier, `/tmp/gnosi-request-profile-876xneks.json`, du
même processus 64601, contient 34 échantillons, 19 piles agrégées et aucune
abandonnée. Les 34 observations du thread principal montrent de nouveau le runner
en C, sans distinguer repos et travail natif. Les workers montrent des attentes
du coordinateur de tâches (31), du verrou du cache des calendriers (12), de la
résolution d’identifiants en cours (5) et de l’autodétection de l’ancien cache
Google dans `_retrieve_discovery_doc` (5). Ce sont des observations pouvant se
chevaucher, pas des secondes ni des parties additives du total.

Dans cette lecture, l’interface du calendrier est arrivée à **16.653 ms**.
Calendriers a pris 10.523 ms, avec 88 ms de file et 10.431 ms d’attente du
serveur ; événements, 11.637 ms, avec 96 ms de file et 11.539 ms d’attente.

| Phase `Server-Timing` | Calendriers (ms) | Événements (ms) |
| --- | ---: | ---: |
| `cal_total` | 7.426,349 | 8.582,591 |
| File du worker | 96,196 | 2,795 |
| Intégrations | 98,037 | 209,282 |
| Lecture des calendriers/événements | 7.308,173 | 8.252,931 |
| Filtrage des calendriers masqués en base | — | 124,246 |
| Identifiants | 1.763,370 | 1.791,605 |
| Service (`cal_service`, phase inclusive) | 4.415,920 | 4.029,862 |
| HTTP du fournisseur | 2.604,519 | 967,321 |

Ces phases restent inclusives. La différence avec la durée HTTP n’est pas
attribuée par cette capture et les temps continuent de varier entre lectures.

Deux corrections ciblées sont implémentées : décoder le cache JSON avec
`pydantic_core`, avec repli sur la bibliothèque standard, et éviter les évictions
répétées du cache de métadonnées lors des passages K2/N3 au-delà de 512 sidecars,
tout en conservant sa capacité de 512. Le nombre actuel de sidecars **n’est pas
confirmé**. Un test synthétique du décodeur montre environ 40% de CPU en moins,
avec un temps réel variable ; il ne démontre pas que les 6,25 s de
`node_cache_load` sont du temps d’analyse. Une troisième correction fait utiliser
`cache_discovery=False` et `static_discovery=True` au `build` du client Google.
Le code local de `discovery.py` confirme que l’autodétection du cache précédait
la lecture du document inclus dans le paquet ; ce chemin apparaît dans la
capture. Cela justifie de supprimer cette consultation inutile, sans attribuer
à cette fonction toute l’attente observée.

La batterie de 80 tests a initialement donné 75 succès et 5 échecs de fixtures
(4 de gestionnaire de contexte de scan et 1 de paramètre de mock). Les fixtures
ont été corrigées et la répétition des deux fichiers concernés a passé ses
35 cas, dont les 5 échecs : le résultat final est de **80 cas uniques corrects**,
pas 110. Ruff de 7 fichiers, mypy de 3 et le contrôle du diff ont aussi passé.
Le code des trois corrections est stable et validé, et l’activation finale du
backend a pris 185,3 s, séparées de la durée de chargement des pages.

Les premières ouvertures directes avec les trois corrections actives ont été
mesurées uniquement avec `Server-Timing`, sans échantillonnage de piles. Les
ressources compilées étaient déjà dans le cache du navigateur : 64 sur 64 pour
le graphe et 73 sur 73 pour le calendrier, avec zéro octet transféré pour ces
ressources. Ce ne sont donc pas des mesures avec un cache de ressources vide.

| Ouverture directe finale | Graphe | Calendrier |
| --- | ---: | ---: |
| Premier résultat visible | 22.128 ms | 16.081 ms |
| Données fraîches | — | 16.081 ms |
| Fin des requêtes nécessaires | — | 15.882 ms |
| Santé | 1.310 ms | 133 ms |
| Espaces | 2.894 ms | 534 ms |
| File initiale santé/espaces | 2 ms | 2 ms |

Le graphe s’est terminé sans erreur ni chargement. Sa requête a retourné HTTP 200
en 13.856 ms, avec 13.746 ms d’attente serveur et 3 ms de file. Le chargement
du cache des nœuds a pris 338,287 ms : lecture 16,732 ms, analyse 220,779 ms et
hash 3,579 ms. L’observation précédente de 6.254,548 ms avait des conditions
différentes et l’échantillonnage activé : **cette comparaison ne démontre pas
une amélioration causale du chargement total**.

| Phase finale du graphe | Durée inclusive (ms) |
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

Pour le calendrier, la liste a pris 13.387 ms, avec 8 ms de file et 13.377 ms
d’attente serveur. Les événements ont pris 14.252 ms, avec 24 ms de file et
14.227 ms d’attente serveur.

| Phase finale `Server-Timing` | Calendriers (ms) | Événements (ms) |
| --- | ---: | ---: |
| `cal_total` | 10.494,416 | 11.513,481 |
| File du worker | 0,899 | 87,681 |
| Intégrations | 227,858 | 177,671 |
| Lecture des calendriers/événements | 9.827,250 | 11.247,108 |
| Filtrage des calendriers masqués en base | — | 118,618 |
| Identifiants | 394,340 | 443,186 |
| Service (`cal_service`, phase inclusive) | 5.402,739 | 5.660,345 |
| HTTP du fournisseur | 4.009,729 | 899,131 |

Les phases sont inclusives et ne doivent pas être additionnées. `cal_service`
comprend la couche d’accès, l’import de discovery avant les identifiants imbriqués
et la construction du client ; **ce n’est pas une mesure exclusive de `build`**.
L’intégralité des quelque 5,5 s n’est pas attribuée à la construction du client.
Ces lectures conservent des attentes importantes côté serveur et ne démontrent
ni une amélioration globale ni l’objectif de 0,5 s.

Lors de la navigation finale avec des données déjà chargées, le graphe a été
visible à **7.447 ms**, avec 9 éléments `canvas`, sans erreur ni chargement.
L’API a retourné HTTP 200 en 6.410 ms, avec 8 ms de file et 6.319 ms d’attente serveur.

| Phase du graphe à chaud | Durée inclusive (ms) |
| --- | ---: |
| `graph` | 4.305,445 |
| `revalidate` | 4.162,823 |
| `input_sidecars` | 1.075,912 |
| `input_contacts` | 943,582 |
| `input_suggestions` | 50,621 |
| `json` | 1,938 |
| `gzip` | 0,063 |

Le calendrier à chaud a affiché les deux événements à **398 ms**, mais les
données fraîches sont arrivées à **5.392 ms**, avec fin des requêtes nécessaires
à 5.372 ms. Calendriers a pris 4.963 ms et événements 5.048 ms ; toutes les API
ont retourné HTTP 200 sans erreur. Cette distinction entre visibilité et fraîcheur
reste explicite.

La vue finale a été laissée au calendrier mensuel de l’adresse accessible
`127.0.0.1`, sans requête d’audit : 24 événements, un mois, aucune alerte ni
indicateur d’état, sans Login ni instrumentation. La vérification précédente de
`localhost` affichait correctement Login. Aucune action d’authentification n’a
été effectuée. L’HTML de la copie native a été restauré, le script temporaire
de temps retiré et seules les deux captures créées, `ox2798gk` et `876xneks`,
ont été supprimées ; les artefacts temporaires de travail et d’exécution ont
été nettoyés.

La dernière vérification de transport confirme HTTPS sur `localhost` avec HTTP
200, vérification TLS correcte (`verify=0`), HTML `no-cache` et aucune
instrumentation. HTTP renvoie 307 vers `https://localhost:5173/`. Une ressource
compilée renvoie 200 avec `public, max-age=31536000, immutable`. Le swap observé
était de 18.739,81 MiB (18,30 GiB) : c’est un contexte système, **pas une preuve
causale** des temps de chargement. Une lecture ultérieure de `vm_stat` pendant
5,02 s, avec des pages de 16 KiB, confirme du swap actif : entrées de 85,73 MiB/s,
sorties de 81,97 MiB/s, compression de 277,09 MiB/s et décompression de
318,46 MiB/s. Elle établit une activité pendant cet intervalle, sans lui attribuer
toute la latence des endpoints ; aucune autre application n’a été arrêtée.
La possibilité de réutiliser le texte immutable du schéma a été identifiée,
mais ni implémentée ni établie comme coût principal ; ce n’est pas un blocage
d’autorisation.

### Clôture de cette phase : vérification terminée, objectif partiel

- Récupération de session invalide : tests, types, ESLint, compilation et activation
  vérifiés ; cas réel de session invalide non exercé.
- Indication serveur d’authentification dans App : compilation, limites de taille,
  types, 17 tests initiaux, un test d’intégration, activation et écran Login dans
  le navigateur vérifiés ; ESLint du nouveau test également vérifié.
- Instrumentation facultative des temps du calendrier : implémentation, tests,
  Ruff, mypy, activation et mesure réelle avec accès aux données vérifiés.
- Échantillonnage Python facultatif interne au processus : implémentation,
  35 tests de la batterie, Ruff, mypy, activation et captures du graphe et
  du calendrier vérifiés. Les segments locaux inexpliqués restent ouverts.
- Corrections de décodage JSON, d’admission au cache de métadonnées et de
  découverte statique Google : implémentées, 80 tests uniques, Ruff, mypy,
  diff et activation vérifiés. Premières ouvertures directes mesurées sans
  échantillonnage et navigations à chaud vérifiées.
- Transport HTTPS, redirection HTTP et cache immutable des ressources vérifiés.
- Nettoyage final des éléments temporaires d’audit et restauration de la vue
  mensuelle terminés. La latence générale reste supérieure à 0,5 s ;
  l’état de l’objectif reste partiel.

## Correction des attentes observées à l’adresse habituelle

Le service habituel sur `https://localhost:5173` sert maintenant une copie
indépendante de la compilation, avec la même API et le même certificat.
Les outils de transformation de développement n’interviennent plus à chaque
navigation. Le mode développement reste explicitement disponible. L’instantanée
inclut les fichiers liés, conserve les ressources pendant d’autres compilations
et est supprimée à l’arrêt du processus qui la possède.

D’autres travaux répétés ont été supprimés lors de cette passe :

- La résolution simultanée d’une identité d’espace attend une même tâche
  asynchrone ; les suivants n’occupent pas de threads bloqués. Vérifier un
  dossier existant ne tente plus de le créer à nouveau.
- La route publique de santé ne résout pas l’espace indiqué par cookie, en-tête
  ou requête : elle répond avec l’instantanée globale de démarrage. Seule cette
  route GET exacte est exclue ; le reste conserve résolution et contrôles d’accès.
- L’autodétection de la politique d’accès partage la lecture en cours. Les
  suivants HTTP attendent dans la boucle asynchrone ; l’expiration reste de
  cinq secondes depuis le début. Un reset retire la génération précédente et
  les variables explicites sont revérifiées avant le retour. Les sessions DB
  explicites gardent une vérification fraîche et une erreur exige toujours l’authentification.
- La préparation des répertoires de configuration réutilise pendant 30 secondes
  les vérifications réussies, avec 256 chemins maximum ; erreurs et changements
  de sélection conservent les relances. Les lectures directes de chemins gardent la réparation.
- Le graphe revalide les sources à 30 secondes et garde la réponse encodée si
  elles n’ont pas changé. Le cache persistant vérifie la révision sémantique et
  l’empreinte du JSON réel. Seules les lectures complètes peuvent le certifier.
  Les petites métadonnées latérales valides sont réutilisées après contrôle
  de leur identité et dates ; les erreurs ne sont pas retenues.
- Le navigateur ne demande l’index global que lorsque les filtres de champs
  en ont besoin, avec des requêtes distinctes par espace. Sigma reçoit projection
  et filtres avant l’indexation ; la date initiale ne redémarre plus aussitôt la physique.
- Photos valide les 57.150 entrées persistantes complètes et ne prépare les
  chemins que pour les éléments sélectionnés. Filtres et tris parcourent encore
  toutes les données si nécessaire. L’arbre partage les lectures simultanées et
  limite globalement à quatre les explorations de répertoires, sans retenir
  les résultats terminés entre requêtes.
- Google Calendar ne partage que la lecture d’identifiants encore en cours
  pour le même compte et la même révision. Chaque consommateur construit son
  client. Lire le chemin local des rappels ne charge plus la configuration
  de l’espace et ne prépare plus de répertoires.

- Le calendrier conserve une instantanée complète des sources locales par espace
  et la revalide à chaque ouverture. Les événements disponibles sont affichés
  pendant l’actualisation, signalée par un indicateur d’activité. Une réponse
  partielle ne remplace pas la dernière instantanée complète ; les erreurs restent
  visibles avec relance. Le premier résultat partiel peut afficher des notes utiles.
  Requêtes, rappels et invalidations tardives restent séparés par espace, sans
  allonger les 30 secondes de fraîcheur externe.

Les 36 tests finaux du calendrier couvrent le véritable remontage de FullCalendar
avec quatre réponses différées, données anciennes de même plage, erreurs partielles,
changements d’espace et mutations tardives. Ils ont passé après remplacement d’une
API d’annulation absente de jsdom par un contrôleur nettoyant listener et temporisateur.

Validation de cette passe : 35 tests calendrier/rappels/identité, 29 de Photos
et 32 du graphe dans l’interface. Les deux tests de frise ont été répétés après
le dernier ajustement de leurs attentes. Les batteries de persistance/revalidation
du graphe, les 124 tests des scripts de démarrage, les 18 de l’instantanée native
et les 21 de configuration Vite ont aussi passé. Le contrôle complet des types
de l’interface, ESLint, Mypy des modules modifiés et la compilation avec contrôles
de contrat et de taille sont corrects. La taille statique initiale reste
538.828 B. La dernière batterie ajoute 116 contrôles de politique d’accès, santé
et routage ; Mypy des trois modules concernés est également correct.

### Vérification du calendrier avec continuité des données

| Composant | Visible avec données disponibles | Actualisation complète |
| --- | --- | --- |
| Calendrier, trois réouvertures | 0,306 / 0,210 / 0,212 s | 0,658 / 0,639 / 1,744 s |
| Graphe complet | 1,618 s | 1,618 s |
| Plugins installés | 0,179 s | 0,421 s |
| Planning, 67 contrôles et 834 options | 0,843 s | 0,843 s |
| Photos avec index à jour, 50 éléments et trois images visibles | 0,525 s | 0,525 s |

Les réouvertures du calendrier ont affiché les événements pendant l’actualisation
des sources, avec deux événements en vue quotidienne et 24 en vue mensuelle.
La première ouverture du document a nécessité 8,084 s et reste distincte de
ces mesures. Environ 1,6 s des deux requêtes initiales précèdent `requestStart` ;
elles ne sont pas comptées comme temps de service backend et leur cause n’est
pas considérée comme prouvée. La mesure du formulaire exige toutes les options :
des contrôles vides à 0,193 s ne constituent pas un chargement complet.

Le test a détecté une autre limite précise dans Photos : l’index précédent
expirait vers 21:57, après 24 heures. La même clé d’index a nécessité 113,6 s
pour réindexer les 57.150 entrées, en terminant à 22:04:03. La validation des
lignes est correcte et la clé n’a pas changé ; le blocage vient du scan synchrone
à expiration. La première visite de Photos est enregistrée comme incomplète dans
le navigateur ; l’échantillon à 0,525 s suit la réindexation.

La série conserve le pic complet de 22,384 s du graphe : plusieurs requêtes de
configuration et de données ont attendu environ 21 s. Un autre essai du graphe
a été abandonné avant réception de l’API et est identifié comme incomplet.
Pendant la revue, les données sont passées de 2.509 nœuds / 7.250 arêtes à
3.237 / 7.244, avec une empreinte différente et une reconstruction vérifiée ;
cette requête de 11,321 s ne mesure pas une réutilisation sur données immuables.
La revalidation antérieure sans changement avait pris 1,756 s. L’origine précise
du changement de données n’a pas été inspectée et les pics ne sont pas attribués
causalement à une seule observation de mémoire.

Le compte mail reste hors périmètre. Les séries des sections suivantes sont
historiques et ne décrivent pas toutes cette dernière activation.

### Correction de l’expiration quotidienne de Photos

La route Photos retourne maintenant le dernier index complet à expiration des
24 heures et confie l’actualisation à deux workers, avec huit tâches au maximum
en cours ou en attente. Les requêtes de même clé partagent la tâche. La première
exploration d’une bibliothèque sans index doit toujours finir avant d’en afficher
les données.

L’interface identifie l’actualisation, garde les photos en cas d’erreur et permet
une relance après le délai indiqué. Elle vérifie le résultat toutes les cinq
secondes, au plus 60 fois. Changer d’espace, dossier ou filtre annule les lectures
de la sélection antérieure. Si l’index change pendant la pagination, elle récupère
l’ensemble déjà chargé et le remplace intégralement, sans mélanger les versions.
Un curseur de position indépendant des éléments renvoyés permet d’avancer même
si des fichiers ont disparu.

Une exploration partielle n’est pas publiée comme un index complet. La persistance
est atomique et les invalidations empêchent une ancienne tâche de republier.
Si l’écriture du cache échoue, une exploration complète reste disponible en
mémoire. Les index historiques gardent leur format et passent une validation
structurelle ; l’ancien format ne permet pas de prouver rétrospectivement qu’une
exploration n’était pas partielle.

Validation finale de cette correction : **70 tests serveur et 45 d’interface**,
Mypy de cinq modules, types des fichiers concernés et dépendances, et ESLint
corrects. Les deux tests d’en-têtes et de curseur ont été répétés après le dernier
ajustement de types. La compilation finale a passé en 50,72 s, avec les contrôles
de contrat, langues et taille ; la taille statique initiale reste 538.828 B.
Expiration, scans lents, erreurs et invalidations ont été testés avec des données
isolées. L’index réel n’a été ni modifié ni expiré volontairement pour répéter
le scan de 113,6 s.

La correction est activée sur le serveur natif et l’interface compilée avec HTTPS
vérifié. La requête HTTP réelle retourne 50 éléments sur 57.150, état `fresh`,
révision présente et curseur 50, en 0,702 s. La vérification visible montre
les 50 cartes et les trois images visibles chargées, sans erreur.

| Vérification finale après activation | Visible avec données | Actualisation complète |
| --- | --- | --- |
| Photos, première ouverture du document | 29,128 s | 29,128 s |
| Calendrier, première visite de cette session | 19,976 s | 19,976 s |
| Photos, réouverture | 1,982 s | 1,982 s |
| Calendrier, réouverture | 0,484 s | 6,160 s |

Cette passe confirme la fonctionnalité, mais **ne résout pas les pics généraux
de latence**. La première requête de santé comprend 3,712 s avant `requestStart`
et 8,332 s jusqu’au premier octet ; le catalogue des espaces a pris 11,570 s
entre `requestStart` et le premier octet. Les lectures Photos ne commencent
qu’à 20,734 s. Les sources locales du premier calendrier ont nécessité 5–7 s
et les lectures externes 16–18 s. Les mesures lentes sont conservées et non
remplacées par les réouvertures plus rapides. Le calendrier rouvert affiche bien
les données antérieures pendant l’actualisation, conformément à l’objectif.

Une vérification ultérieure en lecture seule a retourné six réponses de santé
200 : 104–361 ms en direct et 189–857 ms via le frontal, dont 55–708 ms de
négociation TLS. Elle n’a pas reproduit l’attente de huit secondes. Le Mac
indiquait 19,18 GiB de swap, 60–64 MiB de mémoire libre et 7,1–7,5 GiB dans le
compresseur. Entre deux lectures, les entrées de swap ont augmenté de 5,58 GiB
et les sorties de 4,98 GiB ; ce sont des différences entre échantillons, pas
des taux par seconde. La pression mémoire est compatible avec des pauses globales,
mais ne démontre pas la cause des pics et n’identifie aucune autre correction
concrète du code.

L’instrumentation temporaire a été retirée et le document compilé restauré.
HTTPS retourne 200 avec vérification correcte du certificat ; HTTP retourne 307
vers HTTPS en conservant chemin et requête. Le document final ne contient ni
client de développement ni script de mesure ; le navigateur ne conserve pas
l’attribut d’audit après rechargement de l’adresse propre.

## Suite : blocages du serveur et rechargements

Une capture native de 30 secondes pendant le chargement du calendrier a recueilli
51 réponses de santé correctes, avec médiane de 32 ms et maximum de 853 ms.
Le thread principal attendait des événements réseau dans 1.674 des 2.644
échantillons ; des attentes du GIL étaient aussi présentes. La capture n’a pas
reproduit la longue pause antérieure. Les frames imbriquées ne sont pas des temps
indépendants pouvant être additionnés.

Deux blocages démontrables ont été corrigés avec des tests synthétiques : la
notification synchrone d’une erreur pouvait retenir le thread principal pendant
ses écritures de fichiers, SQLite ou appels de notification native ; le démarrage
différé du planificateur y faisait aussi des E/S. Les deux opérations s’exécutent
maintenant dans un worker. L’annulation du démarrage attend la fin du worker
avant d’arrêter le planificateur, pour éviter qu’il démarre après l’arrêt.
Le contexte d’espace et la réponse 500 sans contenu privé sont conservés.
Les 14 tests et Mypy des deux modules ont passé. Les changements sont actifs ;
ils ne sont pas présentés comme la cause prouvée du pic antérieur.

Le rechargement du calendrier avec l’ancienne version a fait **121 requêtes de
ressources compilées**, toutes avec transfert indiqué par le navigateur :
36.300 B transférés au total et 1.488.184 B de contenu décodé. La ressource initiale
renvoyait `Cache-Control: no-cache`. Le calendrier a affiché deux événements à
10,838 s, avec dernière lecture nécessaire à 10,613 s.

La compilation inclut maintenant le manifeste Vite et le serveur reconnaît
exactement ses ressources avec hash. Seuls ces fichiers publics peuvent utiliser
le cache immutable en GET/HEAD et réponses 200, 206 ou 304. HTML, API, ressources
absentes, autres méthodes et réécritures vers HTML sont exclus. Un changement
de contenu produit une URL différente. Une ancienne instantanée sans manifeste
conserve la politique antérieure. Les 45 tests ont passé, dont une intégration
avec Vite réel, ainsi que les types des fichiers concernés et ESLint.

La version est active avec HTTPS vérifié. La compilation complète a passé en
13,15 s ; le dernier changement de garde des en-têtes ne concerne que le middleware
chargé au démarrage de preview. Après cet ajustement, les 45 tests, dont deux
compilations minimales réelles, les types et ESLint ont été répétés.

| Document du calendrier | Avec données et actualisation complète | Ressources compilées réutilisées | Transfert de ces ressources |
| --- | --- | --- | --- |
| Avant la nouvelle politique | 10,838 s | 0 sur 121 | 36.300 B |
| Première réception des nouveaux en-têtes | 4,852 s | 0 sur 121 | 497.910 B |
| Rechargement suivant | 1,178 s | 121 sur 121 | 0 B |
| Deuxième rechargement suivant | 1,218 s | 121 sur 121 | 0 B |

Les trois dernières visites affichent deux événements sans erreur. La réutilisation
des 121 ressources sans transfert est directement vérifiée. La durée totale
inclut aussi les données : l’API d’événements passe de 2,365 s à 0,199 et 0,224 s
sur les deux rechargements avec données déjà en cache. Toute l’amélioration de
la page n’est pas attribuée à la politique ; le pic historique de 29 s n’est
pas considéré comme résolu et l’objectif général de 0,5 s n’est pas garanti.

L’instrumentation a été retirée. L’adresse habituelle reste ouverte avec
24 événements en vue mensuelle, sans erreur ni actualisation en cours. HTTPS
et la redirection ont été revérifiés ; le document HTML conserve `no-cache`
et les ressources compilées la politique immutable.

## Améliorations supplémentaires : démarrage, graphe et photos

Les sections suivantes sont historiques ; la dernière vérification des pics
restants figure dans « Suite : blocages du serveur et rechargements ».

Le compte mail est **hors périmètre**, conformément à la demande de l’utilisateur.
Les améliorations suivantes sont implémentées et validées ; la limite générale
de 0,5 s reste à atteindre.

- Le démarrage prépare les routes sans générer par avance la documentation API.
  Dans un test avec l’application réelle et des données temporaires, préparer
  les routes a pris 10,187 s ; générer ensuite le schéma a ajouté 16,635 s.
  Ce second travail ne retarde plus la disponibilité du service. Les 452 chemins
  et le contenu du schéma correspondent exactement au contrat publié. Autorisations,
  validation des requêtes/réponses et compatibilité avec les anciens routeurs sont conservées.
- Le graphe réutilise le schéma des pages sans table et calcule chaque couleur
  de groupe une fois. La physique construit directement les données D3, sans
  copie supplémentaire de Graphology. Le benchmark synthétique de préparation
  passe de 28,38 à 5,01 ms avec 1.000 nœuds et de 73,34 à 14,33 ms avec
  5.000 nœuds (5,1–5,7 fois plus rapide). Il mesure la préparation, pas le
  chargement complet de l’écran.
- Les photos vérifient confinement, type et métadonnées hors de la boucle
  principale, sous la limite de concurrence existante. FileResponse réutilise
  la même lecture de métadonnées. La galerie garde tous les éléments, partage
  un observateur avec marge de 160 px et évite le délai d’animation cumulé.
  Sources originales, récupération d’erreurs et contrôles de confinement sont conservés.

La première API du graphe observée avant les changements a pris 27,820 s ; après
redémarrage, 10,475 s, avec les mêmes 2.509 nœuds et 656.492 octets compressés.
Les lectures immédiatement répétées ont pris 186 et 26 ms. C’est une observation
sous charge variable, **pas une comparaison causale contrôlée**. L’instrumentation
facultative `X-Gnosi-Graph-Timing: 1` ne renvoie que des temps et comptes agrégés.
Elle a distingué 4,700 s de chargement du cache, 2,163 s de pages, 1,414 s de
JSON et 0,530 s de compression sur cette première requête. Le même cache
(2,97 MB, 1.884 entrées) a ensuite été lu en 2 ms et interprété en 72 ms ;
cette lecture à chaud n’explique pas toute l’attente initiale.

### Vérification visible de la nouvelle compilation

| Vérification | Temps jusqu’au contenu complet |
| --- | --- |
| Graphe, trois navigations avec d’autres vérificateurs actifs | 17,679 / 7,962 / 11,581 s |
| Graphe, après la fin des autres vérificateurs | 8,149 s |
| Photos visibles, trois navigations | 6,677 / 0,985 / 0,588 s |
| Photos et arbre de dossiers complets | 6,677 / 1,671 / 0,736 s |
| Document complet du calendrier, vue quotidienne | 16,595 / 4,627 s |

La vue utilisée mesure 596 × 784 px : elle contient trois photos visibles et
une carte non photographique, avec 50 éléments au total. Les cinq requêtes
d’image par navigation incluent les sources proches de la limite visible.
Ce n’est pas directement comparable aux 19 photos visibles de la passe précédente.
Une photo initialement hors écran a été ouverte puis fermée ; après défilement,
15 images étaient chargées, sans erreur ni récupération en attente. Le calendrier
quotidien a montré ses deux événements ; en sélectionnant le mois, les 24
événements complets. Un graphe réutilisé avant la nouvelle réponse n’a pas été
compté comme données fraîches.

Le Mac a atteint 19,8 GB de swap occupé. Les premières mesures coïncidaient
avec les vérificateurs d’autres travaux ; la dernière du graphe non, mais d’autres
applications restaient actives. Le premier chargement **n’est donc toujours pas
stable** et cette passe n’établit pas d’amélioration générale des temps visibles.

Validation : 70 tests backend distincts et 52 frontend ; contrôle complet des
types frontend, Mypy des sept modules modifiés, ESLint et compilation avec
limites de taille correctes. La batterie finale de compatibilité et de cycle
de vie comprend 10 tests déjà comptés dans les 70 du backend. La taille statique
initiale reste 538.828 B.

La documentation valide 31 pages revues et neuf générées ; `diff --check` est
correct. La prévisualisation temporaire a été arrêtée et supprimée. Gnosi reste
sur HTTPS 5173 (certificat vérifié), avec HTTP→HTTPS 307 et le calendrier mensuel
avec 24 événements, sans alerte ni chargement en attente. La page habituelle
ne contient pas d’instrumentation temporaire.

## Résultat antérieur des cinq points

| Point | Changement et preuve finale | Limite restante |
| --- | --- | --- |
| 1. Planning et Photos | Historique disponible sans erreur ; 19 photos visibles sur 19 chargées, dont une récupération 503→200. | Tous les fichiers hors écran n’ont pas été vérifiés. |
| 2. Attentes de données | Graphe compressé et lectures partagées ; sélecteurs compacts ; courrier et pagination publient chaque compte disponible et conservent les erreurs explicites. | Un compte mail épuise la connexion ; sa disponibilité n’a pas été rétablie. |
| 3. Premier chargement | Préparation en chevauchement, requêtes partagées et récupération explicite après timeout du catalogue. | Le démarrage reste variable ; une ouverture complète de table a nécessité 5,20 s pour données et contrôles. |
| 4. Couverture fonctionnelle | 19 sections de paramètres, deux tables, page et tableau personnalisé, tableau principal, éditeurs de plugins et détails d’article, courrier et carnet. | Couverture représentative, pas chaque enregistrement, vue ou plugin désactivé. |
| 5. Acceptation répétée | Trois chargements complets de calendrier, graphe et lecteur, avec minimum/médiane/maximum séparés des observations initiales. | La limite générale de 0,5 s ne passe pas. |

## Mesures de la compilation finale

| Composant | Échantillons complets | Minimum | Médiane | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Calendrier | 3 | 0,685 s | 0,806 s | 3,525 s |
| Graphe | 3 | 2,289 s | 2,429 s | 6,004 s |
| Lecteur | 3 | 0,907 s | 1,133 s | 1,225 s |

Un essai de calendrier abandonné avant réception des événements a été exclu.
Ces petits échantillons n’ont pas été convertis en percentiles. Aucun test ni
compilateur de cette revue ne tournait pendant ces mesures ; d’autres applications
restaient actives et la mémoire était sous pression. Ce n’est pas une comparaison
contrôlée avec la première série.

Observations supplémentaires : Planning 0,425 s ; catalogue de plugins 0,293 s ;
configuration de Planning vérifiée à 1,54 s avec sept listes déroulantes activées
et 834 options ; photos visibles 5,688 s ; deux tables de 12 et 19 lignes à
5,195 s (ouverture complète) et 1,952 s (navigation), respectivement. Ces deux
dernières mesures établissent données et contrôles, pas toutes les miniatures.

Le courrier a affiché les messages des comptes disponibles à 3,195 s et 1,479 s
sur deux navigations ; leurs décomptes étaient disponibles à 3,274 s et 3,196 s.
Le compte restant a été explicitement indisponible vers 21–22 s, avec 503 pour
les comptes et une erreur fournisseur pour la liste. Les 20 messages visibles
des autres comptes ont été conservés. Ce sont des mesures de **disponibilité
partielle**, pas des chargements complets de tous les comptes.

Un article a affiché son corps à 0,223 s. Le détail d’un carnet existant a affiché
contenu et 68 contrôles à 2,494 s ; le catalogue contient deux carnets. Un mail
déjà lu a été ouvert : réponse de détail à 0,780 s et corps rendu en iframe,
sans lui attribuer de temps complet de navigation, car ce clic ne réinitialisait
pas le compteur. Le tableau principal a affiché contenu et 56 contrôles à
1,928 s. « Configurer » d’Automatisations a ouvert IA → Automatisations avec
sept contrôles, sans écran vide.

Le contrôle complet des types frontend, la compilation finale et les limites
de taille ont passé. La compilation a validé API, quatre langues, notes de version
et 14 cas de configuration Vite. Taille statique initiale : 538.828 B ; courrier :
727.009 B. Les dernières régressions ont passé : cinq de plugins, cinq de
configuration Planning, 16 de liste/pagination mail et 27 backend de disponibilité/
indépendance de liste. Les autres batteries sont détaillées plus bas.
La documentation valide 31 pages revues et neuf générées.

L’instrumentation a été retirée et la prévisualisation temporaire du port 5174
arrêtée. L’application habituelle reste ouverte en HTTPS sur le port 5173 avec
le calendrier, 24 événements visibles, sans chargement en cours ni alerte.

## Observations antérieures

Les sections suivantes documentent le point de départ et les vérifications
intermédiaires. Les incidents décrits ne remplacent pas le résultat final ci-dessus.

## Méthode de mesure

Des navigations réelles, réponses réseau et changements du contenu rendu ont
été observés. L’instrumentation temporaire ne consigne que comptes et temps.
Un écran vide, un squelette, des données anciennes en mémoire ou un formulaire
attendant ses valeurs ne constituent pas un chargement complet. Les annonceurs
accessibles vides n’ont pas non plus été comptés comme indicateurs de chargement bloqué.

La colonne compilée correspond à une prévisualisation locale temporaire sur le
port 5174, avec le même backend. Ce sont des observations de session, pas des
percentiles ni une comparaison contrôlée avec des caches équivalents. Données
et préférences locales du navigateur peuvent varier entre ports. Aucun test ni
compilation de cette revue ne s’exécutait pendant les mesures ; la deuxième
série comprenait toutefois des vérifications d’un autre travail et de la pression
mémoire, explicitement indiquées plus bas.

## Résultats observés

| Écran ou action | Développement, 5173 | Compilée, 5174 | Ce que la mesure établit |
| --- | ---: | ---: | --- |
| Calendrier, rechargement répété | 3,09 s | 2,23 s | Deux événements visibles et chargement terminé. |
| Calendrier, premier chargement observé | 34,58 s | 7,02 s | Montre la variabilité initiale ; les conditions de démarrage ne sont pas équivalentes. |
| Configuration générale | ≥2,12 s | ≥0,88 s | Dernière réponse nécessaire ; le premier formulaire apparaît avant. |
| Catalogue de plugins | 0,83 s | 0,44 s | Catalogue et plugins installés chargés. Seule cette observation compilée respecte 0,5 s. |
| Configuration du plugin de planification | 4,17 s | 0,77 s | Sept listes déroulantes activées, avec 834 options. |
| Courrier | 6,25 s | 5,91 s | Liste actualisée ; les derniers tags se terminent à 6,30 s et 6,79 s respectivement. |
| Graphe | 5,99 s | 6,40 s | Moteur de rendu présent sans chargement ; dessin vérifié visuellement dans la session native. |
| Tableau de bord | ≥1,83 s | Non répété | Dernières lectures ; le contenu initial apparaît à 1,39 s. |
| Catalogue Knowledge | ≥2,33 s | ≥1,10 s | Inclut la lecture de configuration Wiki. |
| Une table existante | Non échantillonnée | 3,53 s | Contenu de 12 lignes ; lectures supplémentaires jusqu’à 9,88 s. Ne valide pas toutes les tables. |
| Lecteur | Non répété | 4,22 s | Liste d’articles rendue. Aucun corps d’article ouvert. |
| Carnets | Non répété | 0,91 s | Écran avec les données du catalogue. |
| Recherche bibliographique | Non répété | ≥2,15 s | Lecture des recherches enregistrées ; aucune recherche externe exécutée. |
| Social | Non répété | 4,83 s | Les deux listes chargées ; images observées jusqu’à 5,14 s. |
| Contacts | Non répété | 0,63 s | Liste rendue ; images et alternatives jusqu’à 1,02 s. Accès vérifié au clavier. |
| Planning principal | Non répété | Erreur | Une alerte apparaît vers 13,09 s ; les lectures d’historique renvoient 500. |
| Photos | Incident | Non répété | Neuf éléments finissent par afficher « Non téléchargé » après relances avec 503. |

Des requêtes répétées sur un même chemin ne prouvent pas à elles seules une
duplication : le courrier peut par exemple interroger des comptes distincts.
Les paramètres privés n’ont pas été conservés pour interpréter ces requêtes
comme identiques. Les images hors écran chargées à la demande n’ont pas non
plus été comptées comme des erreurs.

## Les cinq points de départ

1. **Résoudre les incidents fonctionnels.** Les lectures des références initiales
   et journaux de travail échouent dans `PlanningStore.history`, en lisant
   l’historique, avec `OSError: [Errno 11] Resource deadlock avoided`.
   Il faut traiter la disponibilité du fichier sans remplacer l’historique par
   des données vides. Pour Photos, il faut vérifier et terminer la matérialisation
   des fichiers en attente : les journaux confirment les demandes de téléchargement
   et les réponses 503, mais pas la fin des téléchargements.
2. **Réduire les attentes de données.** Dans la session compilée, les lectures
   distantes du courrier durent environ 3,6–4,8 s ; la requête du graphe, 4,85 s ;
   les articles du lecteur, 3,42 s. Les paramètres attendent encore les lectures
   de configuration et le formulaire de planification dépasse 0,5 s malgré
   une réponse plus petite.
3. **Stabiliser le premier chargement.** Le calendrier répété est plus rapide
   que le premier chargement observé. Il faut distinguer initialisation, lecture
   du catalogue, réponse des services externes et temps de rendu avant de tout
   attribuer au navigateur ou à la pression mémoire du Mac.
4. **Compléter la couverture fonctionnelle.** Il manque des pages individuelles
   représentatives, davantage de tables et vues, des tableaux personnalisés,
   les autres sections de configuration et éditeurs de plugins, les détails
   de carnets/articles/mails et des variantes de navigation compacte à la souris.
   Les listes déroulantes et l’accès aux Contacts ont fonctionné au clavier ;
   les essais au pointeur nécessitent une vérification spécifique avant de
   conclure à un problème de l’application ou de l’automatisation.
5. **Répéter l’acceptation après les changements.** Mesurer les chargements initiaux
   et répétés avec données actuelles et contrôles utilisables, et obtenir des
   distributions de temps. Une observation à 0,44 s du catalogue de plugins
   ne permet pas de considérer l’objectif général comme atteint.

## Changements préalables et validation

Le chargement local et externe du calendrier se chevauche déjà. La configuration
de planification demande déjà des références de page avec identifiant et titre :
pour les 793 enregistrements mesurés, la réponse combinée passe de 1.130.202 à
67.381 octets (94,04 % de moins), en conservant identifiants, titres et filtrage.
Les mesures d’interface précédentes montrent que réduire la taille ne garantit
pas le budget temporel de tout l’écran.

La validation préalable du changement du calendrier comprend 17 tests de
composant, types, lint et compilation avec limites de taille. Cette revue ajoute
des vérifications navigateur ; elle ne présente pas ces tests comme un substitut
à l’acceptation des performances ou comme une suite complète de l’application.

## Deuxième intervention : les cinq points

La récupération de Planning, la disponibilité de Photos et les lectures du
graphe/courrier ont été réparties en trois revues indépendantes. L’intégration
ajoute navigation, configuration, démarrage et validation commune.

### Corrections intégrées

- Planning conserve l’erreur explicite lorsqu’un fichier existant est illisible,
  sans le remplacer par un historique vide. Les lectures temporairement en
  attente demandent la récupération au fournisseur et réessaient avec une limite.
  Requêtes et données provisoires restent séparées par vault. Le choix réel
  du projet précède les lectures de calendrier et des références initiales.
- Photos distingue un téléchargement en cours d’un échec confirmé. La miniature
  récupère les octets sans deuxième téléchargement, annule à la sortie et permet
  de relancer les erreurs confirmées. La disponibilité est vérifiée par une
  lecture réelle, pas par le nombre de blocs alloués.
- Le graphe partage les reconstructions simultanées d’un même vault, évite de
  relire le registre sur les succès du cache et compresse hors de la boucle
  principale du serveur. Le courrier sépare la connexion des comptes de dossiers
  de celle de la liste de messages et ne demande que les en-têtes utilisés.
- Les paramètres chargent tables et bases en parallèle, gardant le résultat
  disponible si l’autre lecture échoue. Reader réutilise le formateur de dates
  de liste. Le démarrage fait chevaucher santé et préparation de route.
- Une couche masquant les raccourcis à la souris en mode compact a été corrigée.
  « Configurer » d’Automatisations ouvre maintenant IA → Automatisations,
  au lieu de sélectionner une section inexistante et laisser les paramètres vides.
- Le service natif évite une réinstallation automatique des dépendances au
  redémarrage si un autre travail a changé les manifestes du projet.

### Couverture supplémentaire

Les 19 sections de paramètres disponibles ont été ouvertes dans le navigateur,
sans alerte de chargement. Notes quotidiennes a montré deux listes déroulantes
avec 18 options ; capture web, quatre avec 55 options ; Wiki, 45 contrôles
avec 238 options. Aucune valeur n’a changé et aucun plugin n’a été activé.
Genogrammes et Importer Notion étaient désactivés dans le catalogue ; cette
revue ne les active pas pour simuler une couverture réelle. La vérification à
la souris des Contacts a confirmé l’accès après correction de la surcouche.
Les contrôles de contenu des autres composants et les mesures finales sont
documentés ci-dessous une fois terminés.

Les tests supplémentaires comprennent 43 cas de cycle de vie et de navigation
de pages, tables et vues intégrées avec de vrais moteurs de rendu ; 23 de
configuration, dont le clic réel d’Automatisations sans écriture ; 20 de démarrage
et regroupement des requêtes ; 12 de Reader ; 17 de Photos ; et 12 de Planning,
dont le changement de vault avec réponses en attente. Les 14 tests de compression
couvrent aussi le refus 406 lorsque le client n’accepte aucun encodage disponible.
Les tests backend de récupération et courrier/graphe figurent dans les résultats
des trois travaux. Ruff et Mypy ont passé sur les dix fichiers backend intégrés.

Le premier contrôle complet des types frontend a passé. Une répétition ultérieure
a détecté deux erreurs dans le travail concurrent de genogrammes ; l’intégration
a été coordonnée avec ce travail et la compilation finale est enregistrée séparément.
Aucun résultat antérieur ne valide automatiquement des fichiers modifiés ensuite.

### Compilation et démarrage observés

La compilation précédant les dernières corrections de courrier et plugins a passé,
y compris contrat API, frontière API, quatre langues, notes de version, 14 tests
de configuration Vite et limites de taille. Tailles non compressées : entrée
21.521 B ; requête initiale 83.336 B ; ensemble statique initial 538.770 B ;
courrier 724.853 B ; calendrier 960.269 B ; plus grand fragment 1.375.866 B.
Les limites n’ont pas été relevées pour faire passer cette validation.

Les deux services natifs ont été redémarrés. Ils ont fini par répondre 200 ;
HTTPS vérifie correctement le certificat et HTTP retourne 307 vers HTTPS.
Le démarrage du backend a pris plusieurs minutes alors que des vérificateurs
d’autres travaux étaient actifs. Un échantillon d’une seconde a trouvé un worker
dans Pydantic et la récupération mémoire, compatible avec une préparation OpenAPI.
Cela ne prouve pas que cette phase explique toute l’attente ; aucun paramètre
global de mémoire n’a été modifié à partir de cet échantillon unique.

Pour éviter les changements de fichiers pendant le test, une copie temporaire
indépendante de la compilation a été servie. Les premières observations de la
deuxième intervention se sont faites sous charge concurrente et ne constituent
pas une comparaison contrôlée avec les chiffres précédents. Dans cette situation,
même la santé du backend et l’HTML natif ont pris 5,44 s et 4,25 s. Ces attentes
ne peuvent être attribuées aux seuls fournisseurs externes.

Planning a récupéré les deux lectures d’historique : 503 en attente suivi de
200, sans alerte finale. Photos a montré 16 images visibles correctes, deux en
attente et une erreur visible. C’est une récupération partielle, pas la confirmation
que tous les fichiers ont fini de télécharger.

### Distribution des observations sous charge concurrente

Les rechargements complets sont séparés des navigations de menu. Le temps va
jusqu’à la première frame avec contenu après les réponses nécessaires ; il
exclut les rappels périodiques arrivant une fois l’écran utilisable. Ce sont
de petits échantillons d’une session sous pression de ressources, pas un p 95
ni des estimations d’une machine au repos.

| Composant | Échantillons de navigation | Minimum | Médiane | Maximum | État |
| --- | ---: | ---: | ---: | ---: | --- |
| Calendrier | 3 | 2,734 s | 3,626 s | 18,118 s | 24 événements, sans alerte. |
| Lecteur | 3 | 8,458 s | 9,348 s | 9,769 s | 500 articles rendus. |
| Planning | 2 | 0,677 s | — | 5,665 s | Historique récupéré, sans alerte. |
| Graphe | 2 complets | 5,620 s | — | 17,650 s | Neuf surfaces de dessin, sans chargement. Un autre échantillon n’établit que la réponse API à 45,95 s. |
| Courrier | 3, avant la correction finale | — | — | — | Ne prouvent pas la fraîcheur : repli silencieux et compte 500 détectés. |

Les rechargements complets séparés ont donné 14,898 s pour le calendrier et
18,359 s pour Planning, ce dernier incluant la récupération 503→200 de l’historique.
Ces résultats **n’établissent ni une amélioration générale ni la limite de 0,5 s**.
Les observations sans contenu privé sont enregistrées dans
[navigation-latency-observations-2026-09-08.json](navigation-latency-observations-2026-09-08.json).

### Incidents supplémentaires découverts pendant la couverture

Une page favorite et un tableau personnalisé ont été ouverts avec éditeur et
contenu, sans erreur ni chargement. La tentative suivante d’ouverture d’une table
est restée bloquée au démarrage : aucune erreur JavaScript enregistrée ; le
rechargement a reçu la santé à 28,3 s et le catalogue des vaults à 47,6 s, puis
les lectures d’authentification/plugins ont épuisé les 10 s. Le code ignorait
`loadError` du catalogue et n’affichait indéfiniment que « Chargement ».
Une récupération explicite a été ajoutée aux deux points qui gardent les fonctions
fermées jusqu’à connaître l’état des plugins. Ce cas de table n’est pas compté
comme une validation fonctionnelle réussie.

La revue du courrier a confirmé qu’une erreur IMAP pouvait devenir une liste
vide 200 enregistrée en cache. Tous les comptes étaient aussi attendus avant de
publier ceux déjà reçus. La correction garde les erreurs explicites, évite de
mettre l’échec en cache, publie les comptes disponibles et identifie ceux en
attente ou indisponibles sans les convertir en zéro. La limite extérieure est
de 30 s ; les GET Microsoft ont aussi une limite de connexion de 20 s. Les
durées observées d’environ 25 s ne sont pas interprétées comme un timeout
configuré exactement à 25 s.

Cette dernière correction du courrier a 38 tests backend et 7 frontend réussis.
La validation de documentation passe déjà : 31 pages revues et 9 générées.
La validation finale commune et la vérification de récupération du catalogue
sont enregistrées ensuite ; les anciennes captures ne sont pas réutilisées
comme validation de ces derniers changements.

### Clôture des régressions détectées

La récupération du catalogue a cinq tests réussis : timeout, clic réel de relance,
refus, respect de l’authentification et changement de vault avec lectures ou
mutations en cours. Les réponses et retours arrière du vault précédent ne
s’appliquent plus au vault actuel. Le contrôleur des paramètres de Planning a
cinq cas réussis : lectures de tables et références annulées et répétées au
changement de vault, même avec des identifiants de table identiques.

Les décomptes mail ne partagent que les lectures de même génération : une
invalidation par action utilisateur empêche de réutiliser et publier le résultat
antérieur. Les 27 tests communs de disponibilité et indépendance de liste ont
passé, ainsi que Ruff et Mypy des deux fichiers de cette dernière correction.
La pagination publie chaque compte dès sa réponse et conserve curseur, messages
et sélection si un autre échoue ; la relance ne consulte que les pages échouées.
Les 16 tests de liste, actions et données passent, dont les deux nouveaux cas
d’erreur HTTP et fournisseur.

Le serveur natif a été redémarré avec ces changements. Le contrôle a obtenu 200
pour santé et HTTPS avec certificat correctement vérifié, et 307 de HTTP vers
HTTPS. Le swap occupé du Mac était d’environ 18,3 GiB ; les mesures ultérieures
ne représentent pas une machine au repos. Aucune application ni machine virtuelle
de l’utilisateur n’a été arrêtée.
