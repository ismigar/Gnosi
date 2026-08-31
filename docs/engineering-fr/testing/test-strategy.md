---
status: implemented
last_verified: 2026-08-31
source_paths:
  - package.json
  - .github/workflows/ci.yml
  - .github/workflows/build-release.yml
  - desktop/update-policy.js
  - backend/tests
  - frontend/src
  - frontend/tests/contracts
  - frontend/feature-public-entries.json
  - frontend/package.json
  - frontend/scripts/check-bundle-size.ts
  - tests/e2e
  - pyproject.toml
tests:
  - backend/tests/test_root_typecheck_contract.py
  - frontend/tests/bundle-size.test.ts
  - tests/e2e/tests/accessibility/accessibility.spec.ts
---

# Stratégie d'essai

## Calques de qualité

```mermaid
flowchart TB
    Static["Contrôles statiques\nSyntaxe de Python, ESLint, i18n"] --> Unit["Tests unitaires\normalisateurs, politiques, algorithmes"]
    Unit --> Integration["Tests d'intégration, stockage, adaptateurs"]
    Integration --> E2E["Playwright\nreal navigateur et services en cours d'exécution"]
    E2E --> Visual["Inspection visuelle et instantanés de régression"]
    Integration --> Deploy["Essais de fumigation de la bidon et de l ' emballage"]
```

Une version de la construction de frontend capte les importations et la syntaxe mais pas une interaction rompue. Un test d'unité de route ne prouve pas l'intégration du navigateur. Une capture d'écran ne prouve pas la persistance ou l'autorisation.

## Vérification unifiée des types

Exécuter `pnpm typecheck` à la racine du dépôt. La commande vérifie, dans cet
ordre, TypeScript du frontend, mypy strict sur tout le backend (hors tests),
mypy strict sur tous les fichiers Python publics indexés du pipeline, puis
la syntaxe Python de backend, pipeline, scripts et extensions. Chaque échec
interrompt les étapes suivantes et conserve son code de sortie.

Les commandes individuelles `typecheck:backend-boundaries` et
`typecheck:pipeline` restent disponibles. Cette vérification statique ne remplace
ni lint, ni tests unitaires, ni builds, ni parcours navigateur, ni validation
du déploiement. Sa réussite ne prouve pas la suppression de toutes les
frontières avec `Any` explicite. La régression vérifie les périmètres complets
et utilise des exécutables simulés isolés sous POSIX pour contrôler l'ordre
et la propagation des erreurs ; elle ne prouve pas l'exécution sous Windows.

## Essais de l'arrière-pays

Pytest couvre les services, les dépendances d'itinéraire, la normalisation, le stockage, la sécurité, la concurrence et les cas de régression. Les tests utilisent des coffres-forts temporaires et des répertoires de données locales. Les fournisseurs externes sont taboussés à moins qu'un test ne soit explicitement marqué comme live/E2E.

Les suites importantes comprennent:

- Auth, PAT, bootstrap, rôles et surfaces publiques.
- Contenance de chemin, écrits sûrs, ETags, races, registre et comportement sidecar.
- Formules, rollups, filtres dactylographiés, relations, planification et calendrier.
- Mail MIME/CID, contacts fusion/vCard, confinement de calendrier et rappels.
- AI routage, compétences, résilience MCP, confirmations et outils générés.
- Plugins, importations, citations, normalisation du lecteur, XSS et SSRF.

## Essais frontaliers

Vitest couvre les composants, les crochets, les registres, les utilitaires de formatage, la logique de visualisation dactylographiée et le comportement d'état. `check:i18n` vérifie que les clés référencées orientées vers l'utilisateur existent dans chaque localité.

La compilation doit se terminer par zéro erreur. Les avertissements existants ne sont pas la permission d'ajouter de nouveaux avertissements sans examen.

Les frontières de propriété sont vérifiées par `gnosi/feature-boundaries`
dans ESLint. L'extension révisée prévoit un manifeste d'entrées publiques exactes
dans `frontend/feature-public-entries.json`, avec une justification par chemin.
Les consommateurs externes à une feature utilisent sa racine/`index` ou une
entrée explicitement révisée ; les fichiers voisins non répertoriés restent
privés. Vérifier imports statiques, réexports, imports différés littéraux et
imports de types TypeScript. Le manifeste ne doit pas créer d'agrégateur chargé
au démarrage ni modifier les frontières de chargement différé.

Les règles `shared` → aucune feature/`app` et features → aucun `app` sont
inconditionnelles, y compris pour les types et les entrées du manifeste.
Les modules internes d'une feature peuvent utiliser des imports locaux.
Les contrats globaux du code résident dans `frontend/tests/contracts/` ;
le guardrail complète le lint AST. Vérifier l'implémentation après le déplacement ;
cette documentation ne prouve pas la réussite de la vérification globale.

## Limites de taille de production

Le build frontend exécute `scripts/check-bundle-size.ts` après Vite. Les limites
fixes en octets JavaScript non compressés sont : fichier d'entrée 1 400 000 ;
plus gros fragment 1 800 000 ; editor vendor 1 550 000 ; tldraw vendor
1 350 000 ; route des paramètres 600 000. L'absence ou la duplication d'un
fragment contrôlé fait échouer la vérification. Les tests couvrent les URL
relatives, à la racine et préfixées, la croissance et les fragments absents.
La taille du fichier d'entrée ne mesure ni le graphe initial complet des
dépendances, ni le transfert compressé, ni le temps de démarrage. L'avertissement
existant de Vite à 1 500 kB reste visible ; ces limites empêchent la croissance
sans prouver que les performances sont optimales.

## Essais visuels de bout en bout

Playwright fonctionne comme un projet de niveau hôte contre l'application native. Une configuration anonyme couvre le démarrage et le comportement public; la configuration authentifiée couvre la fonctionnalité de l'espace de travail. Exercice de tests de domaine Vault, tableau de bord, courrier, calendrier, contacts, dessins, automatisation, chat agent et navigation.

Les instantanés visuels couvrent les pages représentatives des bureaux et des mobiles. Pour un changement d'interface, inspectez la page rendue, cliquez sur le contrôle modifié, regardez la console et prenez une capture d'écran. Confirmez que les modaux, les superpositions, les toasts et les menus utilisent le système d'index z enregistré et ne captent pas l'interaction.

## Porte d’accessibilité

Le projet Playwright `accessibility` est une porte bloquante WCAG 2.2 AA. Il
exécute axe sur un itinéraire représentatif de chaque domaine principal dans
les thèmes clair et sombre, y compris le contraste des couleurs, les étiquettes,
les régions et les relations ARIA. Le balisage propre à l’application reste
toujours dans l’audit. Les données de test déterministes activent les modules
optionnels de la matrice d’itinéraires, et chaque itinéraire échoue également
en cas d’erreur de page non gérée dans le navigateur ; une surface défaillante
ne peut pas réussir axe.

Les tests d’interaction complètent axe avec la navigation d’évitement, le focus
visible et ordonné, le clavier complet, le focus roving des onglets mobiles,
Échap dans les dialogues annulables, le focus trap et le retour du focus, les
noms accessibles et les annonces de changement d’itinéraire.

Le style global du focus utilise l’attribut `data-focus-modality` à la racine
du document. L’activation au pointeur supprime les contours génériques ; au
clavier, des indicateurs contextuels sont appliqués : bordure existante pour
les champs, soulignement pour les liens et contour pour les contrôles sans
bordure. Les titres modifiables du Vault conservent uniquement leur curseur de
saisie. Les tests unitaires couvrent les transitions de modalité et les tests
du navigateur, le focus au pointeur et au clavier dans les thèmes clair et
sombre.

## Essais de déploiement

Actuellement, la CI Docker valide Compose et construit les images backend et
frontend ; elle ne démarre pas les conteneurs et ne vérifie ni leur état ni
leur persistance. Ces tests d'exécution restent nécessaires avant une release.

La CI Electron configure les paquets pour macOS arm64/x64, Linux arm64 et
Windows x64. Configurer cette matrice, réussir les tests unitaires desktop
ou vérifier une migration synthétique du profil du navigateur ne valide
ni les installateurs ni le backend figé. Chaque architecture exige des preuves
d'installation, de démarrage, de persistance et de mise à jour depuis 2.x.
Actuellement, macOS utilise des mises à jour manuelles par installateur.
Une exécution locale sous macOS ne valide pas les autres plateformes :
ne pas publier 3.0 avant la réussite de toute la matrice de release.

## Cartographie de la variation aux essais

| Changement | Preuve minimale |
| --- | --- |
| Documents purement réexaminés | Contrôle du générateur, validateur, stricte construction de documents, navigateur de documents de fumée. |
| Logique générée du catalogue | Essais d'unités de générateur, déterminisme à deux commandes, validateur, construction de documents stricts. |
| Comportement du moteur | Régression des pytests étroits plus suite d'intégration affectée. |
| Comportement de la frontée | Vitest lorsque possible, i18n vérifier, construction de production, action du navigateur et capture d'écran. |
| Accessibilité ou jeton d’interface partagé | Vitest de la primitive, parité des quatre langues, matrice axe en clair et sombre, tests clavier et capture du navigateur. |
| Comportement de l'autorité/de la sécurité/de la voie | Tests négatifs et tentatives croisées, pas seulement le chemin doré. |
| Déploiement/dépendance | Vérification autochtone plus Docker ou colis IC, selon le cas. |

## Catalogue d'essai

Les [catalogue d'essai](../generated/tests.md) La collection Runner reste autorisée pour les comptes de tests exécutables.
