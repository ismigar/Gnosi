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

# Socle de la plateforme et environnement d'exécution

## Responsabilité

Le socle assemble les domaines dans un processus unique, résout la configuration et les chemins portables, gère le démarrage et l'arrêt, applique les middlewares partagés et expose le shell principal du frontend. Il doit rester utilisable sans les intégrations facultatives.

Le répertoire `app` du frontend gère l'amorçage, les fournisseurs, la composition
des routes et l'accueil chargé immédiatement. Les écrans facultatifs des
domaines passent par leurs modules publics avec des imports différés indépendants.
Les contrats de composition préservent les 32 routes, les contrôles de permissions,
l'ordre des fournisseurs et les vingt imports différés.

## Assemblage du backend

`backend/server.py` construit l'instance FastAPI, les middlewares, la gestion
des exceptions, le montage statique du lecteur, le cycle de vie et les routeurs.
Leur ordre est explicite, car le contexte du workspace et les préfixes généraux
peuvent se chevaucher. Le [catalogue API](../generated/api-catalog.md) généré
répertorie chaque montage et route statiques. Le registre de composition importe
directement chaque routeur canonique de domaine ; les anciennes façades API ne
restent disponibles que pour les imports de compatibilité. Les annotations des
routes doivent préserver la représentation OpenAPI figée : les gestionnaires
sans modèle de réponse explicite conservent leur contrat de réponse inféré.

Le démarrage du cycle de vie effectue les catégories de travail suivantes :

Le module de cycle de vie conserve `lifespan` comme orchestrateur linéaire. Des
fonctions bornées gèrent les plugins, l'agent, les index, la réparation des
tables, le courrier et l'arrêt sans modifier l'ordre ni l'isolation des erreurs.

La réconciliation précoce des plugins est indépendante du transport : elle lit
l'état normalisé et persisté atomiquement par vault avant tout import de module
de routes HTTP. La construction de l'agent ne dépend donc pas de l'ordre
d'initialisation des façades du vault, tandis que le démarrage normal converge
vers le même magasin d'état partagé par le processus.

1. Vérifier qu'un déploiement exposé n'utilise pas le secret JWT public de développement.
2. Démarrer le planificateur et la maintenance de la rétention des confirmations.
3. Réconcilier les contributions des plugins avant de construire les capacités de l'agent.
4. Connecter les clients MCP, découvrir les outils et compiler le graphe par défaut de l'agent.
5. Précharger de manière synchrone les index persistés des vaults indispensables
   aux requêtes. Démarrer le chargement du cache global des noms de fichiers
   CloudStorage et son parcours dans un seul worker géré en arrière-plan, avec
   l'état `preparing`, `ready` ou `error`.
6. Charger les caches dérivés avant qu'une sauvegarde puisse les tronquer.
7. Démarrer les workers IMAP IDLE de chaque compte.

Les défaillances de l'IA ou du démarrage optionnel de l'intégration sont enregistrées et isolées. Les défaillances de sécurité et d'initialisation des données de base ne sont pas converties silencieusement en comportement sain.

Les caches partagés dans le processus utilisent une implémentation TTL/LRU
unique, bornée et verrouillée, avec des fabriques de valeurs sans argument
explicitement typées. Le transport HTTP MCP en streaming vérifie que chaque
payload SSE décodé est un objet JSON avant de le renvoyer au client JSON-RPC ;
les événements malformés ou non objets n'entrent jamais dans le runtime typé.

## Fusion de la configuration

`load_params()` combine le YAML versionné de l'application avec la configuration de l'utilisateur courant ou du vault actif. Les dictionnaires sont fusionnés récursivement. Le fichier `.gnosi/params.yaml` du vault actif devient la destination persistante des paramètres propres au vault. La résolution des chemins applique ensuite les valeurs explicites de l'environnement de déploiement.

La configuration IA contenant des identifiants secrets stocke des références. Un ancien identifiant d'environnement peut créer un fournisseur une fois, mais un marqueur de déconnexion persisté empêche sa réapparition après une suppression délibérée.

La frontière d'écriture des paramètres valide les agents gérés et les
stratégies de modèle, conserve mots de passe et clés hors du YAML, traite la
carte des fournisseurs comme état souhaité afin de préserver les suppressions,
écrit atomiquement et invalide les agents compilés uniquement après un
changement d'IA.

La migration des données locales est une machine à états journalisée. La
vérification de la source, le renommage atomique sur un même volume, la zone de
transit entre volumes, la vérification de la destination et le retour arrière
automatique sont des phases distinctes. Chaque base SQLite passe un checkpoint
et un contrôle d'intégrité, et toute copie est comparée à un inventaire haché avant de
remplacer une structure vide.

Les routes système séparent l'orchestration HTTP des fonctions bornées de
navigation et de recherche. La recherche donne la priorité au vault actif et
aux dossiers usuels, y compris la racine neutre `Library/CloudStorage` utilisée
par OneDrive, Google Drive, Dropbox, Box et d'autres fournisseurs de fichiers
macOS. Les chemins locaux et Docker sont mappés sans intégrer un fournisseur au
modèle de données.

## Shell du frontend

`app/App.tsx` attend l'initialisation de l'authentification avant de choisir entre partage public, connexion et shell de l'application. Les pages lourdes sont chargées à la demande. Le shell global gère la navigation et les interactions disponibles dans toute l'application ; les pages des routes portent le contenu des domaines. Par conception, `/s/:token` est rendu hors du shell authentifié.

## Invariants

- Le port `5002` est le contrat du backend ; `5173` est celui du frontend.
- Le code applicatif utilise l'arborescence de référence `Gnosi/`.
- Les chaînes visibles du frontend utilisent tous les catalogues linguistiques.
- La génération documentaire ne doit pas importer le runtime.
- Les commandes opérationnelles ponctuelles résident dans `scripts/` ; les paquets de production ne contiennent ni synchroniseurs expérimentaux, ni sondes modifiant les données, ni scripts de réparation propres à une machine.
- Un vault indisponible est représenté explicitement ; un chemin temporaire sûr peut éviter un échec à l'import, mais ne doit pas être présenté comme du contenu configuré.
- Le préchargement des caches dérivés ne doit pas retarder la première réponse utile lorsqu'un instantané fiable existe sur disque.

## Diagnostic des échecs

Vérifiez le propriétaire du processus, `/api/health`, `/api/config` et `/api/vault/pages`, dans cet ordre. Une réponse de santé réussie accompagnée d'une requête de vault vide ou en échec indique un problème de configuration ou de fournisseur de fichiers plutôt qu'un serveur arrêté. Consultez le [guide d'exploitation](../operations/runbook.md).
