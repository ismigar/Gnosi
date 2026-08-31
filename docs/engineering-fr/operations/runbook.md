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
`VITE_BACKEND_PORT` pour un autre backend (valeurs par défaut : `localhost`
et `5002`). Vite charge ses propres dotenv ; le script n’exporte pas de valeur
par défaut de `VITE_FRONTEND_PORT` qui les masquerait. Les deux scripts
valident les ports fournis entre 1 et 65535, transmettent les arguments et
propagent les codes de sortie. Le frontend conserve les libellés explicites
du checkout et signale un checkout déjà intégré, en retard sur `origin/main`.

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

`scripts/runtime/install_native_startup.sh` installe des LaunchAgents qui
appellent les scripts de démarrage natif. Les installations existantes peuvent
écrire leurs journaux dans `~/Library/Logs/Gnosi` ; examinez leur configuration
réelle. Ce sont des commodités facultatives de l’hôte, pas le contrat de
démarrage portable. Les définitions de services propres à chaque machine,
les chemins privés et l’historique des incidents relèvent du dépôt privé
`WorkspaceTools`, pas des prérequis publics.

Les scripts d’installation de l’hôte et de watchdog existent toujours ; ils
n’ont pas été retirés. Les scripts portables ci-dessus n’installent ni ne
suppriment les services existants de l’hôte. Examinez
`install_native_startup.sh` avant de l’utiliser : il arrête les processus à
l’écoute sur 5002/5173 et recharge les LaunchAgents. Ne l’exécutez pas comme
diagnostic. Conservez la traçabilité du code et les avertissements propres à
l’hôte jusqu’à un retrait effectif, après examen des appels et conservation
d’une copie privée exacte.

Si une installation utilise déjà `scripts/runtime/native_watchdog.sh`,
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
contrats d’authentification hors ligne et la vérification stricte de leurs types.
Il ne démarre pas l’application et ne remplace pas l’acceptation réelle de la
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
