---
status: implemented
last_verified: 2026-08-02
source_paths:
  - ARCHITECTURE.md
  - CONTRIBUTING.md
tests: []
---

# Objet et portée

## Objectif du produit

Gnosi transforme un dossier contrôlé par l'utilisateur de Markdown en un espace de travail connecté sans faire d'une base de données hébergée opaque le propriétaire des connaissances de l'utilisateur. Il combine la portabilité des fichiers avec le comportement d'application de niveau supérieur : vues structurées, édition, recherche, traversée graphique, références, communication, automatisation, publication et assistance d'IA.

L'objectif principal de l'ingénierie est la souveraineté des données avec une collaboration et une automatisation utiles. Les utilisateurs doivent être en mesure d'inspecter, sauvegarder, synchroniser et récupérer leurs connaissances indépendamment de Gnosi.

## Principes de conception

### Persistance au premier rang local

Les indices et caches accélèrent l'accès mais doivent être reconstituables. L'état d'application de l'application de la base de données relationnelles n'appartient pas naturellement à une note, comme les identités, les membres, les index de messages et l'historique d'exécution.

### Mode personnel sans frais généraux de compte

La valeur par défaut `personal` mode peut fonctionner comme une application locale à un seul utilisateur sans écran de connexion. `org` le mode permet d'authentifier le comportement multi-utilisateurs, les espaces de travail, les rôles et les contrôles d'accès. Les déploiements sensibles à la sécurité peuvent forcer l'authentification même en conservant la sémantique en mode personnel.

### Déploiement portable

Le code de base doit fonctionner nativement et dans Docker. La détection du déploiement peut sélectionner les défauts appropriés, mais le code de domaine ne doit pas supposer les noms d'hôte Docker uniquement ou les chemins absolus natifs uniquement.

### Effets externes explicites

Ouvrir des fichiers, envoyer des messages, publier du contenu, supprimer des données, invoquer des outils générés et appeler des services à distance qui dépassent les frontières de la confiance. Ces opérations utilisent des services mis en œuvre et, le cas échéant, des contrôles de rôle ou des politiques de confirmation explicites.

### Dégradation gracieuse

Les fournisseurs optionnels et les intégrations doivent échouer localement. Un fournisseur d'IA manquant, un service de sidecar de traduction, un compte de courrier ou un service d'hydratation de fichiers cloud ne doivent pas rendre les opérations de coffre-fort non liées indisponibles.

## Surfaces de produits

- Connaissances : Pages de marquage, édition de blocs, pièces jointes, vues, recherche, graphique.
- Recherche : références, citations de la LSC, lecture PDF/EPUB, annotations, flux.
- Communication : courrier, calendriers, réunions, contacts.
- Intelligence : registre modèle, agents, outils MCP, compétences en temps de fonctionnement, sources de contexte.
- Automatisation : tâches programmées, formules, rollups, rappels, publication.
- Intégration: Google, Microsoft, Notion, Drupal, réseaux sociaux, add-ins de bureau.
- Distribution: Native web runtime, Docker auto-hosting, Electron application de bureau,
et les clients de votre navigateur/de votre bureau.

## Non-objectifs et limites

- Gnosi n'exige pas une base de données cloud propriétaire comme source de vérité.
- Les indices dérivés ne sont pas des substituts durables pour la voûte.
- La collaboration en temps réel fournit actuellement une base de relais/de présence; elle est
non documenté comme édition complète de CRDT jusqu'à ce que ce comportement soit implémenté.
- Le code de lecteur Zotero vendu n'est pas la propriété de la logique d'application Gnosi.
la construction, la limite d'intégration, les changements locaux et les flux de données autour de celui-ci.
- Une proposition de fonctionnalité dans une directive n'est pas expédié comportement avant que vérifié dans
Source et tests.

## Conséquence de la délivrance des licences

Gnosi est AGPL-3.0-ou-plus tard. Les versions modifiées offertes sur un réseau doivent rendre leur source correspondante disponible sous la même licence. Les intervenants doivent conserver la source, la documentation technique et les instructions opérationnelles appropriées pour l'examen par des tiers.
