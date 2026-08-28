---
status: implemented
last_verified: 2026-08-28
source_paths:
  - backend/server.py
  - backend/app/lifespan.py
  - backend/config/app_config.py
  - backend/config/env_config.py
  - backend/config/paths_config.py
  - frontend/src/App.jsx
tests:
  - backend/tests/test_app_lifespan.py
  - backend/tests/test_app_config_resolution.py
  - backend/tests/test_app_config_language.py
  - backend/tests/test_host_helper_url.py
  - tests/e2e/tests/anon/smoke.spec.ts
---

# Fondation de la plateforme et durée d'exécution

## Responsabilité

La fondation assemble chaque domaine en un seul processus, résout la configuration et les chemins portables, possède le démarrage et l'arrêt, applique des middlewares partagés et expose le shell frontal de haut niveau. Il doit rester utilisable lorsque les intégrations facultatives sont absentes.

## assemblage de l'arrière-pays

`backend/server.py` construit l'instance FastAPI, middleware, gestion d'exception, montage de lecteur statique, durée de vie, et routeurs. L'ordre du routeur est explicite parce que le contexte de l'espace de travail et les préfixes larges peuvent se chevaucher. [Catalogue API](../generated/api-catalog.md) enregistre chaque montage et itinéraire statique.

Le démarrage Lifespan effectue ces classes de travail:

Le module de cycle de vie conserve `lifespan` comme orchestrateur linéaire. Des
fonctions bornées gèrent les plugins, l'agent, les index, la réparation des
tables, le courrier et l'arrêt sans modifier l'ordre ni l'isolation des erreurs.

1. Assertion qu'un déploiement exposé n'utilise pas un JWT de développement public
secret.
2. Commencez le programmeur et la maintenance de la confirmation-rétention.
3. Reconcile les contributions plugin avant de construire les capacités agent.
4. Connectez les clients MCP, découvrez les outils et compilez le graphique par défaut de l'agent.
5. Précharge persiste des indices de voûte synchrone, puis les rafraîchir dans le
les renseignements sur les conditions dans lesquelles la politique du fournisseur de fichiers le permet.
6. Chargez les caches dérivés avant que tout enregistrement ne puisse les tronquer.
7. Démarrez les travailleurs IMAP IDLE par compte.

Les défaillances de l'IA ou du démarrage optionnel de l'intégration sont enregistrées et isolées. Les défaillances de sécurité et d'initialisation des données de base ne sont pas converties silencieusement en comportement sain.

## Configuration fusion

`load_params()` combine l'application version YAML avec la configuration utilisateur actuel ou active-vault. Les valeurs du dictionnaire se fusionnent récursivement. `.gnosi/params.yaml` devient la cible de persistance pour les réglages à spectromètre de voûte. La résolution du chemin applique ensuite des valeurs explicites d'environnement de déploiement.

Une ancienne accréditation d'environnement peut créer un fournisseur une fois, mais une pierre tombale de déconnexion persistante empêche sa réapparition après suppression délibérée.

## Coquille de la façade

`App.jsx` attend que l'authentification bootstrap soit activée avant de sélectionner le partage public, la connexion ou la coque d'application. Les pages lourdes sont chargées par paresse. La coque globale possède la navigation et les surfaces d'interaction disponibles dans le monde entier; les pages d'itinéraires contiennent leur propre domaine. `/s/:token` rend à l'extérieur de la coque authentifiée par conception.

## Invariants

- Port `5002` est le contrat de service; `5173` C'est le contrat de front-end.
- Le code d'application utilise le code faisant autorité `Gnosi/` arbre.
- Les chaînes visibles Frontend utilisent tous les catalogues locaux.
- Les importations en cours ne doivent pas être utilisées par génération de documentation.
- Une voûte non disponible est représentée explicitement; une trajectoire de sécurité temporaire peut être
éviter les pannes de temps d'importation mais ne doit pas être présenté comme contenu configuré.
- Le réchauffement du cache dérivé ne peut pas retarder la première réponse utile lorsqu'un disque sûr
le snapshot existe.

## Diagnostic d'échec

vérifier la propriété du processus, `/api/health`, `/api/config`, et `/api/vault/pages` dans cet ordre. Une réponse de santé réussie avec une requête de coffre vide ou échoué indique la configuration ou le problème du fournisseur de fichiers plutôt qu'un serveur mort. Voir la [carnet d'opérations](../operations/runbook.md).
