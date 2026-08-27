---
status: implemented
last_verified: 2026-08-28
source_paths:
  - backend/api/vault_routes.py
  - backend/domains/vault/tables/formula_recalculation.py
  - backend/api/vault_views_routes.py
  - backend/api/planning_routes.py
  - backend/services/table_system_dates.py
  - backend/services/view_snapshot.py
  - backend/services/planning_engine.py
  - backend/services/planning_scheduler.py
  - pipeline/scripts/migrate_table_system_dates.py
  - frontend/src/components/Vault/VaultTable.jsx
  - frontend/src/components/Vault/BlockEditor.jsx
  - frontend/src/components/Vault/VaultDateProperty.jsx
  - frontend/src/components/Vault/VaultTimeline.jsx
  - frontend/src/pages/VaultDashboard.jsx
  - frontend/src/pages/ProjectPlanningPage.jsx
  - frontend/src/utils/projectPlanning.js
  - frontend/src/utils/vaultFilters.js
tests:
  - backend/tests/test_vault_formula_recalculation_domain_contract.py
  - backend/tests/test_table_system_dates.py
  - backend/tests/test_migrate_table_system_dates.py
  - backend/tests/test_table_view_name_hygiene.py
  - backend/tests/test_view_snapshot.py
  - backend/tests/test_snapshot_sort_accent_parity.py
  - backend/tests/test_planning_engine.py
  - backend/tests/test_project_planning.py
  - frontend/src/utils/projectPlanning.test.js
  - tests/e2e/tests/e2e/dashboards.spec.ts
---

# Vues de la base de données et planification des projets

## Modèle de connaissances structurées

Une base de données Gnosi est un schéma et un calque de vue sur les pages, normalement enracinés dans un dossier Vault. La matière de page contient des valeurs d'enregistrement. Les données du registre définissent les types de champs, les configurations de vue, les formules, les rollups, les relations, les options, les paramètres d'affichage et les actions.

Au moins une vue principale est invariante. Les chemins de réparation de démarrage et de lecture le restaurent lorsque l'héritage ou les écrits interrompus quittent une table sans une vue valide.

## Dates de vérification du système

Chaque table possède des propriétés de création en lecture seule et de dernière modification. Les nouvelles tables localisent leurs étiquettes à partir du langage de requête ou de l'interface actuelle dans Paramètres, et conservent les deux propriétés à la fin du schéma. Enregistrer la création marque les deux valeurs; plus tard, enregistre la création préservée et la modification de mise à jour.

La migration idempotent ne reconnaît que les types de systèmes explicites et les étiquettes connues, si non liées `date` et des domaines `created_at` ou `last_edited_at` Les clones de notions déterministes peuvent remplir les typographies de vérification autorisées en mapping de la base de données configurée et des pages UUID, sans correspondance avec le titre. L'index de notions complet est récupéré avant les écrits, et chaque fichier de registre ou de Markdown modifié est sauvegardé.

## Hygiène du nom de la table et de la vue

Les étiquettes de table de registre et de vue enregistrée sont normalisées aux limites de charge et d'écriture. Les symboles décoratifs des emojis et pictographiques sont enlevés tandis que les accents et la ponctuation significative sont conservés. `is_main` le marqueur reste une autorité.

## Hiérarchie de la navigation de tableau

La barre latérale de la valle présente chaque table comme un noeud parent avec deux groupes d'enfants indépendants : `Content` contient les registres du tableau et `Views` contient ses vues sauvegardées. Les deux groupes sont effondrés par défaut, tout comme les nœuds de table et les sections de navigation de haut niveau, de sorte qu'une table avec de nombreux enregistrements ou vues reste scannable. L'élargissement d'un groupe ne doit pas implicitement étendre l'autre; chaque section garde son propre état persistant et toutes les étiquettes passent par le catalogue de localisation frontale.

## Afficher le pipeline

```mermaid
flowchart LR
    Pages["Enregistrements de correction"] --> Schema["Schéma dactylographié"]
    Schema --> Derived["Formules et rouleaux"]
    Derived --> Filter["Filtres dactylographiés"]
    Filter --> Sort["Sortie stable"]
    Sort --> Group["Groupement"]
    Group --> Projection["Champs visibles et mise en page"]
    Projection --> Table["Tableau / galerie / planche / calendrier / chronologie"]
```

Les valeurs dactylographiées doivent être comparées comme leur type de champ déclaré. L'entrée de texte ne peut pas représenter chaque valeur de filtre; la date, la case à cocher, le nombre, la relation, les champs de sélection et de valeurs multiples se normalisent par l'intermédiaire des opérateurs conscients de champ.

L'évaluation de champ dérivé a un ordre explicite. Les formules qui dépendent des valeurs brutes exécutées avant les groupures que les relations agrégées, et les formules dépendantes sont résolues sans permettre aux cycles de se récidiver indéfiniment. Les représentations de l'arrière-plan et de la front-end doivent convenir de la vérité de la case à cocher, des pourcentages, des valeurs vides et des identifiants d'option.

`tables/formula_recalculation.py` sérialise par table les changements entre
enregistrements. Les requêtes concurrentes sont regroupées en une passe en
attente; toutes les lignes visibles sont recalculées et l'index des pages et le
cache des réponses ne sont actualisés qu'après une écriture réussie.

Les critères de tri de la vue enregistrée sont appliqués en ordre de tableau avec une comparaison stable multi-clés. Les valeurs des propriétés vides suivent toujours les valeurs poolées dans les directions ascendante et décroissante, en correspondant à la sémantique de la vue de notion importée. Les vues de front et les instantanés de pointage de l'arrière utilisent la même règle pour que leur ordre d'enregistrement ne puisse pas dériver.

Quand `VaultDashboard` rend un onglet table, il passe les fonctionnalités activées du registre de table à travers `VaultViewBody` à `VaultTable`. L'onglet table, table autonome, panneau divisé et vue intégrée exposent donc les mêmes actions de rangées configurées. Omettre cette chaîne de prop masque une action même lorsque le registre et l'API la signalent correctement comme activée.

## Évolution du schéma et concurrence

Les révisions de schéma protègent un client de sauvegarder une liste de champs plus ancienne que la liste précédente. Renamer un champ met à jour les filtres, les sortes, les formules, les actions et les références de la vue enregistrée. Renamer une table détecte les collisions de fichiers à dossier plat avant de déplacer le contenu.

Les enregistrements sont écrits atomiquement et rafraîchis après les changements de métadonnées par lot. Les instantanés cachés sont invalidés lorsque les enregistrements source ou la révision du schéma changent.

Les éditeurs de propriété de pages utilisent des commandes de champ. `select` et `status` les champs sont rendus comme des sélectionneurs d'options à valeur unique; les catalogues d'état sont stricts et ne dévoilent pas la création ou la suppression d'options en ligne. La grille de table et le panneau de propriété de page doivent conserver le même type de champ et la même sémantique d'option.

## Planification des projets

La planification consomme des champs de tâches structurés et produit un calendrier faisant autorité plutôt que de doubler la logique de planification dans l'interface utilisateur. Le moteur normalise les dépendances, les calendriers, les durées, les contraintes, les ressources, les échéances, les progrès et la direction de l'horaire.

Les durées de la période conservent à la fois leur valeur numérique et leur unité configurée (`hours`, `days`, ou `years`Les années civiles sont ajoutées sous forme de compensations pour l'année civile, qui conserve une année de début plus huit ans à la fin de l'année correspondante, y compris les années négatives. L'éditeur de propriété supprime les champs redondants à date réelle, recalcule la fin chaque fois que le début, la durée ou le prédécesseur change, et utilise un choix multiple pour les prédécesseurs. `durationDays` les valeurs restent disponibles pour la compatibilité avec les enregistrements et les instantanés de calendrier plus anciens.

La fenêtre rend les commandes de résultat et d'édition. Elle ne récompense pas de façon indépendante la sémantique des chemins critiques. Les horaires cachés sont claqués par l'état d'entrée pertinent et vivent dans les données locales, pas les enregistrements source du coffre-fort.

## Comportement en cas de défaillance

- Les formules non valides retournent une erreur de champ contrôlée plutôt que d'annuler le
Réponse du tableau.
- Les relations rompues restent visibles comme des valeurs non résolues lorsque cela est possible.
- Les vues manquantes déclenchent une réparation déterministe de la vue principale.
- Les cycles de planification, les contraintes impossibles ou les calendriers manquants produisent
diagnostic et résultats partiels lorsque sûr.
- Une révision du schéma obsolète retourne un conflit et nécessite un rechargement/fusion.

## Aspects de vérification

Test de parité de filtres dactylographiés, conflits de révision de schémas, renommés de champs et de tables, ordres de formule/rollup, synchronisation de relation, tri des instantanés, actions de catalogue d'options, contraintes de programmation, chemins critiques et rendu du tableau de bord E2E.
