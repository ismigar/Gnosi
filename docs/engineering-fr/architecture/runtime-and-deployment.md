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

# Exécution et déploiement

Cette page décrit les contrats examinés dans le code à la date de vérification.
Docker est une cible de déploiement prise en charge et facultative ; le
développement natif reste le choix par défaut. Ni l’examen du code ni une cible
de publication configurée ne prouvent l’acceptation par plateforme. Consultez
le [guide d’exploitation](../operations/runbook.md) pour les commandes,
la préservation des données et le diagnostic.

## Exécution native

Démarrez les deux scripts du dépôt depuis des terminaux. Les LaunchAgents de
macOS constituent une configuration facultative de l’hôte, pas un prérequis :

| Processus | Script dans `scripts/runtime/` | Adresse par défaut | Rechargement du code |
| --- | --- | --- | --- |
| Backend | `run_native_dev.sh 5002` | `127.0.0.1:5002` | uvicorn surveille `backend/`. |
| Frontend | `run_native_frontend.sh --config vite.config.js --host 127.0.0.1` | HTTP(S) `127.0.0.1:5173` | Vite recharge le code. |

Le backend utilise `uv run --project "$BASE" --frozen --no-sync` avec
l’environnement Python existant à la racine. Les seules autorités pour
l’environnement et les données sont les fonctions Python `load_env()` et
`resolve_data_dir()`, pas une analyse dotenv dans le shell. La priorité par
variable est : environnement du processus, `.env` du dépôt, puis fichier
partagé explicitement sélectionné par `GNOSI_SHARED_ENV_FILE` ; aucun
`.env_shared` des répertoires parents n’est déduit. Le résolveur de données
sélectionne `GNOSI_DATA_DIR`, puis `GNOSI_LOCAL_DATA`, puis `LOCAL_DATA_DIR`,
puis la valeur par défaut de la plateforme. Le script ne choisit pas de vault
sans configuration et n’impose ni OneDrive, ni fournisseur, ni `HOME_HOST_PATH`,
ni fuseau horaire, ni modèle, ni endpoint de traduction.

Le frontend définit `COREPACK_ENABLE_NETWORK=0` et exécute
`corepack pnpm --filter @gnosi/frontend dev`. L’exemple transmet explicitement
la configuration Vite et l’adresse de bouclage ; sinon, l’adresse configurée
dans Vite s’applique. Le script conserve les valeurs explicites de
`VITE_BACKEND_HOST` et `VITE_BACKEND_PORT` (par défaut : `localhost` et
`5002`). Vite gère ses propres dotenv ; le script laisse `VITE_FRONTEND_PORT`
indéfinie si elle est absente, pour ne pas les masquer. Il conserve également
les libellés explicites du checkout et peut signaler un checkout servi qui
est un ancêtre déjà intégré d’`origin/main`.

Les deux scripts valident les ports fournis entre 1 et 65535, transmettent les
arguments et propagent les codes de sortie. Ils n’installent ni ne synchronisent
les dépendances ; le gestionnaire de paquets épinglé et les environnements
verrouillés doivent déjà être préparés. Le rechargement du code ne met pas à
jour les dépendances. `uv.lock` fait autorité, mais ses choix par plateforme
ne certifient pas la pile ML sur tous les systèmes ou toutes les architectures.

## Auto-hébergement Docker

Le fichier de base `docker-compose.yml` fournit le backend, le frontend et
le translation-server de Zotero sans exiger de chemins de vault sur l’hôte
ni d’outils privés :

| Stockage | Volume nommé | Chemin du backend |
| --- | --- | --- |
| État par appareil | `gnosi_local_data` (clé existante) | `/data` ; `GNOSI_DATA_DIR=/data` |
| Vaults | `gnosi_vaults` (nouveau) | `/vaults` ; `GNOSI_VAULTS_ROOT=/vaults`, `DIGITAL_BRAIN_VAULT_PATH=/vaults/default` |

Conservez le nom existant du projet Compose et les deux volumes de données lors
des mises à jour ; le nom du projet détermine l’identité des volumes nommés.
Un nouveau volume de vaults n’importe pas les vaults existants de l’hôte.
N’utilisez jamais `docker compose down -v` ni une purge généralisée des volumes
pour réparer les dépendances ; préservez les bases de données, les identifiants
et le contenu des vaults avant toute migration.

Les ports sont publiés sur l’interface de bouclage par défaut :
`127.0.0.1:5002` et `127.0.0.1:5173`. `GNOSI_BIND_ADDRESS`,
`GNOSI_BACKEND_PORT` et `GNOSI_FRONTEND_PORT` contrôlent la publication sur
l’hôte. Les ports internes restent 5002/5173 ; le frontend utilise HTTP et
relaie le trafic API/WebSocket vers `backend:5002`. Examinez les accès et TLS
avant d’exposer une autre adresse. Un `GNOSI_JWT_SECRET` privé et robuste est
requis lors de l’interpolation Compose via le shell ou le `.env` local ; un
`env_file` du service ne peut pas le fournir à lui seul.
`GNOSI_REQUIRE_AUTH=1` est explicite.

Compose lit facultativement le fichier partagé sélectionné par
`GNOSI_SHARED_ENV_FILE` (repli `.env.shared.disabled`), puis le `.env` local
facultatif. Les valeurs locales l’emportent sur les valeurs partagées ;
`environment` explicite du service l’emporte sur les deux. Les valeurs
arbitraires du shell de l’hôte ne deviennent pas automatiquement des variables
du conteneur. Ces fichiers ne sont ni montés ni intégrés aux images. Compose
vide `GNOSI_SHARED_ENV_FILE` dans le backend après avoir chargé leurs valeurs.

Le translation-server de Zotero reste interne sur 1969.
`GNOSI_TRANSLATION_IMAGE` sélectionne son image ; `TRANSLATION_SERVER_URL`
vaut `http://translation-server:1969` uniquement si elle n’est pas définie,
et conserve une valeur vide explicite. La traduction est facultative pour
l’application ; le Compose actuel inclut ce service sans profil facultatif.

La surcharge explicite `compose.vaults.yml` exige les deux chemins existants
de l’hôte : `VAULT_HOST_PATH` pour le vault actif et `VAULTS_ROOT_HOST_PATH`
pour son parent. Les deux montages utilisent `create_host_path: false`.
La fusion selon la cible dans le conteneur remplace le volume `/vaults`, ajoute
`/vault`, définit `DIGITAL_BRAIN_VAULT_PATH=/vault` et conserve
`gnosi_local_data:/data`. Les deux chemins de l’hôte sont transmis explicitement
pour les actions sur les fichiers. Les chemins relatifs sont résolus depuis
le répertoire du Compose de base ; préférez des chemins absolus. Cette surcharge
ne migre pas les données et ne configure pas les services auxiliaires de l’hôte.

Aucun montage implicite ne donne accès au répertoire personnel, à l’arbre privé
`.antigravity`, au répertoire de secrets, au socket Docker, au code source
ou aux dépendances de l’hôte. Seule la surcharge explicite ajoute ses deux
montages de vaults. Un CLI Docker dans l’image du backend ne donne pas accès
au moteur de l’hôte sans socket ou endpoint explicitement configuré. Le code
et les dépendances appartiennent aux images : aucun rechargement du code de
l’hôte ni volume anonyme `node_modules`. Reconstruisez les images après toute
modification du code ou des fichiers de verrouillage.

L’image du frontend fixe Node 22.22.2 et pnpm 11.19.0, installe avec
`--frozen-lockfile` et exécute Vite sur le port strict 5173. Le backend exporte
`uv.lock` avec `--frozen`, installe le wheel Torch épinglé réservé au CPU
avant les dépendances exportées et exécute uvicorn sans `--reload`.
La disponibilité du wheel, la compilation et le démarrage réels restent des
exigences d’acceptation par plateforme. Les tests statiques des contrats ne
remplacent ni la fusion réelle de Compose, ni les compilations d’images,
ni les tests de démarrage des conteneurs, ni l’acceptation par plateforme.

## Paquets Electron

Electron gère le cycle de vie de l’application empaquetée. Il démarre le backend
Python inclus, expose une interface IPC limitée via preload, ouvre le renderer
et gère l’état des mises à jour manuelles. Le renderer s’abonne aux mises à
jour et peut consulter leur état le plus récent pour ne pas manquer les
événements émis avant le montage de React.

Le processus de bureau installe un menu natif explicite au lieu du menu de
développement par défaut d’Electron. React reste la source de vérité des
libellés traduits : une fois la langue configurée résolue, le renderer transmet
un ensemble validé de libellés via preload et répète l’échange au changement
de langue. Les commandes natives de paramètres reviennent à la fenêtre modale
existante des paramètres globaux. Les menus de production excluent le
rechargement et les outils de développement.

Les fenêtres principales de Gnosi sont gérées indépendamment. Fichier → Nouvelle
fenêtre crée un autre renderer utilisant le même backend inclus ; fermer une
fenêtre ne supprime que celle-ci, et l’activation depuis le Dock de macOS
recrée une fenêtre principale après la fermeture de la dernière. Les commandes
de menu destinées au renderer ciblent une fenêtre existante ou attendent
qu’un nouveau renderer soit disponible avant leur transmission.

Les jobs de compilation et de publication produisent les installateurs par
plateforme et les métadonnées nécessaires à `electron-updater`. Les brouillons
restent non publiés jusqu’à l’examen de tous les artefacts par un mainteneur.
Les cibles configurées et les contrats statiques ne prouvent ni une installation
vierge, ni le premier lancement, ni la mise à jour, ni le retour arrière,
ni la signature, ni la préservation des données ; chaque plateforme nécessite
ses propres preuves.

## Services auxiliaires de l’hôte

Les services host-open peuvent fournir l’ouverture de fichiers, la recherche
Spotlight, les sélecteurs natifs et les actions de corbeille. Les services de
fichiers cloud peuvent hydrater les fichiers uniquement en ligne ; la
récupération propre à un fournisseur relève de son adaptateur. Ces intégrations
facultatives nécessitent une configuration explicite ; elles ne sont pas des
prérequis au démarrage portable.

Les 15 anciens scripts d’exécution de l’hôte (installateurs, watchdogs et outils
de l’hôte), ainsi que les lanceurs obsolètes `run_brain.sh` et `run_prod.sh`,
ont été retirés du dépôt public. Les opérations de l’hôte relèvent du dépôt
privé `WorkspaceTools`. L’ancien installateur `install_native_startup.sh` arrête
les processus à l’écoute sur 5002/5173 et recharge les LaunchAgents. Une copie
conservée de `native_watchdog.sh` peut tuer des processus multiprocessing selon
une sélection large et redémarrer via launchd ; n’exécutez aucun de ces scripts
comme diagnostic générique. Examinez la configuration réellement installée et
les procédures privées. Ce nettoyage du checkout ne modifie, ne migre ni ne
désinstalle les services installés de l’hôte. Les scripts portables restent le
contrat de démarrage natif.

## Invariants des ports et des processus

- Un seul processus peut écouter sur chaque adresse/port choisi ; 5002/5173 sont
  des valeurs par défaut, pas une autorisation de partager l’écoute entre les
  instances natives et Docker.
- Vite utilise `strictPort` ; basculer silencieusement vers un autre port est un
  échec de QA.
- Le rechargement natif ne met pas à jour les dépendances ni les versions injectées
  au démarrage ; le code des conteneurs nécessite une reconstruction de l’image.
- La QA du navigateur suit le protocole du Vite actif. Sans certificats locaux
  lisibles, HTTP s’applique ; HTTPS automatique utilise ces certificats,
  `VITE_DEV_HTTPS=false` impose HTTP et `VITE_DEV_HTTPS=true` les exige.

## Contrôles de santé et d’acceptation

`/api/health` indique l’état du processus, le mode, la politique effective
d’authentification et la configuration du vault. Vérifiez `/api/config` et
`/api/vault/pages` avec une session autorisée ; une réponse du processus ne
prouve pas que le vault est lisible.

L’acceptation native doit tester l’inscription réelle, la création d’un workspace
et du premier vault, la connexion, `/api/auth/me`, les cookies HttpOnly et la
préparation de l’authentification Playwright, avec démarrage et arrêt sans erreur.
Dans le navigateur, il faut créer/modifier une page jetable, la recharger/rouvrir
pour vérifier la persistance du titre et du corps, examiner la console et vérifier
la déconnexion. La préparation exige `GNOSI_TEST_EMAIL` et `GNOSI_TEST_PASSWORD`
explicitement fournis pour un compte jetable existant, déduit l’identité et
l’appartenance au workspace de la session vérifiée et n’inscrit jamais de compte
ni n’invente de privilèges administrateur. `GNOSI_TEST_WORKSPACE_ID` doit
correspondre à une appartenance ; sans cette variable, il en faut exactement
une. `GNOSI_TEST_VAULT_ID` est facultatif et n’accorde aucun accès. Gardez les
identifiants, les cookies et `GNOSI_TEST_STORAGE_STATE` privés.

`backend/tests/test_vault_creation_membership.py` couvre la création autorisée
du premier vault, les refus liés à l’authentification, au rôle et au workspace,
le confinement des chemins et les listings d’organisation sans enregistrement
du stockage personnel. Ces contrôles ciblés ne certifient ni toute la suite
E2E, ni la matrice Docker/Electron, ni une publication. Le responsable de
l’intégration réalise les contrôles restants du navigateur réel, de la CI, du
SOP, de la génération documentaire et de l’acceptation par plateforme.
