---
status: implemented
last_verified: 2026-08-02
source_paths:
  - backend/api/vault_routes.py
  - backend/config/paths_config.py
  - backend/data/management_db.py
tests:
  - backend/tests/test_safe_io.py
  - backend/tests/test_e2e_etag_concurrency.py
---

# ADR 0001 : le vault Markdown comme source de vérité des connaissances

- Statut : accepté
- Date de la décision : 2026-08-02 (formalisée à partir de l'architecture existante)

## Contexte

Gnosi a besoin d'édition structurée, de recherche, de parcours de graphe, de collaboration et d'automatisation, tout en préservant la maîtrise des données par l'utilisateur et l'interopérabilité. Faire d'une base applicative l'unique représentation créerait une dépendance à l'application et reléguerait au second plan la sauvegarde ordinaire des fichiers, leur synchronisation et leur édition externe.

## Décision

Les connaissances de l'utilisateur sont stockées sous forme de Markdown, de frontmatter YAML et de ressources dans un vault qu'il contrôle. Les bases relationnelles stockent l'état applicatif distinct des connaissances rédigées. Les index et caches dérivés du vault peuvent être reconstruits.

## Conséquences

- Les fichiers restent inspectables et portables sans Gnosi.
- Les écritures exigent atomicité, ETags, normalisation des identités et actualisation des index.
- Les éditeurs externes et fournisseurs cloud introduisent des problèmes de concurrence et de disponibilité que les services doivent tolérer.
- Les vues de type base de données sont des projections sur les fichiers ; l'évaluation typée et la cohérence des registres relèvent donc de l'application.
- SQLite et les secrets restent strictement locaux, car leur durabilité et leur synchronisation ont des sémantiques différentes.

## Alternatives rejetées

- SQL comme unique stockage des connaissances : transactions plus fortes, mais perte de la maîtrise de fichiers portables.
- SaaS cloud comme source obligatoire : collaboration centralisée plus simple, mais incompatible avec une souveraineté fondée sur le stockage local.
- SQLite synchronisé comme stockage portable : dangereux, car la synchronisation de fichiers ne fournit ni verrouillage de base de données ni réplication atomique.

## Impact de la vérification

Les tests couvrent les allers-retours Markdown, les écritures atomiques, les conflits ETag, le comportement des identifiants et des liens, la reconstruction des index, le confinement des chemins, les défaillances des fournisseurs et l'isolation des données locales.
