---
status: implemented
last_verified: 2026-08-02
source_paths:
  - pyproject.toml
  - uv.lock
  - mkdocs.yml
  - pipeline/skills/technical_documentation/SKILL.md
  - pipeline/skills/technical_documentation/scripts/generate.py
tests:
  - pipeline/skills/technical_documentation/tests
---

# ADR 0002 : documentation révisée et références générées depuis le code

- Statut : accepté
- Date de la décision : 2026-08-02

## Contexte

Gnosi possède des centaines de modules backend et frontend et une vaste mémoire d'implémentation. Un fichier d'architecture unique maintenu manuellement ne peut pas énumérer l'API, la configuration, les composants, les tests et les compétences actuels sans devenir obsolète. Une prose entièrement générée serait exhaustive, mais incapable d'expliquer l'intention, et risquerait de transformer des noms en affirmations fausses.

## Décision

Maintenir un portail d'ingénierie MkDocs dans l'arborescence de référence de l'application. Les pages révisées par des humains décrivent l'objectif, l'architecture, le comportement des domaines, la sécurité, les opérations et les décisions. Un générateur déterministe utilisant la bibliothèque standard produit les catalogues du code source. Les pages générées sont versionnées et vérifiées en CI.

Le générateur effectue une inspection statique ; il n'importe jamais l'application et ne lit ni configuration locale ni secrets.

## Conséquences

- Les ingénieurs peuvent naviguer de l'intention au code source exact et aux tests.
- Les différences générées révèlent les changements d'interface lors de la revue.
- La répartition des responsabilités des domaines reste définie explicitement dans `domains.json`.
- Les réviseurs vérifient toujours le sens de la prose ; l'automatisation contrôle la traçabilité, pas la justesse des explications humaines.
- Les dépendances documentaires utilisent le groupe optionnel `docs` de
  `pyproject.toml` et le `uv.lock` partagé, pas un fichier de dépendances ni
  un environnement séparé. Générer les catalogues n'importe pas la pile ML de l'application.

## Alternatives rejetées

- Un manuel monolithique : navigation difficile, conflits de revue et obsolescence rapide.
- Les docstrings seules : insuffisantes pour les flux entre composants et les décisions opérationnelles.
- Importer FastAPI à l'exécution pour chaque build documentaire : effets de bord, dépendances de l'hôte, chargement de secrets et initialisation de bases de données.
- Ne pas versionner les fichiers générés : leurs changements deviennent invisibles lors de la revue de code.

## Impact de la vérification

La CI exécute les tests unitaires du générateur, le contrôle des fichiers générés obsolètes, la validation du portail et le build strict de MkDocs. La QA dans le navigateur vérifie le portail rendu et les diagrammes Mermaid.
