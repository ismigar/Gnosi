---
status: implemented
last_verified: 2026-08-02
source_paths:
  - mkdocs.yml
  - pipeline/skills/technical_documentation/SKILL.md
  - pipeline/skills/technical_documentation/scripts/generate.py
tests:
  - pipeline/skills/technical_documentation/tests
---

# ADR 0002: documentation examinée plus référence générée

- État d ' avancement: accepté
- Date de la décision : 2026-08-02

## Contexte

Gnosi possède des centaines de modules backend et frontend et une mémoire d'implémentation étendue. Un fichier d'architecture unique manuellement maintenu ne peut pas énumérer l'API, la configuration, les composants, les tests et les compétences actuels sans dérive.

## Décision

Maintenir un portail d'ingénierie MkDocs dans l'arbre d'application faisant autorité. Les pages revues par l'homme ont leur propre but, architecture, comportement du domaine, sécurité, opérations et décisions. Un générateur de bibliothèques standard déterministe possède des catalogues sources. Les pages générées sont engagées et vérifiées en CI.

Le générateur effectue une inspection statique et n'importe jamais l'application ou lit la configuration locale/secrets.

## Conséquences

- Les ingénieurs peuvent naviguer de l'intention à la source exacte et les tests.
- Les différences générées révèlent des changements de surface pendant l'examen.
- La propriété de domaine reste à la `domains.json`.
- Les examinateurs vérifient toujours la sémantique de la prose; l'automatisation vérifie la traçabilité, pas
la justesse des explications humaines.
- Les outils de documentation utilisent un fichier d'exigences isolé et ne perturbent pas la
jeu de dépendance ML en cours d'exécution.

## Autres solutions de remplacement rejetées

- Un manuel monolithique : mauvaise navigation, examen des conflits et dérive rapide.
- Les chaînes de pression seules: insuffisantes pour les flux de composants croisés et opérationnelles
les décisions.
- Importation en temps de marche de FastAPI pour chaque construction de documents: effets secondaires, hôte
les dépendances, le chargement secret et l'initialisation de la base de données.
- Sortie générée non engagée : les changements deviennent invisibles dans l'examen de code.

## Impact de la vérification

CI exécute des tests d'unités de générateur, contrôle de sortie, validation du portail et construction stricte de MkDocs. Le navigateur QA vérifie le portail rendu et les diagrammes de la Sirene.
