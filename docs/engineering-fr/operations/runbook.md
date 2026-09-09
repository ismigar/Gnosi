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

# Guide d’exploitation

Ce guide décrit les contrats examinés dans le code public. La date de
vérification correspond à cet examen, pas à une installation, une migration
ou une publication validée sur toutes les plateformes. Les commandes
ci-dessous sont des instructions destinées à l’opérateur, et non la preuve
qu’elles ont été exécutées.

La vérification de santé du navigateur utilise la même instantanée globale du
processus que les sondes natives : un cookie, un en-tête ou un paramètre de
requête désignant le vault actif ne déclenche pas sa résolution pour la route
exacte `GET /api/health`. Les autres chemins et méthodes conservent leur routage
normal. L’autodétection de la politique d’authentification ne partage que les
lectures en cours ; les requêtes HTTP suivantes attendent une même tâche sans
occuper de workers bloqués. Le TTL existant de cinq secondes commence toujours
à la lecture initiale ; une réinitialisation retire la génération en cours,
les substitutions explicites de l’environnement restent actualisées, les sessions
de base de données explicites ne réutilisent pas le résultat et les erreurs
continuent d’exiger une authentification.

## Privilégier le développement natif

Exécutez le backend FastAPI et le frontend Vite en mode natif. Docker, Electron,
le stockage dans le cloud et les LaunchAgents de macOS sont facultatifs.
Utilisez Python 3.11, Node 22.22.2 et pnpm 11.19.0 ; la CI actuelle et le backend
Docker imposent uv 0.9.15. Depuis la racine du dépôt, préparez les dépendances
à partir des fichiers de verrouillage versionnés :

```sh
uv sync --frozen
corepack pnpm install --frozen-lockfile
```

Démarrez le backend et le frontend dans deux terminaux distincts, chacun à la racine du dépôt :

```sh
bash scripts/runtime/run_native_dev.sh 5002
```

```sh
bash scripts/runtime/run_native_frontend.sh --config vite.config.js --host 127.0.0.1
```

Le script du backend utilise l’environnement existant à la racine via
`uv run --project "$BASE" --frozen --no-sync`, appelle les fonctions Python
canoniques `load_env()` et `resolve_data_dir()`, puis démarre uvicorn sur
l’interface de bouclage avec un rechargement limité à `backend/`. Il ne
synchronise ni n’installe les dépendances. Il n’interprète pas dotenv dans le
shell et n’impose ni vault OneDrive, ni fournisseur, ni `HOME_HOST_PATH`, ni
fuseau horaire, ni modèle, ni endpoint de traduction.

Le script du frontend définit `COREPACK_ENABLE_NETWORK=0` et exécute
`corepack pnpm --filter @gnosi/frontend dev` ; pnpm et les dépendances
verrouillées doivent déjà être disponibles. L’exemple transmet une configuration
Vite explicite et une adresse de bouclage ; sans `--host`, la configuration
d’écoute de Vite s’applique. Définissez explicitement `VITE_BACKEND_HOST` et
`VITE_BACKEND_PORT` pour un autre backend (valeurs par défaut : `127.0.0.1`
et `5002`). Vite charge ses propres dotenv ; le script n’exporte pas de valeur
par défaut de `VITE_FRONTEND_PORT` qui les masquerait. Les deux scripts
valident les ports fournis entre 1 et 65535, transmettent les arguments et
propagent les codes de sortie. Le frontend conserve les libellés explicites
du checkout et signale un checkout déjà intégré, en retard sur `origin/main`.

Pour l’utilisation native quotidienne, compilez une fois et servez l’application compilée :

```sh
corepack pnpm --dir frontend run build
GNOSI_NATIVE_FRONTEND_MODE=preview bash scripts/runtime/run_native_frontend.sh
```

Preview conserve le même port strict, les certificats HTTPS, la redirection de
HTTP vers HTTPS et le proxy du backend. Il sert une copie isolée de
`frontend/dist` : une compilation ultérieure ne peut donc pas retirer les
ressources de l’application en cours. L’arrêt supprime uniquement la copie de
ce processus. Recompilez et redémarrez pour appliquer les changements de code ;
le mode par défaut `GNOSI_NATIVE_FRONTEND_MODE=dev` conserve la mise à jour du
code en direct. Une compilation absente ou un mode invalide produit une erreur
explicite. Un LaunchAgent géré peut choisir preview avec cette variable
d’environnement ; rechargez la tâche après avoir modifié son environnement enregistré.

Les compilations incluent un manifeste Vite. Preview l’utilise pour identifier
les ressources publiques exactes dont le nom contient une empreinte du contenu,
et leur applique un cache navigateur immutable pour les réponses GET/HEAD
réussies, y compris la validation 304. HTML, réponses API, ressources absentes,
fichiers publics non répertoriés et autres méthodes conservent leur politique
de cache. Un changement de contenu modifie l’URL compilée ; l’entrée HTML est
toujours revalidée pour découvrir la compilation actuelle. Les anciennes
compilations sans manifeste gardent la politique Vite initiale. Cela élimine les
revalidations répétées après réception des nouveaux en-têtes, mais pas la latence
du premier téléchargement ni des API.

Au démarrage, les requêtes de routage et de santé traversent leur middleware
asynchrone avant la programmation des téléchargements des routes et du shell.
Cela laisse un tour au navigateur, sans attendre aucune des deux réponses ;
le rendu respecte toujours la disponibilité du routage et de la langue. La
compilation ne regroupe que les 51 icônes du shell explicitement examinées.
Les autres icônes et routes lourdes restent chargées à la demande ; les dépendances
communes des icônes conservent leur placement automatique. Après toute modification
de ce groupe, vérifiez le graphe des imports compilés : nouveaux cycles,
dépendances initiales inattendues et budgets en octets.

Un cookie de session invalide peut faire rejeter les requêtes du vault même
lorsque l’accès anonyme local est autorisé. `/auth/me` distingue ce cas d’une
réponse 401 anonyme ordinaire. L’interface propose une action explicite de
récupération de session : elle appelle l’endpoint de déconnexion existant,
efface les métadonnées d’identité locales uniquement après réussite et recharge
l’application. Si la déconnexion échoue, la récupération reste disponible.
La politique d’authentification et l’accès public aux pages partagées restent identiques.

Une réponse 401 explicite d’une route protégée avec `Authentication required`
est un autre cas : si `/api/auth/me` indique un utilisateur anonyme, affichez
Login au lieu de diagnostiquer un cookie expiré ou de proposer une déconnexion.
La réponse du serveur pour le catalogue des plugins prime sur une instantanée
de santé antérieure indiquant que l’authentification est désactivée. La correction
`authenticationRequired` de `usePlugins` et App a passé 17 tests ciblés, une
vérification de types ciblée, le lint des fichiers existants et une compilation.
Un test d’intégration App supplémentaire vérifie que se connecter dans le même
vault recharge les plugins et quitte Login ; son lint passe aussi. L’activation
avec TLS approuvé et l’écran Login réel sont vérifiés ; aucune connexion,
déconnexion réelle ni lecture d’identifiants n’a été effectuée. Voir le travail
restant sur les temps du calendrier dans [l’audit de latence de navigation](navigation-latency-audit-2026-09-08.md).

Le profilage Python privilégié n’est pas la seule voie de diagnostic.
L’instrumentation facultative des durées du calendrier, avec
`X-Gnosi-Calendar-Timing: 1` et `Server-Timing`, est implémentée et activée pour
les routes de calendriers et d’événements. Elle indique les temps de file
d’attente, de résolution des identifiants et HTTP sans exposer d’identifiants
ni de contenu du calendrier. Seul le contexte `CalendarTiming` est propagé ;
les contextes de vault et d’authentification ainsi que les résultats des requêtes
restent identiques. Les temps sont inclusifs et peuvent être concurrents :
ne les additionnez pas pour reconstituer le total. `cal_total` exclut le
middleware et la validation de réponse ; ce n’est pas la durée HTTP complète.
`cal_service` inclut l’accès à la façade, les imports de discovery précédant
les identifiants imbriqués et la construction du client ; ce n’est pas uniquement
le temps de `build`. La batterie de 35 tests de calendrier, la répétition de
ses 9 nouveaux tests, Ruff et mypy ont passé. La vérification réelle d’accès
aux données a retourné HTTP 200, avec un calendrier et deux événements visibles
après 10.557 s. L’attente serveur antérieure de 47–52 s n’a pas été reproduite ;
des intervalles locaux restent inexpliqués et ce diagnostic n’établit pas une
amélioration globale de latence qui lui soit attribuable. Cette voie ne requiert
aucune autorisation administrative.

Un échantillonneur Python interne au processus est implémenté pour les requêtes
du graphe avec `X-Gnosi-Graph-Profile: 1`, et pour celles des événements du
calendrier avec `X-Gnosi-Calendar-Profile: 1` et `X-Gnosi-Calendar-Timing: 1`.
Il n’autorise qu’un échantillonneur à la fois, pendant au plus 15 s à 20 Hz,
observant le thread principal et les workers explicitement enregistrés.
Il consigne uniquement les noms normalisés des fichiers de code, les noms de
fonction et les numéros de ligne, sans variables locales ou globales, arguments,
noms de thread, données utilisateur ni traçage du courrier. La sortie agrégée
est limitée à 256 piles de 32 frames et comprend l’identifiant du processus
et l’heure de début monotone. Le fichier de mode `0600`
`/tmp/gnosi-request-profile-<id>.json` est enregistré à l’échéance de 15 s même
si la requête reste en cours. L’arrêt attend au maximum 250 ms ; la réponse
inclut `X-Gnosi-Request-Profile-Id` si la persistance est déjà terminée.
Aucune autorisation administrative n’est nécessaire. La batterie de 35 tests
échantillonneur/calendrier/graphe, Ruff, mypy et l’activation du backend ont passé.
Les captures du graphe et du calendrier se sont achevées sans privilèges administratifs.
La capture du graphe comporte 39 observations sur une fenêtre maximale de
15 s, 33 piles agrégées et aucune pile abandonnée. L’intervalle nominal de
50 ms n’était pas constant en pratique : ne multipliez pas les observations
par cet intervalle pour en déduire des durées. Une frame du runner uvloop ne
distingue pas le repos du travail natif en C. La capture suivante du calendrier
comporte 34 observations, 19 piles et aucune abandonnée ; les frames d’attente
des workers et de cache de discovery sont des observations, pas des durées
écoulées additives. Ces limites décrivent le diagnostic, pas une correction
de latence. Les corrections de décodage JSON, d’admission au cache borné des
métadonnées et de découverte statique Google sont implémentées et validées :
80 cas de test uniques, Ruff, mypy et le contrôle du diff ont passé. L’activation
du backend s’est terminée en 185.3 s. Les ouvertures directes suivantes,
avec les seuls temps et les ressources compilées en cache, ont affiché le
graphe après 22.128 s et les données fraîches du calendrier après 16.081 s.
Ces mesures ne démontrent ni une amélioration générale de la latence ni
l’objectif de 0.5 s. La navigation finale à chaud a affiché le graphe après
7.447 s et les données fraîches du calendrier après 5.392 s ; les données déjà
chargées du calendrier étaient visibles à 398 ms. Distinguez temps de visibilité
et temps d’actualisation. La vérification et le nettoyage sont terminés, mais
l’objectif de latence reste partiel. L’HTML de l’instantanée native a été restauré,
le script de mesure et les deux profils créés ont été supprimés ; le calendrier
accessible sur l’adresse de bouclage a été remis en vue Mois sans requête
d’audit. HTTPS a retourné 200 avec vérification TLS réussie et HTML `no-cache` ;
HTTP a redirigé en 307 vers HTTPS et les ressources compilées ont conservé
leur cache immutable d’un an.

Pour un vault local, configurez son répertoire réel et sélectionnez
`GNOSI_FILES_PROVIDER=local` ; aucun service auxiliaire de téléchargement
n’est nécessaire. Distinguez le vault actif du répertoire parent contenant
plusieurs vaults. `DIGITAL_BRAIN_VAULT_PATH` est prioritaire sur
`VAULT_HOST_PATH` ; cette dernière variable intervient aussi dans la
détection du fournisseur. Sans chemin imposé par l’environnement, le backend
peut utiliser le vault sélectionné dans les paramètres.

| Service | Adresse par défaut | Vérification |
| --- | --- | --- |
| Frontend | `http://localhost:5173` | L’écran de connexion ou l’interface de l’application s’affiche ; la navigation fonctionne. |
| Backend | `http://127.0.0.1:5002` | `/api/health`, puis des requêtes autorisées de configuration et d’accès au vault. |

Vite utilise `strictPort: true` : résolvez les conflits de port au lieu
d’accepter un port de repli. HTTPS est facultatif : le mode automatique utilise
les certificats locaux lisibles ; `VITE_DEV_HTTPS=false` impose HTTP et
`VITE_DEV_HTTPS=true` exige des certificats. Redémarrez Vite après toute
modification des certificats. Le code source se recharge ; les changements
de dépendances nécessitent une synchronisation des fichiers de verrouillage
et un redémarrage du processus concerné. Redémarrez le frontend pour actualiser
les valeurs de version injectées au démarrage.

Le frontend natif géré définit par défaut `pnpm_config_verify_deps_before_run=warn`,
tout en respectant une substitution explicite. Le redémarrage du service ne doit
pas déclencher une réinstallation implicite des dépendances lorsqu’une autre
tâche modifie les manifestes du workspace. Installez et synchronisez les dépendances
explicitement avant de redémarrer le serveur concerné ; l’avertissement ne prouve
pas que les dépendances installées correspondent au fichier de verrouillage.

Pour un HTTPS local approuvé, installez `mkcert`, exécutez
`bash scripts/runtime/setup-https-dev.sh`, puis redémarrez le frontend.
Cette préparation installe une autorité de certification locale dans le magasin
de confiance de la machine et génère les certificats ignorés sous
`frontend/certs/`. Avec ces certificats, `https://localhost:5173` sert
l’application ; HTTP redirige vers le même chemin et la même requête en HTTPS.
Les fichiers de certificat seuls ne suffisent pas si le navigateur ne fait pas
confiance à l’autorité locale.

Le développement natif utilise les notifications du système de fichiers.
Ne définissez `CHOKIDAR_USEPOLLING=true` que pour les systèmes de fichiers ou
montages de conteneur qui nécessitent une interrogation périodique. Vite précharge
le shell de l’application, Knowledge et Control Center au démarrage ; les autres
écrans restent chargés à la demande et sont préparés à l’intention de navigation.

La langue initiale et le formatage des enregistrements utilisent
`/api/config/interface`, une petite réponse de préférences d’affichage propre
au vault, soumise au même contrôle d’autorisation que la configuration. Elle ne
lit aucun état d’identifiant ; `/api/config` reste la réponse de configuration
complète, avec ses indicateurs d’identifiants. Les éditeurs et Control Center
lisent `/api/config/editor`, qui conserve les champs modifiables et extensions,
normalise les références des fournisseurs et leurs valeurs par défaut, et exclut
les identifiants en clair ainsi que les indicateurs de disponibilité en lecture
seule, sans consulter les magasins d’identifiants. L’enregistrement de la
configuration invalide les caches frontend correspondants. Les éditeurs partagent
uniquement les requêtes simultanées d’un même vault ; les lectures ultérieures
revalident immédiatement. Settings charge ses documents modifiables une seule
fois par ouverture de modale, y compris lorsque le développement rejoue les effets
de montage. Fermer puis rouvrir demande toujours des documents de configuration,
d’intégration et d’identité actuels.
Les sélecteurs de champs et d’enregistrements réutilisent un collateur par langue
pour chaque tri. Les paramètres de Planning conservent les tables, projets et
tâches triés jusqu’au changement des données ou de la langue : modifier un autre
champ ne retrie pas des centaines de choix.

Le routage des vaults résout dans des workers les lectures à froid de SQLite
et des dossiers cloud. Les requêtes simultanées pour une même identité partagent
une lecture ; le cache d’identité de 60 secondes est invalidé par les changements
de vault, y compris pour les lectures en cours. Le contexte du vault actif est
défini dans la tâche de requête après résolution et avant l’endpoint. Les lecteurs
HTTP simultanés attendent une tâche partagée sans occuper de workers pendant
qu’un autre résout la même identité. La déconnexion d’un lecteur ne peut pas
annuler la résolution requise par les autres.

Les lecteurs de configuration réutilisent les préparations de répertoire réussies
pendant au plus 30 secondes, avec un maximum de 256 chemins. YAML, sélection
du vault et lectures de fichiers conservent leur fraîcheur et leurs contrôles
d’autorisation habituels. Une préparation échouée est retentée ; les appels
directs à `get_paths()` contrôlent et réparent toujours immédiatement. Si un
répertoire préparé est supprimé, une lecture de configuration peut différer sa
recréation jusqu’à l’expiration de cet intervalle.

Les lectures de comptes mail ne résolvent les identifiants que du compte choisi
(ou des comptes activés pendant la synchronisation), à l’exclusion des autres
intégrations. La lecture des dossiers mail, des rappels de calendrier et la
construction du graphe s’exécutent dans des workers, y compris le chargement de
configuration et de registre. Settings charge les données auxiliaires des modèles,
du calendrier, du lecteur et des réseaux sociaux à l’ouverture de leur section.
Le graphe affiche immédiatement les données prêtes, sans délai minimal, et
réutilise le chemin de configuration résolu du vault pour lire les métadonnées
gérées de chaque nœud. Si un index de pages existe, la découverte du graphe
utilise ses chemins et dates de modification, évitant un deuxième parcours du
système de fichiers cloud. Les nœuds inchangés conservent tous les liens de corps
en cache ; les nœuds modifiés sont réanalysés. Un index ancien absent ou étranger
entraîne un parcours du système de fichiers. La fraîcheur de l’index suit le
watcher et l’actualisation de fond existants.
Le cache disque des nœuds analysés n’est écrit qu’après changement d’un nœud.
La persistance encode une instantanée et utilise l’écriture atomique au lieu de
millions de petites écritures JSON. Les premiers lecteurs simultanés attendent
un chargement complet commun ; les changements pendant une sauvegarde restent
marqués à enregistrer, et les sauvegardes échouées sont retentées au prochain
rebuild. Les caches persistants des nœuds sont partitionnés par chemin de vault
sous `LOCAL_CACHE/graph_nodes/`. Un vault sans cache propre lit une fois ses
entrées dans l’ancien `graph_node_cache.json`, puis écrit sa partition ; l’ancien
fichier reste intact pour les autres vaults. Les états chargé et modifié sont
suivis par vault : en ouvrir un ne nécessite pas de décoder les anciennes entrées
de tous les autres. Un fichier de métadonnées voisin lie les nœuds analysés à
leur classification, couleurs et sidecars gérés au moyen d’une empreinte du JSON
réel des nœuds. Les anciens caches ou marqueurs non concordants nécessitent une
régénération unique. Les marqueurs ne sont publiés qu’après construction et
sauvegarde complètes réussies ; les lectures échouées ou partielles restent retentables.
Le visualiseur du graphe laisse Sigma rendre les mises à jour groupées de
topologie, visibilité et position sans imposer une seconde réindexation complète
à chaque étape du layout. Les changements de survol invalident toujours leur
état d’affichage. La projection initiale et les filtres de visibilité précèdent
la construction de Sigma, dont le premier index voit ainsi la topologie préparée.
La frise utilise sa limite temporelle initiale effective avant de l’inscrire
dans l’état, évitant une seconde simulation D3 initiale pour les mêmes données
et filtres ; les changements ultérieurs mettent toujours le layout à jour.
La mini-carte regroupe les événements de graphe, caméra et rendu en un dessin
par frame, regroupe les cercles des nœuds, ne redimensionne que si nécessaire
et annule le travail prévu lors du remplacement ou démontage. Les ajustements
différés de caméra sont aussi annulés quand la vue change ou se ferme.
Les décomptes des filtres de champs réutilisent le graphe de filtrage déjà
normalisé et parcourent une fois ses nœuds pour tous les champs configurés.
Les métadonnées sont normalisées une seule fois par nœud ; le comptage conserve
la classification par table, la recherche de champs insensible à la casse,
les valeurs répétées et l’ordre stable des comptes égaux.
La page ne demande l’index global des titres que lorsque les filtres de champs
configurés en ont besoin. Ces filtres conservent la priorité de titre de l’index
canonique. Les requêtes graphe, tables, configuration et index sont propres au
vault actif ; les graphes intégrés partagent la même requête et l’invalidation
par préfixe. Chaque lot du backend résout aussi une seule fois les noms et alias
des champs de relation d’une table, y compris celles sans relations. Ce cache
appartient au seul lot ; la construction suivante lit le schéma actuel du registre.
Les métadonnées de page en cache ne sont jamais modifiées en convertissant
les wikilinks de relation en identifiants.
L’API du graphe conserve un corps JSON validé pour l’instantanée actuelle et
vérifie l’objet actuel du service avant réutilisation. Reconstructions et
invalidations remplacent cet objet ; les graphes partiels ne sont jamais conservés
et une validation échouée ne peut publier un corps. L’encodage s’exécute dans
le worker de la requête ; en-têtes de réponse et tâches de fond restent propres
à chaque requête.

Les lectures des racines, arbres, albums, vues et pages de médias s’exécutent
aussi dans des workers afin que la latence cloud ne bloque pas les autres
requêtes. Une page de médias résout chaque couple vault/racine une fois par
requête ; ce contexte est supprimé après succès ou échec. Les lectures simultanées
du même arbre de médias contenu dans sa racine ne partagent que le travail en
cours. Les listes de répertoires parents et enfants partagent une limite globale
de quatre scans, en conservant filtres de dossiers et ordre stable. Il n’y a pas
de TTL d’arbre : les requêtes ultérieures lisent les répertoires actuels et
les erreurs ne sont pas conservées pour une autre requête.
Les index persistants de médias conservent les chemins validés sous forme de
chaînes et les dates de modification dans une séquence immutable. La pagination
par défaut ne crée des objets `Path` que pour la page choisie, pas pour chaque
fichier indexé. Le chargement valide toujours l’index complet ; filtres et tris
personnalisés inspectent toujours chaque entrée concernée. Le format JSON et
l’intervalle de fraîcheur de 24 heures restent compatibles. À l’expiration,
l’API du navigateur renvoie l’instantanée enregistrée pendant qu’au plus deux
workers l’actualisent ; la file combinant exécutions et attentes est limitée à
huit tâches. Les requêtes d’un même index partagent ce travail. Un premier index
sans données enregistrées utilisables attend toujours son scan initial.

`GET /api/vault/media` indique `X-Gnosi-Media-Index` (`fresh`, `refreshing` ou
`failed`), une révision opaque `X-Gnosi-Media-Index-Revision` et
`X-Gnosi-Media-Next-Offset`. Le corps conserve son contrat. Les fichiers supprimés
depuis l’instantanée sont omis des éléments, mais leurs positions et le total
restent stables ; les consommateurs avancent avec l’en-tête de prochaine position,
y compris pour les fenêtres vides. Les actualisations échouées conservent
l’instantanée enregistrée et renvoient un délai `Retry-After` d’au plus 30 secondes.
La galerie interroge l’actualisation toutes les cinq secondes, jusqu’à 60 fois,
puis propose une relance manuelle. Elle conserve les photos chargées et ne
remplace la totalité du préfixe chargé qu’après concordance des révisions entre
pages. Changer de racine, album, filtres ou vault, ou démonter la vue, annule
requêtes et temporisateurs.

Les scans partiels ne remplacent pas un index complet. L’invalidation retire la
génération de publication et la persistance remplace atomiquement un fichier
temporaire encodé. Un index intégralement lu reste utilisable en mémoire si son
écriture échoue. Les anciens appelants Python conservent des lectures bloquantes
et des résultats partiels au mieux, mais ne publient pas de scans partiels.
Le format JSON historique ne peut pas certifier rétrospectivement la complétude
d’un ancien index ; sa structure est validée au chargement. Un cache qui ne peut
pas être écrit ne survit pas au redémarrage du processus.

La configuration sociale ne résout que sa propre section d’intégration, conservant
les listes explicitement vides et les valeurs par défaut sans ouvrir d’autres identifiants.

Les notifications d’erreurs non gérées s’exécutent dans un worker afin que les
accès base de données, fichiers et notifications natives ne bloquent pas les
requêtes HTTP indépendantes. Le démarrage différé du planificateur s’exécute
aussi dans un worker. Une annulation attend la fin de son démarrage en cours
avant que l’arrêt appelle stop, évitant qu’il démarre après avoir été arrêté.
Ces limites conservent les ContextVars de requête et la réponse 500 sûre existante.

Les paramètres des plugins chargent plugins installés et autorisations
indépendamment de la place de marché. Catalogue et confiance se chargent à
l’ouverture de leur section ; une lecture de confiance en attente ne masque pas
un catalogue prêt. Les erreurs affichent une relance avant que la configuration
soit modifiable. Le backend ne réutilise l’état décodé des plugins que si date
de modification, date de changement, taille et inode concordent ; les sauvegardes
l’invalident et chaque document retourné est une copie indépendante liée à son chemin.

L’entrée du navigateur lance le routage du vault et le téléchargement de l’écran
demandé avant de charger React DOM et le shell. Elle partage la lecture de routage
en cours avec le shell, qui attend toujours routage et langue avant le rendu.
L’entrée définit le cookie du vault actif avant toute requête initiale. La lecture
de routage précède les imports spéculatifs d’écran et demande une priorité élevée ;
le comportement de planification du navigateur doit néanmoins être mesuré sur
l’hôte cible. Les budgets de build limitent séparément le code nécessaire au
lancement de ces requêtes et conservent le bootstrap dynamique requis dans le
budget complet de démarrage. Le catalogue des vaults lit mode et stockage par
défaut dans une instantanée de configuration par requête ; les requêtes suivantes
lisent toujours la configuration actuelle.

Les sélecteurs de planification de projet demandent tous les identifiants et
titres des pages via l’endpoint `references` de la table. Celui-ci utilise les
mêmes filtres de modèles et chargements de titres que la réponse complète,
sans transmettre les métadonnées inutilisées. Seules des lectures simultanées
d’un vault, d’une table et d’un filtre identiques sont partagées ; les suivantes
revalident immédiatement. Un éditeur ouvert annule ses lectures de tables et
références quand le vault change et n’affiche pas les résultats du vault précédent,
même si les identifiants de table concordent. Sur les données locales de
748 tâches/45 projets, les deux réponses décodées totalisaient 67,381 octets
au lieu de 1,130,202 (94.04% de moins), avec les mêmes identifiants et titres
ordonnés. Les requêtes de références mesurées ont pris 118 ms et 22 ms ; cela
n’établit pas le délai jusqu’à l’utilisation du formulaire complet de paramètres.

Le calendrier monte sa grille pendant le chargement des notes et préférences
locales, permettant à la plage réellement visible de FullCalendar de lancer en
parallèle les lectures d’événements externes. La grille n’est masquée et inerte
que lors de la première lecture locale sans données utilisables. Les sources
locales complètes vivent dans une requête propre au vault et se revalident à
chaque ouverture (`staleTime: 0`). La réouverture affiche cette instantanée et
les événements terminés de même plage, tandis qu’un indicateur d’activité signale
les actualisations en cours ; l’intervalle de fraîcheur externe reste de
30 secondes. Une actualisation partielle ne remplace pas la dernière instantanée
locale complète. Un premier résultat partiel peut encore afficher des notes
utiles, avec erreur explicite et relance. Listes de calendriers, plages, rappels
et invalidations de mutations sont propres au vault ; les valeurs provisoires
de la plage précédente ne traversent jamais les vaults. La visibilité enregistrée
est appliquée avant la sélection des calendriers arrivés tôt. Actualiser les
notes conserve l’instance de grille, la période choisie et la vue.
Les tests à réponses différées exercent le véritable remontage de FullCalendar
avec un résultat ancien de même plage ; la visibilité du cache et les données
fraîchement obtenues doivent être mesurées séparément dans le navigateur de l’hôte.

Settings n’importe plus le registre complet des composants Lucide. Le sélecteur
d’icônes d’agent charge les noms recherchables à l’ouverture et ne rend que les
icônes demandées, y compris les alias numérotés enregistrés. Le build vérifie les
imports statiques transitifs de Settings, pas seulement la taille de son entrée,
afin d’éviter des milliers de petits téléchargements d’icônes. L’enregistrement
automatique n’établit sa référence qu’une fois tous les documents modifiables
chargés ; ouvrir ou fermer une session lentement initialisée ne doit pas écrire.
La même réponse de configuration fournit les paramètres de fournisseurs IA
assainis. Le chargement ne demande pas une seconde fois tout le catalogue de
fournisseurs/modèles simplement pour obtenir ces champs ; références d’identifiants,
indicateurs de disponibilité et extensions des fournisseurs sont conservés.
Les éditeurs se chargent avec leur section choisie, et les dialogues secondaires
uniquement à l’ouverture. La liste des plugins installés diffère également chaque
éditeur intégré jusqu’à l’ouverture de sa configuration. Les indicateurs de
chargement restent dans le contenu choisi afin de garder disponibles la navigation
et le bouton de fermeture.

La boîte de réception charge son lecteur et son compositeur à l’ouverture d’un
message ou brouillon. Le panneau de détail vide est indépendant de l’éditeur
riche et des outils de calendrier ; la boîte de réception et une action de fermeture
restent disponibles pendant leur chargement. Les formulaires d’événements, outils
de disponibilité et recherche globale se chargent aussi à l’ouverture, sans
modifier l’enregistrement des brouillons, la visibilité ou les récurrences.
Les aperçus de titre diffèrent leur carte de page et rendu Markdown jusqu’au
survol du titre ou son ouverture au clavier. L’entrée du pointeur lance le
module pendant le délai de survol existant ; sortir annule toujours l’ouverture
et la navigation reste utilisable. Les budgets de build couvrent tous les graphes
d’imports statiques du courrier et du calendrier, y compris le démarrage partagé :
une petite entrée de route ne peut donc pas cacher un éditeur chargé immédiatement.

Les abonnements push du courrier attendent de façon asynchrone ; les onglets
inactifs n’occupent plus le pool de workers entre événements. Les notifications
émises par des threads conservent filtres de compte, ordre borné et nettoyage
à l’annulation ou déconnexion. Les vues locales et requêtes de tags utilisent
le dispatch synchrone vers les workers FastAPI, conservant le contexte du vault
actif et laissant la boucle de requêtes disponible. Les imports à froid du
fournisseur hybride s’exécutent aussi dans des workers et sont omis pour les
messages lus en cache.

Les mises à jour d’intégrations préservent les références du magasin sécurisé
et ne résolvent que les identifiants modifiés. Les lectures de configuration à
références seules n’attendent pas derrière un lecteur qui déverrouille des
identifiants. La synchronisation IMAP résout le compte sélectionné dans l’une
ou l’autre section prise en charge sans déverrouiller tous les comptes mail.
Le dispatch des fournisseurs de calendrier lit les métadonnées de compte sans
déverrouiller les identifiants. Les clients Google et CalDAV ne résolvent que
les identités calendrier/email correspondantes ; Google filtre aussi fournisseur
et authentification OAuth avant l’accès au magasin sécurisé. La priorité
calendrier-avant-email et les lectures fraîches restent identiques.
Les lectures simultanées d’identifiants Google Calendar ne partagent que le
travail encore en cours pour le même email, document de configuration et instantanée
de révision/références. Lectures terminées ou échouées sont retirées immédiatement ;
les appels suivants résolvent à nouveau les identifiants. Chaque appelant reçoit
des données indépendantes et construit son propre client. Les chemins des rappels
utilisent directement `resolve_data_dir()`, sans charger les paramètres du vault
ni créer de répertoires pendant la résolution. L’écriture atomique prépare le
répertoire parent local quand il faut enregistrer l’état.

La configuration réutilise le YAML décodé des fichiers inchangés en vérifiant
périphérique, inode, taille, dates de modification/changement et autorisations
à chaque lecture. Les lecteurs simultanés partagent une lecture à froid du même
fichier ; les autres vaults restent indépendants et tous reçoivent des documents
indépendants. Les lectures échouées ou instables ne sont pas réutilisées.
Le cache conserve au plus 16 documents d’au plus 1 MiB chacun. Environnement et
sélection du vault restent actuels. La découverte des chemins ne réutilise que
l’emplacement du module dans le checkout et vérifie les répertoires existants
avant création ; suppression et changement des sélecteurs de données/vault
conservent la réparation normale.

La disponibilité des identifiants résout les alias d’environnement du fournisseur
depuis l’instantanée actuelle du catalogue, les métadonnées locales téléchargées
ou incluses. Elle n’actualise pas models.dev, ne sonde pas Ollama et n’attend pas
une actualisation du catalogue en cours. Les lectures explicites du catalogue
s’actualisent normalement. Les index locaux d’alias sont bornés et relus après
remplacement ou modification ; la résolution des secrets et les indicateurs
assainis `has_api_key` conservent leur priorité. Les vérifications simultanées
partagent le premier décodage de chaque catalogue inchangé. Fichiers distincts
et remplacements progressent indépendamment ; les erreurs sont libérées et
retentées à la prochaine recherche sans entrée de cache d’échec.

La navigation Settings et les éditeurs de plugins intégrés utilisent les
transitions React pour maintenir les commandes actuelles pendant le chargement
d’un autre éditeur. Les lectures simultanées de tables et de pages partagent une
requête par vault, table et filtre, y compris lors des remontages de développement ;
les suivantes revalident toujours, et fermer un consommateur n’annule pas les autres.

Les lectures des pages d’une table préparent les noms de champs actuels,
identifiants immuables et alias une fois par lot. Les lignes dont les clés n’ont
pas besoin d’être renommées sont copiées sans suivi des collisions. Priorité
nom/ID/alias, ordre des clés, métadonnées locales opaques et validation HTTP
sont conservés. Les correspondances préparées restent dans une lecture de table ;
les suivantes les reconstruisent, gardant indépendants renommages et schémas
propres aux vaults.

Le graphe ne demande que sa configuration à `/api/config/graph`. Cette lecture
hérite du contrôle d’autorisation et du contexte de vault existants, sans inspecter
les identifiants IA ou du mot de passe système. Le document Settings complet
conserve son comportement assaini d’état des identifiants. Les actualisations
des préférences du graphe lisent toujours la configuration courante.
Après projection, la construction libère les adjacences et attributs NetworkX
temporaires, y compris en cas de résultat partiel ou d’échec. Les vues en cache
pourraient autrement conserver ce stockage jusqu’à une collecte cyclique globale
du processus ; réponse projetée et cache des nœuds gardent leurs données
indépendamment. Les graphes intégrés des vaults utilisent leurs options de vue
explicites et ne demandent pas une configuration globale inutilisée au montage,
aux changements de configuration ou aux relances partielles.

L’entrée Settings, sa navigation de sections et les boutons de configuration des
plugins intégrés préparent le module d’éditeur choisi à l’intention du pointeur,
du focus clavier ou du toucher. Les mêmes chargeurs servent React.lazy ; cette
préparation ne monte jamais de section, ne lit pas les documents modifiables et
n’enregistre aucun paramètre. Les téléchargements spéculatifs échoués sont ignorés :
l’ouverture garde la gestion normale du chargement et des erreurs. Mesurez
séparément le délai entre clic et contrôles renseignés et activés, la préparation
du module et la première frame modale ; avancer un téléchargement avant le clic
ne prouve pas que le chargement des données respecte l’objectif de latence.

Avant d’accepter des requêtes, le démarrage parcourt dans un worker les contextes
de validation des routes incluses de FastAPI, sans générer le schéma API public
facultatif ni exécuter les dépendances des endpoints. Cela évite la construction
paresseuse des routes à la première requête du navigateur, tout en conservant
la génération et la cache normales à la demande du schéma. Le démarrage des
intégrations reste différé jusqu’à la fin de cette préparation ; authentification
et validation des paramètres s’exécutent toujours pour chaque requête concernée.

Les révisions de schéma `vault_0005`–`vault_0006` ajoutent les index Reader par
date de publication, état lu et source. Elles évitent de parcourir les corps
d’articles et de trier toute la table avant la limite de liste. Le migrateur normal
sauvegarde la base et vérifie schéma, intégrité et nombres de lignes ; contenus
et champs de réponse sont conservés. Un index couvrant d’inventaire évite à
l’agrégation des sources/comptes d’ouvrir les corps. Les tests de plan de requête
couvrent les quatre variantes de liste et l’agrégation d’inventaire.
L’interface Reader demande `include_content=false` pour la liste, conservant
métadonnées, filtrage et ordre, sans les corps stockés dans la requête SQL ni la
réponse HTTP. Ouvrir un article charge son corps complet séparément ; une nouvelle
sélection annule la précédente et les erreurs proposent une relance. L’API de
liste par défaut et les liens directs gardent leur contrat de contenu complet.

Planning considère un fichier d’état/historique existant mais illisible, ou un
état corrompu, comme indisponible, jamais comme un nouveau plan vide. Les lignes
d’historique individuellement malformées restent ignorées selon le comportement
existant. Les erreurs temporaires du fournisseur renvoient 503 avec
`planning_storage_pending` et `Retry-After` ; les lectures réessaient pendant une
fenêtre bornée, sans jamais répéter automatiquement les mutations. Les clés de
requête incluent le vault actif et les résultats provisoires du projet précédent
ne sont réutilisés que dans ce vault. Le projet choisi est résolu depuis les
références compactes des pages avant de charger son planning et ses références initiales.

Les réponses d’images distinguent téléchargements encore en cours et échecs
confirmés avec `X-Gnosi-File-Availability`. Une miniature ne réessaie qu’après une
erreur réelle d’image, respecte le délai, annule au démontage et réutilise les
octets de la réponse réussie. Les échecs proposent une relance manuelle après
un court délai. Une demande de préparation ou des blocs alloués ne prouvent pas
la disponibilité : le fournisseur vérifie la lisibilité dans un worker. La fin
du téléchargement cloud dépend toujours du fournisseur et doit être vérifiée
avec de vrais fichiers.

Un timeout du catalogue des plugins garde les accès aux fonctionnalités fermés
et affiche une relance explicite dans le shell et le contrôle de route des plugins.
Une lecture échouée ne prouve pas que les plugins sont désactivés ; ne remplacez
pas l’indisponibilité par un catalogue vide réussi. Lectures et réponses en cours
d’activation/paramètres sont propres au vault actif ; un succès ou retour arrière
tardif d’un ancien vault ne peut pas remplacer l’état actuel.

Les reconstructions du graphe sont partagées par vault ; les lectures en cache
évitent de reconstruire le registre. Après 30 secondes, le service revalide
chemins/dates indexés, registre, colonnes des contacts, propositions en attente,
paramètres et sidecars gérés. Une instantanée complète inchangée conserve son
objet graphe et ses corps encodés. Les petites lectures de sidecars réussies
réutilisent un LRU d’au plus 512 documents de 64 KiB chacun, après vérification
du périphérique, inode, mode, dates, taille et allocation. Les lectures échouées
ou instables ne sont jamais retenues ; les documents retournés sont indépendants.
Une instantanée modifiée est reconstruite depuis les entrées capturées et revérifiée
avant publication. Les entrées non fiables ne peuvent renouveler une réponse
réussie. Les lectures de sidecars sont strictes et propres au vault de la requête ;
les changements sémantiques actualisent aussi ses nœuds analysés. Sans index
canonique, la reconstruction périodique normale reste le repli.
La compression JSON du graphe s’exécute dans un worker et réutilise les octets de
la même instantanée immutable, conservant invalidation et gestion des résultats
partiels. Les comptes de dossiers mail utilisent une connexion séparée et courte
pour que leur scan ne sérialise pas la liste des messages sur sa connexion.
La liste des en-têtes ne demande que les champs consommés ; la résolution des
identifiants reste fraîche au moment d’utiliser le fournisseur. Settings charge
tables et bases en parallèle et garde chaque résultat réussi si l’autre échoue.
Le démarrage fait chevaucher lecture de santé et préparation des routes, en
partageant la requête en cours avec le contrôle d’authentification et la barre latérale.

Les lectures de messages conservent un champ d’erreur explicite si le fournisseur
ne peut se connecter, sélectionner/rechercher dans le dossier ou lire les en-têtes.
Ces réponses ne remplacent jamais une cache de liste valide et ne renouvellent
pas sa fraîcheur. Les comptes renvoient un 503 retentable en cas d’échec ou
après le délai global de 30 secondes ; une lecture partagée peut finir en fond
pour un autre appelant. Les GET de liste/comptes Microsoft utilisent aussi un
timeout réseau de 20 secondes, bornant le worker sous-jacent. L’interface publie
les comptes réussis dès leur arrivée et identifie les comptes en attente ou
indisponibles ainsi que les valeurs antérieures conservées. Une liste visible
ou une réponse de messages HTTP200 ne prouve pas une lecture fraîche réussie
de tous les comptes. Invalider les comptes retire aussi les identités de lecture
en cours, empêchant un ancien worker de publier ou renouveler une valeur antérieure
à une mutation. La pagination publie la page de chaque compte indépendamment.
Les pages échouées gardent leur curseur et les messages visibles ; la relance
ne demande que ces pages.

Mesurez premières lectures et répétitions, en distinguant les réponses API
complètes du contenu rendu utilisable. Une liste à chaud sous 500 ms n’établit
pas un budget de navigation de 500 ms : scans cloud initiaux, catalogues externes,
miniatures et rendu du navigateur demandent encore des mesures séparées.

## Build du frontend et liens directs

Exécutez `corepack pnpm build:frontend` depuis la racine du dépôt. Les contrôles
préalables incluent le contrat de la configuration réelle de Vite. Par défaut,
les ressources utilisent `/` : les liens profonds et les rechargements résolvent
JavaScript, styles et icônes depuis la racine de l’origine. Le même artefact
convient au web HTTP et au protocole standard `app://gnosi` d’Electron ;
Electron n’exige pas de base relative `./`.

`VITE_BASE_PATH` reste une configuration explicite de la base des ressources.
La valeur `./` réintroduit la résolution relative sur les routes imbriquées.
Un préfixe de ressources ne configure pas la base du routeur et ne démontre pas
la prise en charge de toute l’app sous un préfixe d’URL. Conservez la valeur par
défaut pour les structures web et desktop standard. Le serveur HTTP doit
renvoyer l’entrée SPA pour les routes de l’app, servir les ressources réelles
et transmettre `/api` au backend. Vite preview inclut déjà ce proxy d’API ;
c’est un serveur de validation, pas une acceptation du déploiement en production.

## Configuration et données persistantes

Le chargement de l’environnement du backend suit cet ordre pour chaque
variable : environnement du processus, `.env` local du dépôt, puis fichier
partagé explicitement sélectionné par `GNOSI_SHARED_ENV_FILE`. Aucun
`.env_shared` n’est recherché implicitement dans les répertoires parents.
Le fichier partagé appartient à l’opérateur et le nettoyage de l’environnement
de Gnosi ne le modifie pas. Le stockage sécurisé natif peut fournir les
identifiants manquants ; il ne remplace pas une valeur déjà renseignée.

Après le chargement, la résolution du répertoire de données retient la première
valeur non vide dans cet ordre : `GNOSI_DATA_DIR`, `GNOSI_LOCAL_DATA`,
`LOCAL_DATA_DIR`, puis la valeur par défaut de la plateforme. Les deux alias
sont obsolètes, mais restent pris en charge pendant toute la série 3.x.
Configurez le nom canonique de façon cohérente : une valeur canonique
conflictuelle l’emporte sur un alias, même si celui-ci provient d’une source
d’environnement plus prioritaire. Préférez les chemins absolus : les chemins
relatifs sont résolus à partir du répertoire de travail du processus.

| Environnement du backend | Répertoire de données par défaut sans configuration explicite |
| --- | --- |
| macOS | `~/Library/Application Support/Gnosi` |
| Linux | `$XDG_DATA_HOME/gnosi`, sinon `~/.local/share/gnosi` |
| Windows | `%APPDATA%\Gnosi`, sinon `~/AppData/Roaming/Gnosi` |
| Docker | `/data` ; Compose y monte le volume nommé `gnosi_local_data`. |

L’ancien répertoire `local_data` dans le checkout n’est pas la valeur par
défaut en mode natif. Le contenu du vault et sa configuration `.gnosi/`
sont distincts de l’état propre à chaque appareil. Placez `GNOSI_DATA_DIR`
sur un stockage local non synchronisé, hors de l’arborescence du code.
Préservez `system/management.sqlite`, `system/tool_registry.sqlite`,
`system/checkpoints`, `secrets` et tout autre état nécessaire avant
une réinstallation ou une migration. Ne copiez pas de fichiers SQLite en
cours d’utilisation dans un vault synchronisé et ne lancez pas d’instances
indépendantes de Gnosi sur le même répertoire de données. Une nouvelle
connexion OAuth peut être nécessaire sur un autre appareil, car les
identifiants et le stockage sécurisé sont locaux.

Pour déplacer volontairement les données, examinez
`scripts/migrate-data-dir.py` : il propose `plan`, `migrate`, `status`,
`rollback` et `finalize`. La planification peut créer le répertoire parent
de destination ; il ne s’agit donc pas d’un diagnostic strictement en lecture
seule. Arrêtez tous les processus qui écrivent avant une migration ou un
retour arrière ; `--writers-stopped` est une confirmation de l’opérateur,
pas un détecteur de processus. Le service journalise la progression, vérifie
l’intégrité SQLite et consolide le WAL. Il effectue un renommage sur le même
volume ou une copie intermédiaire vérifiée entre volumes ; dans ce dernier
cas, il conserve la source. Gardez le journal et la sauvegarde, vérifiez la
destination, puis configurez `GNOSI_DATA_DIR` avant de redémarrer.
Modifier uniquement la variable ne déplace pas les données existantes.

## Première séquence de diagnostic

1. Identifiez l’environnement choisi, le checkout, le propriétaire du processus
   et le processus à l’écoute sur chaque port avant tout démarrage ou redémarrage.
2. Examinez les journaux du backend et du frontend de cet environnement ;
   ne présumez pas des chemins propres aux LaunchAgents.
3. Consultez `/api/health` : `status`, `mode`, `gnosi_mode`,
   `require_auth` et `vault_configured`. Une réponse de santé ne prouve
   pas que le vault est lisible.
4. Utilisez une session autorisée pour `/api/config` et `/api/vault/pages`.
   Distinguez les erreurs d’authentification ou d’autorisation d’un vault vide
   ou d’une erreur d’E/S ; masquez les identifiants et les chemins privés
   avant de partager les diagnostics.
5. Confirmez le vault actif, le répertoire de données effectif et le fournisseur
   sélectionné. Ne réinitialisez pas les paramètres et ne remplacez pas de
   bases de données pour corriger un chemin erroné.
6. Reproduisez l’action concernée dans l’interface en examinant la console du
   navigateur et les journaux du backend, puis exécutez le test le plus ciblé.
7. Après la réparation, vérifiez les données renvoyées et l’action visible ;
   le seul redémarrage d’un processus ne prouve pas le rétablissement du service.

## Disponibilité des fichiers et récupération propre au fournisseur

Commencez par l’adaptateur sélectionné dans `backend/platform/files`.
`GNOSI_FILES_PROVIDER` sélectionne explicitement un fournisseur reconnu ;
sinon, la détection utilise `VAULT_HOST_PATH`. `LocalProvider` n’effectue
aucune hydratation. Le nom d’un fournisseur ou une interface partagée ne
garantissent pas le comportement de tous les clients cloud sur tous les
systèmes d’exploitation.

Sur un stockage File Provider de macOS, `EDEADLK` ou `EAGAIN` peuvent
signaler des fichiers indisponibles qui existent uniquement dans le cloud.
Ces erreurs ne prouvent, à elles seules, ni une défaillance du fournisseur ni
une défaillance de l’analyseur Markdown : vérifiez le chemin exact, les
indicateurs du fichier, les blocs téléchargés et l’état du client.
Réessayez sur le périmètre concerné le plus restreint, avec un nombre limité
de tentatives séquentielles ; ne transformez pas une analyse de récupération
partielle en index complet et ne remplacez pas un contenu illisible par des
fichiers vides. Conserver les répertoires critiques téléchargés localement
peut éviter que le problème se reproduise.

L’adaptateur actuel de fichiers à la demande utilise `open` par défaut sur
macOS natif et délègue les lectures à une application graphique via
LaunchServices ; les lectures directes depuis un processus launchd peuvent
ne pas déclencher le téléchargement. Le mode daemon appelle un service
auxiliaire configuré sur l’hôte, avec les adresses par défaut
`http://127.0.0.1:5009/warmup` en mode natif ou
`http://host.docker.internal:5009/warmup` depuis Docker. Ce service doit
effectivement être configuré pour l’environnement choisi ; le port 5009
n’est ni un prérequis général au démarrage ni la preuve que l’hydratation
fonctionne avec n’importe quel cloud.

Seul l’adaptateur OneDrive active le redémarrage du client OneDrive après
l’échec d’une tentative `open`. `ONEDRIVE_AUTO_RESTART=0` désactive cette
action ; le délai minimal par défaut entre redémarrages est de 300 secondes.
Traitez les redémarrages du client et la configuration des services auxiliaires
de l’hôte comme des changements opérationnels distincts. N’appliquez pas
les instructions de récupération OneDrive aux autres fournisseurs.

## Configuration facultative de l’hôte macOS

Les 15 anciens scripts d’exécution de l’hôte (installateurs, watchdogs et outils
de l’hôte), ainsi que les lanceurs obsolètes `run_brain.sh` et `run_prod.sh`,
ont été retirés du dépôt public. Les opérations de l’hôte relèvent du dépôt
privé `WorkspaceTools`. Exécutez `pnpm check:runtime` après avoir indexé les
changements examinés : CI rejette les scripts retirés, les liens symboliques et
l’état local dans l’index Git. Les installations existantes peuvent
écrire leurs journaux dans `~/Library/Logs/Gnosi` ; examinez leur configuration
réelle. Ce sont des commodités facultatives de l’hôte, pas le contrat de
démarrage portable. Les définitions de services propres à chaque machine,
les chemins privés et l’historique des incidents relèvent du dépôt privé
`WorkspaceTools`, pas des prérequis publics.

Ce nettoyage du checkout ne modifie, ne migre ni ne désinstalle les services
installés de l’hôte. Les scripts portables ci-dessus n’installent ni ne
suppriment les services existants de l’hôte. L’ancien installateur
`install_native_startup.sh` arrête les processus à l’écoute sur 5002/5173 et
recharge les LaunchAgents. N’exécutez pas les installateurs ou watchdogs conservés
comme diagnostic ; examinez la configuration réellement installée et les
procédures privées.

Si une installation utilise encore une copie conservée de `native_watchdog.sh`,
examinez `~/.gnosi_native_watchdog.log` pour repérer les boucles de
redémarrage. Le délai de démarrage (`GNOSI_NATIVE_STARTUP_GRACE`) et le
délai minimal entre redémarrages (`GNOSI_NATIVE_WATCHDOG_COOLDOWN`) sont
tous deux de 600 secondes par défaut. Laissez suffisamment de temps pour un
démarrage à froid ou un rechargement et conservez un intervalle au moins égal
au temps de démarrage mesuré. Un signal d’activité récent du clonage peut
différer le redémarrage. Le script tue aussi les processus multiprocessing
correspondants et appelle launchd : sa sélection de processus est large ;
ne l’exécutez pas comme diagnostic générique et ne l’installez pas sans
examiner les autres traitements Python de l’hôte.

## Déploiement Docker facultatif

Docker est une cible d’auto-hébergement prise en charge et facultative. Le
fichier de base `docker-compose.yml` ne nécessite aucun répertoire de vault
sur l’hôte ni aucun chemin propre au mainteneur :

| Contenu persistant | Volume nommé | Chemin dans le conteneur |
| --- | --- | --- |
| Bases de données et identifiants par appareil | `gnosi_local_data` (clé conservée) | `/data`, via `GNOSI_DATA_DIR` |
| Vaults | `gnosi_vaults` (nouveau volume) | `/vaults`, via `GNOSI_VAULTS_ROOT` ; actif par défaut `/vaults/default` |

Les vaults existants de l’hôte ne sont pas copiés automatiquement dans le
nouveau volume. Conservez le nom du projet Compose lors des mises à jour :
il détermine l’identité des volumes nommés. Le modifier peut sélectionner des
volumes vides alors que les anciennes données existent toujours. Sauvegardez
les bases de données, les identifiants et les vaults avant toute modification.
N’utilisez jamais `docker compose down -v` ni une purge généralisée des volumes
pour réparer les dépendances.

Les ports publiés sont par défaut `127.0.0.1:5002` et `127.0.0.1:5173`.
`GNOSI_BIND_ADDRESS`, `GNOSI_BACKEND_PORT` et `GNOSI_FRONTEND_PORT` configurent
la publication sur l’hôte ; les ports internes restent 5002/5173 et le frontend
relaie les requêtes vers `backend:5002`. Compose impose HTTP au frontend.
Examinez l’authentification, TLS et l’accès réseau avant de modifier l’adresse
d’écoute pour exposer le service.

Fournissez un `GNOSI_JWT_SECRET` privé et robuste via le shell ou le `.env`
local pour l’interpolation Compose. Un `env_file` du service ne suffit pas à
satisfaire l’expression obligatoire. Compose définit explicitement
`GNOSI_REQUIRE_AUTH=1` ; ne désactivez pas l’authentification pour réussir un
test de démarrage.

Compose lit un `env_file` partagé facultatif sélectionné par
`GNOSI_SHARED_ENV_FILE` (repli `.env.shared.disabled`), puis le `.env`
facultatif ; ce dernier l’emporte pour les clés répétées. Les entrées explicites
d’`environment` du service sont prioritaires sur les deux fichiers. Ces règles
concernent l’environnement du conteneur : les variables arbitraires du shell
de l’hôte ne sont pas transmises automatiquement. Compose lit les fichiers
sur l’hôte sans les monter ni les intégrer aux images et vide
`GNOSI_SHARED_ENV_FILE` dans le backend pour éviter de recharger un chemin de
l’hôte. Aucun `.env_shared` des répertoires parents n’est implicitement requis.

L’ensemble inclut le translation-server de Zotero en interne sur 1969, sans
publication sur l’hôte. `GNOSI_TRANSLATION_IMAGE` sélectionne son image ;
`TRANSLATION_SERVER_URL` vaut `http://translation-server:1969` uniquement si
la variable n’est pas définie et conserve une valeur vide explicite.
La traduction est facultative pour Gnosi, mais ce fichier Compose déclare le
service auxiliaire sans profil facultatif.

Pour utiliser des répertoires existants de l’hôte, ajoutez explicitement
`compose.vaults.yml` :

```sh
docker compose -f docker-compose.yml -f compose.vaults.yml up -d --build
```

Avant cette commande, fournissez `VAULT_HOST_PATH` (vault actif existant) et
`VAULTS_ROOT_HOST_PATH` (répertoire parent existant) à l’interpolation Compose.
Les deux chemins sont obligatoires ; les deux montages utilisent
`create_host_path: false` pour refuser les répertoires inexistants. Préférez
des chemins absolus ; les chemins relatifs sont résolus depuis le répertoire
du fichier Compose de base. La surcharge remplace le volume `/vaults` selon
sa cible dans le conteneur, ajoute le montage actif à `/vault` et définit
`DIGITAL_BRAIN_VAULT_PATH=/vault`. Elle conserve `gnosi_local_data:/data` et
transmet les deux chemins choisis sur l’hôte pour traduire les actions sur
les fichiers. Elle ne copie pas de données et ne configure pas les services
auxiliaires de l’hôte.

L’ensemble de base ne monte ni code source, ni dépendances de l’hôte, ni
répertoire personnel, ni arbre privé `.antigravity`, ni répertoire de secrets,
ni socket Docker. La surcharge des vaults ajoute uniquement les deux
répertoires sélectionnés. Le CLI Docker de l’image du backend ne donne pas
accès au moteur de l’hôte sans socket ou endpoint configuré séparément.
Le code et les dépendances appartiennent aux images : il n’y a ni rechargement
du code de l’hôte ni volume anonyme `node_modules` à renouveler. Reconstruisez
les images après une modification du code ou des fichiers de verrouillage ;
préservez les volumes persistants.

`Dockerfile.frontend` utilise Node 22.22.2, pnpm 11.19.0 et
`--frozen-lockfile`, puis sert Vite sur le port strict 5173. Le backend exporte
`uv.lock` avec `--frozen`, installe le wheel Torch épinglé réservé au CPU,
puis les dépendances exportées ; uvicorn fonctionne sans `--reload`.
La disponibilité du wheel, les compilations et le démarrage nécessitent une
validation par plateforme. Les tests statiques du code et des contrats ne
remplacent ni la fusion réelle de Compose, ni les compilations par le moteur,
ni les tests de démarrage des conteneurs, ni l’acceptation par plateforme.

## Validation authentifiée et limites de la QA

L’acceptation native doit tester l’inscription réelle, la création d’un workspace
et du premier vault, la connexion, `/api/auth/me`, les cookies HttpOnly et la
préparation de l’authentification Playwright, avec démarrage et arrêt sans erreur.
Dans le navigateur, il faut créer et modifier une page jetable, la recharger et
la rouvrir pour vérifier la persistance du titre et du corps, examiner la console
et vérifier la déconnexion. La réussite de la fixture et du parcours navigateur
ne valide ni toute la suite E2E, ni la matrice Docker/Electron, ni une publication.

La préparation E2E exige `GNOSI_TEST_EMAIL` et `GNOSI_TEST_PASSWORD`
explicitement fournis pour un compte de test jetable déjà créé, avant tout
accès réseau. Elle se connecte et vérifie la session via `/api/auth/me` ; elle
n’inscrit pas de comptes et n’invente pas d’identité administrateur.
`GNOSI_TEST_WORKSPACE_ID` doit correspondre à une appartenance vérifiée ;
ne l’omettez que s’il en existe exactement une. `GNOSI_TEST_VAULT_ID` est
facultatif et n’accorde aucun droit. Gardez l’état de session privé, de
préférence dans un `GNOSI_TEST_STORAGE_STATE` temporaire, et n’activez pas de
traces, captures, vidéos ou journaux de diagnostic de la préparation pouvant
contenir des identifiants.

`backend/tests/test_vault_creation_membership.py` couvre la création du
premier vault avec une appartenance authentifiée owner/admin/editor, rejette
les requêtes non authentifiées, en lecture seule ou provenant d’autres
workspaces, et vérifie le confinement des chemins ainsi que le listing
d’organisation sans enregistrement du vault personnel. Cette couverture de
non-régression ne remplace pas la validation réelle de l’application et du
navigateur. Le responsable de l’intégration conserve les contrôles complets
du navigateur, de la CI, du SOP et de l’acceptation par plateforme.

Depuis la racine du dépôt, `corepack pnpm test:e2e:contracts` exécute les
contrats d’authentification, JSON et de routage d’API hors ligne, puis vérifie
strictement les types de tous les fichiers TypeScript E2E actifs et de support :
tests fonctionnels, anonymes, d’accessibilité et visuels. L’alias ciblé
`typecheck:auth` reste disponible. Les tests JavaScript archivés sont exclus de
cette vérification. Il ne démarre pas l’application et ne remplace pas l’acceptation réelle de la
connexion et du navigateur.

## Création facultative des paquets Electron

Electron utilise la valeur héritée de `GNOSI_DATA_DIR`, puis
`GNOSI_LOCAL_DATA`, puis `LOCAL_DATA_DIR` ; à défaut, il transmet son
profil `userData` au backend inclus. Ne supposez pas que ce profil correspond
au répertoire par défaut de Python natif sur tous les systèmes d’exploitation.
Préservez le profil ainsi que les données du backend configurées séparément
avant une mise à jour.

Le workspace fixe la version d’Electron et désactive le téléchargement
automatique de son binaire.
`corepack pnpm --filter @gnosi/desktop install:runtime` est l’étape
d’installation explicite du binaire pour exécuter Electron localement.
Compilez le frontend avant de créer le paquet. `desktop/build-python.sh`
nécessite Python 3.11 et uv, crée un environnement temporaire et utilise
`uv sync --frozen --no-default-groups --group desktop` avec le fichier de
verrouillage du dépôt. Il vérifie les limites des ressources, exécute
PyInstaller, vérifie le paquet et lance le test de démarrage du backend
empaqueté. Il n’impose plus pip 25.3 ; diagnostiquez les erreurs de proxy
ou d’index de paquets sur le runner concerné au lieu de rétablir cet ancien
contournement.

| Cible déclarée dans le workflow de publication | Artefacts configurés |
| --- | --- |
| macOS arm64 | DMG et ZIP |
| macOS x64 | DMG et ZIP |
| Linux arm64 | AppImage et DEB |
| Windows x64 | Installateur NSIS |

Il s’agit de cibles configurées, pas de résultats de validation.
L’architecture du backend Python empaqueté doit correspondre à la cible
Electron. Les jobs de publication actuels ne couvrent ni Linux x64 ni
Windows arm64. Les contrats statiques ou une compilation du frontend ne
valident ni une installation vierge, ni le premier lancement, ni la mise à
jour, ni le retour arrière, ni la signature, ni la préservation des données
réelles sur une cible donnée. Exigez des preuves réelles pour chaque
plateforme avant publication ; la validation Docker est une vérification distincte.

## Tableau des symptômes courants

| Symptôme | Domaine probable | Éléments à examiner |
| --- | --- | --- |
| Frontend vide | Erreur JavaScript, fragment périmé, initialisation de l’authentification | Console du navigateur, journal Vite, compilation de production. |
| La santé répond, mais le vault échoue | Chemin du vault, autorisations, disponibilité des fichiers | Configuration autorisée, journaux du vault, chemin exact en échec. |
| Les paramètres reviennent à leur ancienne valeur | Mauvaise destination de params, échec d’écriture, migration | Contexte du vault actif et origine des paramètres. |
| Une intégration semble déconnectée | Identifiant local absent ou sélection de compte périmée | État du compte avec secrets masqués et stockage des secrets configuré. |
| L’agent n’a pas d’outils | Connexion MCP, validation du catalogue, attribution des skills | Journaux de découverte et endpoints de skills autorisés. |
| Le courrier ne se met plus à jour | Processus du compte ou authentification du fournisseur | État du processus de chaque compte et synchronisation incrémentale. |
| L’application de bureau affiche une ancienne version | Renderer/backend périmé ou manifests incohérents | Checkout/paquet réellement exécuté et versions des paquets. |

## Documentation et enseignements des incidents

Utilisez le workflow pre-PR de documentation décrit dans
[Maintenance de la documentation](../testing/documentation-maintenance.md).
Examinez manuellement les quatre langues ; actualisez de manière déterministe
uniquement les catalogues générés. Le responsable de l’intégration exécute les
vérifications pre-PR, les compilations strictes des quatre portails et les
contrôles dans le navigateur une fois les workers terminés. Gardez
`site/engineering` et ses sous-répertoires de langues hors du contrôle de versions.

Le workflow Pages est configuré pour publier les modifications de
documentation de `main` sur le
[portail d’ingénierie](https://gnosi.temenosismael.org/engineering/).
En cas d’échec, examinez la validation des références générées, la traçabilité
et les compilations strictes des langues avant l’artefact Pages. Vérifiez
la source de publication réelle de Pages et les autorisations de
l’environnement `github-pages` ; le code du workflow ne prouve pas la
réussite du déploiement.

Consignez les causes des incidents, les tentatives infructueuses et la
récupération vérifiée. Conservez les détails privés des machines et les
directives de développement dans `WorkspaceTools` ; ne publiez que des
enseignements portables, étayés par le code et les tests. Corrigez
l’implémentation et ajoutez des tests de non-régression ciblés lorsque c’est
justifié. Une récupération effectuée uniquement dans le terminal, sans
vérification ni documentation, ne constitue pas une réparation opérationnelle complète.
