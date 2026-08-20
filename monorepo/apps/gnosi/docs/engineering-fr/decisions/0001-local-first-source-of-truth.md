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

# ADR 0001: La valle de la marque comme source de connaissance de la vérité

- État d ' avancement: accepté
- Date de la décision : 2026-08-02 (formalisé à partir de l'architecture existante)

## Contexte

Gnosi a besoin d'un montage structuré, de recherche, de traversée graphique, de collaboration et d'automatisation tout en préservant la propriété et l'interopérabilité des utilisateurs. Faire une base de données d'applications la seule représentation créerait lock-in et ferait la sauvegarde de fichiers ordinaire, synchronisation, et l'édition externe secondaire.

## Décision

Les connaissances de l'utilisateur sont stockées sous forme de matière de marque, de matière de couverture YAML et d'actifs dans une valle contrôlée par l'utilisateur. Les bases de données relatives stockent l'état de l'application qui n'est pas la représentation de la connaissance auteure.

## Conséquences

- Les fichiers restent inspectables et portables sans Gnosi.
- Les écrits exigent l'atomicité, les ETags, la normalisation de l'identité et la mise à jour de l'index.
- Les éditeurs externes et les fournisseurs de cloud présentent la concurrence et la disponibilité
Les problèmes que doivent tolérer les services.
- Les vues de type base de données sont des projections sur les fichiers, donc l'évaluation dactylographiée et
La cohérence des registres est une responsabilité d'application.
- SQLite et secrets restent local-seulement parce qu'ils ont une durabilité différente
et synchronisation sémantique.

## Autres solutions de remplacement rejetées

- SQL comme seul magasin de connaissances : plus fortes transactions mais perte de portable
la propriété du fichier.
- Cloud SaaS comme source obligatoire : une collaboration centralisée plus facile mais
incompatible avec la souveraineté locale et première.
- Traitement de SQLite synchronisé comme stockage portable: dangereux parce que la synchronisation de fichier
ne fournit pas de verrouillage de la base de données ou de réplication atomique.

## Impact de la vérification

Les tests couvrent les voyages aller-retour Markdown, les écrits atomiques, les conflits ETag, le comportement d'identification et de lien, les reconstructions d'index, le confinement de chemin, les défaillances du fournisseur et l'isolement local des données.
