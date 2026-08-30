---
status: implemented
last_verified: 2026-08-20
source_paths:
  - pipeline/skills/technical_documentation/SKILL.md
  - pipeline/skills/technical_documentation/domains.json
  - pipeline/skills/technical_documentation/scripts/check_change_impact.py
  - pipeline/skills/technical_documentation/scripts/generate.py
  - pipeline/skills/technical_documentation/scripts/localize.py
  - mkdocs.yml
  - mkdocs-ca.yml
  - mkdocs-es.yml
  - mkdocs-fr.yml
tests:
  - pipeline/skills/technical_documentation/tests
---

# Entretien de la documentation

## Contenu examiné par rapport au contenu généré

Les pages révisées expliquent l'intention, les limites, les flux, les invariants, le comportement de défaillance, la sécurité, les opérations et la vérification.

Ne pas placer les revendications architecturales dans le générateur uniquement en fonction des noms. Ne pas reproduire manuellement une table API d'opération 400 dans un guide révisé.

## Flux de travail standard

De `Gnosi/`:

```bash
python pipeline/skills/technical_documentation/scripts/generate.py
python pipeline/skills/technical_documentation/scripts/generate.py --check
python pipeline/skills/technical_documentation/scripts/validate.py
python pipeline/skills/technical_documentation/scripts/localize.py --check
mkdocs build --strict
mkdocs build --strict --config-file mkdocs-ca.yml
mkdocs build --strict --config-file mkdocs-es.yml
mkdocs build --strict --config-file mkdocs-fr.yml
```

Puis servir ou ouvrir `site/engineering`, naviguer sur les pages modifiées, inspecter les tableaux et les diagrammes, et vérifier la console du navigateur.

## Accès du public

Le portail canonique est publié à l'adresse suivante: `https://gnosi.temenosismael.org/engineering/`. Les exportations privées monoréponses `monorepo/` à la racine du public `ismigar/Gnosi` Le dépôt. Cela fait `monorepo/.github/workflows/documentation-pages.yml` la source du public `.github/workflows/documentation-pages.yml` le processus de déploiement.

Sur chaque pression pertinente auprès du public `main` branch, le workflow vérifie les catalogues générés et les miroirs localisés, valide la traçabilité, construit les portails anglais, catalan, espagnol et français MkDocs en mode strict, et publie le `site/` arbre à travers les pages GitHub. Publier le parent `site/` répertoire conserve le `/engineering/` Le segment URL.

La barre latérale globale de Gnosi est reliée à la même adresse canonique. L'étiquette est localisée en catalan, anglais, espagnol et français et le portail s'ouvre en dehors de l'arbre d'itinéraire de l'application.

## Page métadonnées

Chaque page de la note de bas de page révisée déclare :

```yaml
status: implemented
last_verified: YYYY-MM-DD
source_paths:
  - backend/path/to/source.py
tests:
  - backend/tests/test_behavior.py
```

Les statuts autorisés sont: `implemented`, `partial`, `experimental`, `planned`, et `deprecated`. Une page marquée `implemented` doit décrire le comportement actuel. Une conception planifiée ne doit pas figurer sous une rubrique mise en oeuvre.

## Couverture des domaines

`domains.json` est la carte de responsabilité curated. Chaque entrée relie un guide de domaine aux globes sources, globes de test, et directives privées pertinentes. `covered` Le test est visible et nécessite une décision délibérée.

## Ce qui nécessite une mise à jour

- Une nouvelle route, une page de navigateur, un modèle, un nom de configuration ou un temps d'exécution ou une nouvelle ou supprimée
habileté: régénérer les catalogues.
- Un invariant, une limite de confiance, un cycle de vie ou un propriétaire de stockage modifié : mettre à jour le
revue l'architecture/le guide des domaines.
- Un nouveau fournisseur ou dépendance de déploiement : actualiser les pages de domaine et d'opérations.
- Une nouvelle contrainte de défaillance ou de récupération: mettre à jour la directive d'abord, puis
promouvoir des connaissances stables au portail.
- Une décision architecturale durable : ajouter un ADR.

## Porte d'impact de l'IC

La porte de documentation de la demande de transfert est orientée vers des modifications qui peuvent modifier une limite du système ou un contrat opérationnel. Elle couvre les API et services de backend, les intégrations, le code d'exécution desktop et natif, les fichiers de déploiement et l'authentification frontale, le routage, les fournisseurs et le code de coque d'application.

Les modifications systématiques de la partie frontale, de la page, du style et des tests ne nécessitent pas de modification de la documentation de prose lorsque le contrat existant reste exact. Ils nécessitent quand ils changent un invariant, une limite de confiance, un cycle de vie, un propriétaire de stockage, une contrainte de défaillance ou tout autre fait durable du système.

Après le déplacement, le gate protège `frontend/src/app/`,
`frontend/src/features/auth/`, `frontend/src/shared/auth/`,
`frontend/src/shared/routing/`, `frontend/src/shared/ui/layout/`, le fournisseur
API et les hooks d'authentification partagés, ainsi que `frontend/feature-public-entries.json`.
Les anciens chemins sensibles restent reconnus pour les suppressions et renommages.
Les changements limités aux `*.test.*`, `*.spec.*`, `__tests__/`, `tests/`
et CSS restent exemptés. Déplacer une UI ordinaire n'en fait pas du code à fort impact.
Les changements sensibles exigent toujours une preuve documentaire en anglais ;
les miroirs révisés catalan, espagnol et français conservent les mêmes chemins techniques.
Les fixtures synthétiques historiques peuvent garder les anciens chemins ;
ajouter des régressions pour les nouveaux chemins sans présenter les fixtures
comme des emplacements actuels du code.

## Validation anti-déroulement

Les contrôles de validation ont généré des avis, des métadonnées, des chemins source/test, des liens internes, des guides de domaine requis, des chemins absolus locaux et du matériel secret évident. `generate.py --check` compare de façon indépendante la sortie engagée à l'arbre actuel. `localize.py --check` MkDocs valide les liens de navigation et de documentation dans les quatre portails.

Le français conserve des catalogues de sources déterministes en anglais canonique parce que les noms de route, les identificateurs de code et les descriptions de sources extraites sont des preuves de référence plutôt que de prose étudiée; sa navigation et le portail environnant restent localisés.

Ces contrôles ne peuvent pas prouver la sémantique de prose. Les examinateurs doivent comparer les revendications avec la source et les tests liés.
