---
status: implemented
last_verified: 2026-10-09
source_paths:
  - frontend/src/features/vault/views/db-view-embed/ViewContainers.tsx
  - frontend/src/shared/record-views/pinnedViewOrder.ts
  - frontend/src/features/vault/view-config/page-view-modal/ViewRegistryOptions.tsx
  - frontend/src/shared/filtering/exposedFilters.ts
  - frontend/src/shared/filtering/useExposedFilters.ts
  - frontend/src/features/vault/views/ExposedFilters.tsx
  - frontend/src/shared/records/hooks/useViewSearch.ts
  - frontend/src/features/vault/views/ViewSearchScope.tsx
  - frontend/src/features/vault/dashboard/useContentCreation.ts
  - frontend/src/features/vault/dashboard/DashboardWelcome.tsx
  - frontend/src/features/vault/dashboard/DashboardSidebar.tsx
  - backend/data/db.py
  - backend/api/vault_routes.py
  - backend/domains/vault/tables/catalogs
  - backend/domains/vault/tables/formula_recalculation.py
  - backend/domains/vault/tables/rules
  - backend/domains/vault/views/filters.py
  - backend/domains/vault/views/row_resolution.py
  - backend/domains/vault/views/snapshot_markup.py
  - backend/domains/vault/views/snapshot_materialization.py
  - backend/domains/vault/views/sorting.py
  - backend/api/vault_views_routes.py
  - backend/api/planning_routes.py
  - backend/api/virtual_fields.py
  - backend/services/table_system_dates.py
  - backend/services/option_catalogs.py
  - backend/services/action_rules.py
  - backend/services/rule_engine.py
  - backend/services/view_snapshot.py
  - backend/services/planning_engine.py
  - backend/services/project_planning.py
  - backend/services/planning_scheduler.py
  - pipeline/scripts/migrate_table_system_dates.py
  - frontend/src/features/vault/views/VaultTable.tsx
  - frontend/src/features/vault/editor/BlockEditor.tsx
  - frontend/src/features/vault/properties/VaultDateProperty.ts
  - frontend/src/shared/record-views/VaultTimeline.tsx
  - frontend/src/shared/record-views/vault-timeline
  - frontend/src/features/vault/VaultDashboard.tsx
  - frontend/src/features/planning
  - frontend/src/shared/dates/projectPlanning.ts
  - frontend/src/shared/filtering/vaultFilters.ts
tests:
  - frontend/src/features/vault/view-config/PageViewModal.pinned-order.test.tsx
  - frontend/src/shared/filtering/exposedFilters.test.ts
  - frontend/src/features/vault/views/db-view-embed/DbViewEmbed.presentation.test.tsx
  - backend/tests/test_exposed_view_configuration.py
  - frontend/src/shared/record-views/VaultTimeline.test.tsx
  - frontend/src/shared/record-views/VaultTimeline.interactions.test.tsx
  - frontend/src/shared/record-views/vault-timeline/useVaultTimelineController.test.tsx
  - frontend/src/shared/record-views/vault-timeline/timelineScale.test.ts
  - frontend/src/features/vault/views/db-view-embed/DbViewEmbed.test.tsx
  - frontend/src/features/vault/dashboard/TablePane.test.tsx
  - frontend/src/features/vault/dashboard/creationFlow.test.tsx
  - frontend/src/features/planning/ProjectPlanningPage.test.tsx
  - frontend/src/features/planning/public-entry.test.ts
  - backend/tests/test_action_rules.py
  - backend/tests/test_database_rules_views_domain_contract.py
  - backend/tests/test_rule_engine_derived_order.py
  - backend/tests/test_rollup_percent_checked_parity.py
  - backend/tests/test_option_catalogs.py
  - backend/tests/test_vault_formula_recalculation_domain_contract.py
  - backend/tests/test_table_system_dates.py
  - backend/tests/test_migrate_table_system_dates.py
  - backend/tests/test_table_view_name_hygiene.py
  - backend/tests/test_view_snapshot.py
  - backend/tests/test_view_filter_rename.py
  - backend/tests/test_snapshot_sort_accent_parity.py
  - backend/tests/test_planning_engine.py
  - backend/tests/test_planning_agent_tools.py
  - backend/tests/test_planning_scheduler.py
  - backend/tests/test_project_planning.py
  - backend/tests/test_virtual_fields_graph_projection.py
  - backend/tests/test_pipeline_naming.py
  - frontend/src/shared/dates/projectPlanning.test.ts
  - tests/e2e/tests/e2e/dashboards.spec.ts
---

# Vues de bases de données et planification de projets

## Modèle de connaissances structurées

Une base de données Gnosi est une couche de schéma et de vues appliquée aux
pages, généralement ancrée dans un dossier du Vault. Le frontmatter des pages
contient les valeurs des enregistrements. Les données du registre définissent
les types de champs, les configurations des vues, les formules, les agrégations
rollup, les relations, les options, les paramètres d'affichage et les actions.

Chaque Vault actif est associé à un moteur SQLite stocké localement et à une
fabrique de sessions typée. Le registre des moteurs est indexé par chemin de
Vault, utilise une base déclarative SQLAlchemy typée, exécute la migration du
schéma avant la première connexion et libère les connexions du pool lors de
la suppression du Vault. Les fichiers SQLite restent hors du stockage du Vault
synchronisé dans le cloud.

La présence d'au moins une vue principale est un invariant. Les mécanismes de
réparation au démarrage et à la lecture la restaurent lorsque des écritures
anciennes ou interrompues laissent une table sans vue valide.

## Création de groupes de bases de données

Le bouton de création d'une base de données de l'accueil et le contrôle
correspondant de la barre latérale partagent une seule action. Tous deux créent
un groupe dans le registre via `/api/vault/databases`, actualisent le registre
et laissent les documents de page intacts. Les espaces superflus du nom sont
supprimés ; annuler ou laisser le nom vide n'écrit rien, et un échec conserve
le dialogue du groupe pour permettre une nouvelle tentative.

Une table est un objet distinct, créé dans un groupe sélectionné avec sa vue
principale. L'API des pages prend toujours en charge les anciennes pages
marquées `is_database: true` ; l'action d'accueil ne les convertit, ne les
supprime et ne les réinterprète pas automatiquement.

## Dates d'audit système

Chaque table possède des propriétés de création et de dernière modification
en lecture seule. Les nouvelles tables traduisent leurs libellés à partir de
la langue de la requête ou de la langue courante de l'interface définie dans
les paramètres, et conservent ces deux propriétés à la fin du schéma. La
création d'un enregistrement horodate les deux valeurs ; les sauvegardes
ultérieures préservent la date de création et actualisent celle de modification.

La migration idempotente ne reconnaît que les types système explicites et les
anciens libellés connus : les champs `date` sans rapport et les métadonnées
internes `created_at` ou `last_edited_at` restent donc intacts. Les clones
Notion déterministes peuvent compléter les horodatages d'audit faisant
autorité en établissant la correspondance entre les UUID de bases de données
et de pages configurés, sans correspondance par titre. L'index Notion complet
est récupéré avant les écritures, et une copie de sauvegarde est créée pour
chaque fichier de registre ou Markdown modifié.

## Normalisation des noms de tables et de vues

Les libellés des tables du registre et des vues enregistrées sont normalisés
aux frontières de chargement et d'écriture. Les emojis décoratifs et les
symboles pictographiques sont supprimés, tandis que les accents et la
ponctuation porteuse de sens sont conservés. La vue principale verrouillée
porte toujours exactement le nom de la table à laquelle elle appartient, et
son marqueur `is_main` fait toujours autorité.

## Hiérarchie de navigation des tables

La barre latérale du Vault présente chaque table comme un nœud parent avec
deux groupes enfants indépendants : `Content` contient les enregistrements de
la table et `Views` contient ses vues enregistrées. Les deux groupes sont
repliés par défaut, tout comme les nœuds des tables et les sections de
navigation de premier niveau, afin qu'une table comportant de nombreux
enregistrements ou vues reste facile à parcourir. Déplier un groupe ne doit
pas déplier implicitement l'autre ; chaque section conserve son propre état
persistant et tous les libellés passent par le catalogue de localisation du
frontend.

## Chaîne de traitement des vues

`VaultTable.tsx` délègue au contrôleur et à la mise en page typés de
`vault-table`. L'adaptateur de table partagé de `VaultViewBody` préserve
l'identité des tableaux de lignes valides, les extensions de métadonnées
inconnues et les fonctions de rappel de sélection. L'édition des cellules, la
navigation au clavier, les lignes virtualisées et les mises à jour des options
du schéma restent dans des modules distincts couverts par des tests de
régression. `SchemaConfigModal.tsx` délègue l'édition du schéma et la sauvegarde
automatique à `schema-config`, en conservant les identifiants des champs, les
couleurs des options et les valeurs par défaut. Ces changements internes ne
modifient ni les vues enregistrées ni les métadonnées portables des pages.

```mermaid
flowchart LR
    Pages["Markdown records"] --> Schema["Typed schema"]
    Schema --> Derived["Formulas and rollups"]
    Derived --> Filter["Typed filters"]
    Filter --> Sort["Stable sort"]
    Sort --> Group["Grouping"]
    Group --> Projection["Visible fields and layout"]
    Projection --> Table["Table / gallery / board / calendar / timeline"]
```

Les valeurs typées doivent être comparées selon le type déclaré de leur champ.
Une simple saisie textuelle ne peut pas représenter toutes les valeurs de
filtre ; les champs de date, de case à cocher, de nombre, de relation, de
sélection et à valeurs multiples sont normalisés par des opérateurs adaptés
à chaque champ.

L'évaluation des champs dérivés suit un ordre explicite. Les formules qui
dépendent de valeurs brutes sont exécutées avant les rollups qui agrègent les
relations, et les formules dépendantes sont résolues sans permettre aux cycles
de produire une récursion infinie. Les représentations du backend et du
frontend doivent s'accorder sur l'interprétation booléenne des cases à cocher,
les pourcentages, les valeurs vides et les identifiants des options.

Les champs virtuels calculés à la lecture utilisent des projections de graphe
et des contextes de calcul typés. Les arêtes structurelles excluent les nœuds
non résolus et les nœuds de propositions sémantiques ; le type des métriques
NetworkX est précisé à leur entrée dans le cache partagé, tandis que les
valeurs de degré, de hub, d'orphelin et de progression inverse des tâches
exposent des résultats primitifs stables. La clé canonique du frontmatter
reste le nom de la propriété du registre, sans conversion en slug.

Le comportement canonique des bases de données est réparti par responsabilité.
`tables/rules/` gère l'évaluation des formules, des rollups, des recherches
lookup et des automatisations ; `tables/catalogs/` gère la normalisation des
options, les rôles sémantiques et le catalogue global des statuts ; les petits
modules de `vault/views/` gèrent la syntaxe des instantanés, leur
matérialisation, les filtres, le tri et les jointures. Les imports historiques
`rule_engine.py`, `option_catalogs.py` et `view_snapshot.py` restent de fines
façades de compatibilité, y compris les points de substitution à liaison
tardive pour les tests des chemins et de l'enrichissement des relations.

La frontière HTTP des tables consomme directement ces contrats stricts de
collections, de cycle de vie, de schémas, d'options, de vues et de chemins
confinés. Elle n'effectue plus de conversions de type sur leurs résultats :
chaque module de domaine reste ainsi seul responsable de son type de retour,
tandis que l'inventaire historique à plat des routes et le document OpenAPI
demeurent inchangés.

Le graphe transitoire de composition des tables injecte désormais des listes
d'options concrètes, des définitions de jointures typées et un composant de
rematérialisation Markdown conforme au protocole. L'adaptateur préserve
l'enrichissement historique à liaison tardive tout en rejetant un résultat
d'instantané non textuel au lieu de le laisser atteindre la persistance.

Les modifications entre enregistrements sont sérialisées par table par
`tables/formula_recalculation.py`. Les requêtes concurrentes sont regroupées
dans une passe en attente ; chaque ligne visible est recalculée, le Markdown
modifié est écrit, et l'index des pages ainsi que le cache des réponses ne sont
actualisés qu'après la réussite des écritures.

Les critères de tri des vues enregistrées sont appliqués dans l'ordre du
tableau avec une comparaison stable à plusieurs clés. Les valeurs de
propriétés vides suivent toujours les valeurs renseignées, dans les deux sens
de tri, croissant et décroissant, conformément à la sémantique des vues Notion
importées. Les vues du frontend et les instantanés Markdown du backend
utilisent la même règle afin que l'ordre de leurs enregistrements ne puisse
pas diverger.

Lorsque `VaultDashboard` affiche un onglet de table, il transmet les
fonctionnalités activées du registre de la table à `VaultTable` via
`VaultViewBody`. L'onglet de table, la table autonome, le volet partagé et la
vue intégrée exposent donc les mêmes actions de lignes configurées. Omettre
cette chaîne de propriétés masque une action même lorsque le registre et
l'API l'indiquent correctement comme activée.

## Portée de la recherche

Les recherches de table portent par défaut sur la vue actuelle. Le sélecteur
peut étendre une requête non vide à toute la table source, y compris les
éléments exclus par les filtres ou les jointures de la vue, sans modifier la
vue enregistrée. Effacer la requête restaure la portée et les filtres de la vue
actuelle. En l'absence de résultats, un message explique la portée active et
propose de rechercher dans toute la table.

Les vues intégrées utilisent le même moteur de recherche partagé pour les
éléments et les décomptes. Elles se rechargent via l'API partagée du vault quand
une autre page est enregistrée ou que la fenêtre retrouve le focus. La recherche
reste affichée pendant l'actualisation, sans réutiliser un cache de table de
cinq minutes.

## Évolution du schéma et concurrence

Les révisions du schéma empêchent un client d'enregistrer une ancienne liste de
champs par-dessus une version plus récente. Le renommage d'un champ met à jour
les filtres, les tris, les formules, les actions et les références des vues
enregistrées. Le renommage d'une table détecte les collisions de noms de
fichiers dans un dossier plat avant de déplacer le contenu.

Les registres sont écrits atomiquement et actualisés après les modifications
de métadonnées en lot. Les instantanés en cache sont invalidés lorsque les
enregistrements sources ou la révision du schéma changent.

Les routes de vues par page valident la racine du registre, la table source,
le champ de filtre et l'identité de la page sur disque avant toute mutation.
Leur cycle de lecture-modification-écriture partage le verrou canonique du
registre et actualise le cache de la façade après une sauvegarde atomique ;
la synchronisation facultative des sections Obsidian reste un adaptateur typé
qui fonctionne au mieux sans garantie de réussite. L'identifiant stable
`view_id` a priorité sur les titres lors d'une insertion ou mise à jour, afin
que des intégrations parallèles ne puissent pas s'écraser mutuellement. Les
résultats de lecture, d'insertion ou mise à jour et de suppression passent par
des modèles Pydantic dédiés avant de renvoyer les mêmes dictionnaires
historiques ; le schéma de requête et le document OpenAPI figé restent
inchangés.

Les modifications de champs en lot, la promotion de Zotero Extra et
l'application de modèles partagent un service typé unique de mutation des
pages. Chaque cible est isolée, vérifie un ETag facultatif, actualise l'index
des pages après écriture et signale les éléments ignorés, les conflits et les
erreurs sans interrompre le traitement des lignes restantes.

Les éditeurs de propriétés de pages utilisent des contrôles adaptés aux
champs. Les champs `select` et `status` sont rendus sous forme de sélecteurs
d'options à valeur unique ; les catalogues de statuts sont stricts et ne
proposent pas la création ni la suppression d'options directement dans le
contrôle. La grille de la table et le panneau des propriétés de page doivent
préserver le même type de champ et la même sémantique des options.

Les valeurs de statut introduites par les règles d'action sont persistées de
manière idempotente par le domaine des tables. Les échecs du registre sont
journalisés, mais ne transforment jamais la règle d'origine en une action
utilisateur échouée.
La frontière pure des règles résout les champs par identifiant, nom actuel ou
alias, évalue les prérequis déclarés sans interpréter l'absence de données
comme un refus, préserve la clé du frontmatter déjà utilisée et initialise
les options de statut manquantes de manière déterministe. Les règles de
boutons restent distinctes des automatisations déclenchées par des changements.

La frontière HTTP de Planning est strictement typée tout en préservant son
contrat OpenAPI figé. La résolution du Vault actif échoue explicitement
lorsqu'aucun Vault n'est sélectionné, et la matérialisation des récurrences
consomme de manière bornée les itérateurs d'occurrences RRULE tout en
préservant les identifiants stables des tâches et les vérifications ETag.

## Planification de projets

Le frontend strictement typé `features/planning/` gère la page de planification
et ses tests de comportement derrière un point d'entrée public à chargement
différé. Le composant de rendu de la chronologie reste partagé avec les vues
du Vault. La responsabilité des routes ne modifie ni les requêtes de
planification, ni la création de références initiales, ni les journaux de
travail, ni l'approbation explicite des propositions de nivellement.

La planification consomme les champs structurés des tâches et produit un
échéancier faisant autorité, plutôt que de dupliquer la logique de
planification dans l'interface. Le moteur normalise les dépendances, les
calendriers, les durées, les contraintes, les ressources, les échéances,
l'avancement et le sens de planification. Il calcule ensuite les dates, les
marges, les tâches critiques, les avertissements et les affectations de
ressources.

Le moteur déterministe sépare désormais la normalisation des faits, la
planification en avant d'une tâche, les diagnostics de contraintes,
l'indexation des successeurs, la passe en arrière des marges, le placement
ALAP et la sérialisation du payload. Cela maintient les faits persistés
immuables tout en préservant les échéanciers partiels et les diagnostics en
cas d'erreurs récupérables du graphe.

L'ordonnanceur qui regroupe les demandes maintient l'analyse Markdown, la
sauvegarde et les vérifications ETag derrière un port Vault restreint à liaison
tardive, avec des enregistrements sources typés pour chaque écriture candidate.
Il valide la structure de l'état des plugins avant de lire les paramètres et
n'écrit que les bornes automatiques dont l'ETag source n'a pas changé. Les
types de l'historique des tarifs des ressources et des dérogations
d'affectation sont précisés à la frontière du stockage de planification :
les calculs d'affectation et de nivellement restent ainsi strictement typés,
sans modifier les nombres persistés ni la sémantique de l'échéancier.

Les durées des périodes conservent à la fois leur valeur numérique et l'unité
configurée (`hours`, `days` ou `years`). Les années civiles sont ajoutées sous
forme de décalages en années civiles : une année de début augmentée de huit
ans aboutit ainsi à l'année de fin correspondante, y compris pour les années
négatives. L'éditeur de propriétés supprime les champs redondants de dates
réelles, recalcule la fin chaque fois que le début, la durée ou le prédécesseur
change et utilise un sélecteur multiple avec recherche pour les prédécesseurs.
Les anciennes valeurs `durationDays` restent disponibles pour assurer la
compatibilité avec les anciens enregistrements et instantanés d'échéanciers.

Le frontend affiche le résultat et les contrôles d'édition. Il ne recalcule
pas indépendamment la sémantique du chemin critique. Les échéanciers en cache
sont indexés par l'état pertinent des entrées et résident dans les données
locales, pas dans les enregistrements sources du Vault.

## Comportement en cas d'échec

- Les formules non valides renvoient une erreur de champ contrôlée au lieu
  d'interrompre la réponse de la table.
- Les relations rompues restent visibles sous forme de valeurs non résolues
  lorsque c'est possible.
- Les vues manquantes déclenchent une réparation déterministe de la vue
  principale.
- Les cycles de planification, les contraintes impossibles ou les calendriers
  manquants produisent des diagnostics et des résultats partiels lorsque cela
  ne présente pas de risque.
- Une révision du schéma obsolète renvoie un conflit et nécessite un
  rechargement ou une fusion.

## Points de vérification

Testez la parité des filtres typés, les conflits de révisions du schéma, le
renommage des champs et des tables, l'ordre d'évaluation des formules et des
rollups, la synchronisation des relations, le tri des instantanés, les actions
des catalogues d'options, les contraintes de planification, les chemins
critiques et le rendu E2E des tableaux de bord.

## Génogrammes

Le [plugin Génogrammes](genograms.md), facultatif par Vault, ajoute des tables familiales liées, des vues SVG et des exports locaux SVG/PNG/PDF, sans service externe ni IA.

## Lecture en galerie et paramètres des vues

Les paramètres des vues intégrées partent de la configuration effective déjà affichée et conservent filtres, tri et apparence pendant le chargement du catalogue. Les recherches échouées permettent de réessayer et ne peuvent pas enregistrer des valeurs par défaut. Les cartes de galerie acceptent la pleine largeur et une hauteur adaptée au contenu, avec un seul défilement de page. Espace entre dans le groupe développé ; Gauche revient à son en-tête et le replie, tandis qu’Échap quitte la navigation des enregistrements. Les vérifications d’utilisation des vues passent par `asyncio.to_thread`, conservent le contexte du vault et maintiennent les lectures de fichiers cloud hors de la boucle HTTP. Les régressions couvrent le chargement du dialogue, les réponses tardives du catalogue, le focus clavier et le fil de vérification d’utilisation.

Tous les types de vue intégrée proposent un réglage de hauteur enregistré dans Général : limitée (jusqu’à 70 % de la fenêtre, puis défilement interne) ou selon le contenu (la page défile). Le réglage suit l’onglet actif et fonctionne avec les vues partagées du registre et les sections locales. Les vues existantes conservent leur comportement ; les flux grandissent avec le contenu et les autres types ont une hauteur limitée par défaut. Les cartes de galerie pleine largeur n’ont pas de hauteur minimale, ce qui garde les notes courtes compactes. Le tableau conserve la gestion du défilement horizontal et des colonnes fixes des tableaux et listes. La limite de hauteur est réglable de 1 à 100 % de la fenêtre (70 % par défaut) et est conservée lors des changements de mode. `heightPercent` est validé au chargement et à l’enregistrement, puis appliqué par rapport à la hauteur de la fenêtre.

Les propriétés des pages utilisent le type de champ enregistré pour les contrôles et les icônes. Les cases à cocher conservent les deux états booléens et le zéro numérique reste visible. Les modifications enregistrent les nombres et booléens sans les convertir en texte. À la lecture, les identifiants stables des champs ont priorité sur les anciens noms et sont enregistrés sous le nom actuel. Les résultats des formules et agrégations utilisent les évaluateurs partagés ; les champs dérivés et les valeurs d’audit restent en lecture seule. Le verrouillage de la page ou le rôle de lecteur désactive aussi les dates vides, les périodes et les sélecteurs. Le texte enrichi conserve les sauts de ligne et les propriétés Zotero proposent la même action d’ouverture que les cellules du tableau.

La page conserve l’ordre des champs enregistré dans la configuration de la table, y compris pour la navigation au clavier et les aperçus compacts. Le champ de titre n’est pas dupliqué comme propriété locale. Gérer les champs affiche séparément les propriétés propres à la page, avec leurs valeurs, et permet de les supprimer de cette page sans modifier le schéma de la table. Les suppressions locales sont enregistrées immédiatement, restaurent leur valeur en cas d’échec et préservent les modifications de propriétés en attente.

La fenêtre de configuration affiche toujours la table source. Une nouvelle vue ouverte sans table active permet d’en sélectionner une et active les champs, filtres, tris et regroupements correspondants. Les vues ayant déjà une table configurée conservent cette source.

L’action Ajouter une vue d’une vue intégrée permet de créer une nouvelle vue ou d’ajouter une vue existante de la même table. Les vues existantes sont ajoutées comme onglets sans duplication ni modification de leur configuration ; les onglets déjà visibles sont exclus du sélecteur. L’onglet sélectionné et les vues ajoutées sont conservés à la réouverture de la page. Les nouvelles vues héritent de la table source de la vue intégrée.

Les sélecteurs de regroupement incluent tous les types de champs enregistrés ou découverts. Galerie, tableau/liste et Kanban conservent zéro et faux, séparent et dédupliquent les valeurs multiples, résolvent les identifiants stables et les titres et séparent les valeurs vides. Les relations affichent les noms sans fusionner les identifiants distincts ; les valeurs structurées utilisent des clés canoniques et des libellés lisibles. Les formules et agrégations utilisent les évaluateurs partagés, et les cases ont des libellés traduits. Le glissement Kanban est limité aux champs textuels modifiables pour préserver les nombres, dates et résultats calculés. Les infobulles des onglets sont masquées tant que le menu est ouvert.

Les champs numériques partagent l’affichage de la progression dans les pages, tableaux, galeries, Kanban et flux. La configuration du champ propose un nombre, une barre ou un anneau de progression. Les pourcentages et les pourcentages de cases cochées affichent une barre par défaut ; le zéro reste visible et les valeurs vides restent vides. Le dessin est limité à 0–100 sans modifier la valeur enregistrée et accepte les pourcentages calculés avec leur symbole. Le maximum configurable accepte les valeurs fractionnaires (0,5 sur 1 représente 50 %) et les valeurs exprimées sur 100.

### Catalogues de statuts propres à chaque table

Les champs de statut conservent leurs options sauf si `config.catalog_ref` les
relie explicitement à un catalogue partagé. Les liens existants vers le
catalogue global `status` restent valides. Sélectionner le catalogue propre au
champ dans l'éditeur de schéma copie les options partagées sans modifier les
autres tables. L'éditeur enregistre ce changement avant de renommer ou supprimer
des valeurs. La maintenance des catalogues, les éditeurs de fiches et la
persistance des règles respectent la référence explicite ; les options locales
ne sont jamais fusionnées automatiquement dans le catalogue global.
Tests : `backend/tests/test_status_catalog_isolation.py` et
`frontend/src/features/vault/schema/schema-config/SchemaConfigOptions.test.tsx`.

La sauvegarde du schéma conserve les options, références, valeurs par défaut, groupes et liens des connecteurs dans le `config` canonique du champ. Un catalogue local de statuts vide est enregistré comme `options: []` ; les statuts de base initialisent uniquement les catalogues absents et ne sont pas restaurés après leur suppression. Les statuts requis par les fonctions de traduction ou de publication activées conservent leur initialisation existante.

## Chronologie interactive des enregistrements

La chronologie des enregistrements utilise des limites de calendrier localisées, une colonne de titres fixe et redimensionnable, des phases repliables et une vue du projet adaptée à la fenêtre. Glissez une barre pour déplacer la tâche, une extrémité pour ajuster ses dates ou le point de connexion final sur une tâche suivante pour créer une dépendance de fin à début. Le contrôleur enregistre la période ou les champs de début et de fin avec le même callback de métadonnées que le tableau, conserve la progression et les dépendances de la période et reconnaît les colonnes de relation des prédécesseurs. La planification inclut les enregistrements masqués par les filtres, refuse les cycles et propage les branches convergentes selon le prédécesseur qui termine le plus tard. Chaque enregistrement sauvegarde ensemble la dépendance et les dates calculées ; les opérations échouées restaurent les écritures terminées lorsque possible et signalent les restaurations incomplètes. Annuler restaure les champs modifiés pendant la session de la vue. Les chronologies intégrées conservent leurs contrôles de zoom et de navigation et gèrent leur limite de défilement. Les flèches déplacent la barre focalisée, Maj+flèche ajuste sa fin et Échap annule le glissement.

Le pied de la chronologie est séparé du défilement vertical des lignes et reste visible lorsque la page qui le contient défile. La barre horizontale persistante se synchronise avec la chronologie dans les deux sens, y compris avec les contrôles de navigation et le déplacement des tâches.

Le sélecteur propose jour, semaine, mois et année ; la vue annuelle aligne des années complètes avec des colonnes mensuelles. Les tâches parentes peuvent réduire et restaurer toutes les sous-tâches imbriquées.

Cliquez sur une ligne de dépendance, ou donnez-lui le focus et appuyez sur Entrée/Suppr, pour ouvrir le dialogue de suppression partagé. La confirmation supprime uniquement ce prédécesseur de la période ou de la relation, conserve les dates et les détails des autres liaisons, actualise le tableau et permet d’annuler. Les chronologies en lecture seule ne proposent pas cette action.

## Titres affichés et filtres exposés

Les vues enregistrées ont un `displayTitle` facultatif indépendant du `name`
du catalogue. Les sélecteurs d’insertion conservent le nom long ; les titres
et onglets des vues intégrées utilisent le titre court lorsqu’il est défini,
avec les titres et noms existants comme solution de repli. Le champ s’applique
à tous les types de vue et est conservé dans le registre, les sections locales,
les copies et l’enregistrement automatique du dialogue.

L’action Renommer, y compris le double clic sur un onglet intégré, modifie
uniquement `displayTitle` et reprend le titre affiché actuel. Le nom du catalogue
se modifie dans Configurer. La vue principale permet ce changement de présentation
tout en conservant son verrou de suppression.

Chaque règle peut activer `exposed: true`. Son contrôle de valeur, adapté au type
de champ, et un interrupteur apparaissent au-dessus des vues intégrées et des
tables. Les modifications appartiennent à l’instance montée et à la configuration
de la page ou de l’onglet actif, jamais au registre enregistré. Réinitialiser
rétablit les valeurs enregistrées. Les groupes AND/OR et les règles fixes sont
préservés ; les groupes désactivés sont supprimés sans transformer les branches OR
en correspondances. La recherche dans toute la table désactive temporairement
les contrôles. Le compteur utilise les mêmes filtres temporaires que les résultats.
L’enregistrement des modifications de disposition conserve les filtres d’origine.
Zéro, faux et les limites de période sont conservés lors de la sérialisation.

La couverture de régression comprend `exposedFilters.test.ts`, `PageViewModal.test.tsx`,
`DbViewEmbed.test.tsx`, `TablePane.test.tsx` et
`backend/tests/test_exposed_view_configuration.py`.

L’onglet Général du dialogue des vues intégrées propose des commandes pour monter et descendre les onglets épinglés, y compris la vue d’ancrage. L’ancre reste visible et ne peut pas être désépinglée. Le dialogue affiche les vues épinglées dans l’ordre enregistré avant les vues disponibles, et le bloc affiche les onglets dans ce même ordre. Les préférences du bloc sont enregistrées par page et vue d’ancrage dans le stockage local du navigateur ; les onglets du registre fournissent les valeurs par défaut uniquement en l’absence de préférences du bloc. La réouverture ou le rechargement conserve l’ordre choisi et les retraits explicites.

Les tableaux Kanban intégrés gèrent leur limite de hauteur et le défilement sur les deux axes. La barre horizontale reste dans la zone limitée pour rendre toutes les colonnes accessibles ; les tableaux dont la hauteur suit le contenu grandissent sans limite verticale.

## Navigation au clavier et cellules de feuille de calcul

Focalisez une vue et appuyez sur Entrée pour parcourir ses enregistrements ; Échap revient au cadre de la vue. Les flèches passent entre les enregistrements. Les vues sur canevas affichent l’enregistrement courant dans une barre de navigation au clavier. Les éditeurs et dialogues conservent leur gestion du clavier.

Les tableaux et listes affichent des lignes numérotées et des colonnes avec lettre et nom. Les flèches passent entre les cellules ; Maj+flèche sélectionne une plage. Entrée ou F2 modifie une cellule, et Échap annule la modification avant de quitter la grille. Copier et coller transfère des plages rectangulaires ; une cellule copiée peut remplir les lignes sélectionnées, même non adjacentes. Ctrl/Cmd+D ou le bouton de remplissage copie la première ligne sélectionnée vers le bas, conserve les références relatives des formules et signale les erreurs d’enregistrement.

Les cellules de texte et de nombre acceptent les formules commençant par `=`, comme `=SUM(B1:B3)` ou `=[Amount]*2`. La barre de formules affiche l’expression enregistrée et la cellule affiche son résultat. Les références suivent l’ordre des lignes et colonnes de la vue actuelle ; les références nommées désignent des champs du même enregistrement. Les références absolues comme `$B$1` restent fixes lors de la copie. Arithmétique, comparaisons, concaténation et fonctions élémentaires d’agrégation, d’arrondi et de condition sont prises en charge, avec des alias traduits. L’évaluation est bornée, détecte les cycles et n’exécute aucun code dynamique. Ce sous-ensemble de formules est propre à la vue, sans compatibilité complète avec les classeurs Excel ; les formules du schéma restent calculées indépendamment et en lecture seule.

Sélectionnez une plage en glissant ou avec Maj+clic ; Ctrl/Cmd+clic ajoute ou retire des cellules individuelles. Coller une valeur unique remplit toutes les cellules sélectionnées modifiables, même non adjacentes, sans changer les cellules intermédiaires. Les événements natifs de collage fonctionnent également, et les titres suivent le contrat de mise à jour du titre. Les changements sont regroupés en une requête par enregistrement ; un échec restaure les valeurs précédemment affichées.

Les tableaux intégrés définissent une grille non modifiable dans l’éditeur de texte enrichi. La sélection à la souris ignore les ancêtres modifiables hors de la grille, y transfère le focus et permet d’étendre ou de réduire la plage avec Maj+flèches avant de coller ; les éditeurs de cellule conservent la sélection de texte.
