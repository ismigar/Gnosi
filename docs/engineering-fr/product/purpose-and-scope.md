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

Gnosi transforme un dossier de fichiers Markdown contrôlé par l'utilisateur en un espace de travail connecté, sans confier ses connaissances à une base hébergée opaque. Il combine la portabilité des fichiers avec des fonctions applicatives de plus haut niveau : vues structurées, édition, recherche, parcours de graphe, références, communication, automatisation, publication et assistance par IA.

L'objectif principal de l'ingénierie est la souveraineté des données avec une collaboration et une automatisation utiles. Les utilisateurs doivent être en mesure d'inspecter, sauvegarder, synchroniser et récupérer leurs connaissances indépendamment de Gnosi.

## Principes de conception

### Persistance privilégiant le stockage local

Markdown et le frontmatter YAML constituent la représentation principale des connaissances. Les index et les caches accélèrent l'accès, mais doivent pouvoir être reconstruits. Les bases relationnelles stockent l'état applicatif qui ne relève pas naturellement d'une note, comme les identités, les appartenances, les index de messages et l'historique d'exécution.

### Mode personnel sans gestion de compte imposée

Le mode par défaut `personal` permet une utilisation locale à un seul utilisateur sans écran de connexion. Le mode `org` active le fonctionnement multiutilisateur authentifié, les espaces de travail, les rôles et les contrôles d'accès. Les déploiements sensibles à la sécurité peuvent imposer l'authentification tout en conservant la sémantique du mode personnel.

### Déploiement portable

Le code principal doit fonctionner nativement et dans Docker. La détection du déploiement peut sélectionner des valeurs par défaut adaptées, mais le code des domaines ne doit présupposer ni noms d'hôte propres à Docker ni chemins absolus propres à une installation native.

### Effets externes explicites

Ouvrir des fichiers, envoyer des messages, publier du contenu, supprimer des données, invoquer des outils générés et appeler des services distants franchissent des frontières de confiance. Ces opérations utilisent des services à périmètre limité et, selon le cas, des contrôles de rôle ou des politiques de confirmation explicites.

### Dégradation contrôlée

Les échecs des fournisseurs et intégrations facultatifs doivent rester isolés. L'absence d'un fournisseur d'IA, d'un service auxiliaire de traduction, d'un compte de courrier ou d'un service d'hydratation de fichiers cloud ne doit pas rendre indisponibles les opérations du vault sans rapport avec eux.

## Fonctions du produit

- Connaissances : pages Markdown, édition par blocs, pièces jointes, vues, recherche, graphe.
- Recherche : références, citations CSL, lecture PDF/EPUB, annotations, flux.
- Communication : courrier, calendriers, réunions, contacts.
- Intelligence : registre de modèles, agents, outils MCP, compétences d'exécution, sources de contexte.
- Automatisation : tâches programmées, formules, rollups, rappels, publication.
- Intégration : Google, Microsoft, Notion, Drupal, réseaux sociaux, compléments bureautiques.
- Distribution : exécution web native, auto-hébergement Docker, application de bureau Electron
  et clients complémentaires pour navigateurs et suites bureautiques.

## Non-objectifs et limites

- Gnosi n'exige pas une base de données cloud propriétaire comme source de vérité.
- Les index dérivés ne remplacent pas durablement le vault.
- La collaboration en temps réel fournit actuellement une base de relais/de présence; elle n'est pas
  décrite comme une édition CRDT complète tant que ce comportement n'est pas implémenté.
- Le code du lecteur Zotero intégré au dépôt n'est pas de la logique applicative propre à Gnosi.
  Gnosi gère sa compilation, la frontière d'intégration, les modifications locales et les flux de données associés.
- Une proposition de fonctionnalité dans une directive ne décrit pas un comportement livré
  tant que celui-ci n'est pas vérifié dans le code et les tests.

## Conséquence de la licence

Gnosi est sous licence AGPL-3.0-or-later. Les versions modifiées proposées sur un réseau doivent rendre leur code source correspondant disponible sous la même licence. Les contributeurs doivent maintenir un code source, une documentation technique et des instructions opérationnelles permettant un examen par des tiers.
