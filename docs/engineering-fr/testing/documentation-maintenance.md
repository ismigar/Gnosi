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
  - scripts/check_public_pipeline.py
  - pipeline/README.md
tests:
  - pipeline/skills/technical_documentation/tests
  - pipeline/tests/test_public_pipeline.py
---

# Entretien de la documentation

## Outils publics et privés

Gnosi est le dépôt source public canonique. La configuration des machines, les
sauvegardes, Drupal et la maintenance des vaults personnels appartiennent à un
dépôt privé séparé. Les versions historiques examinées sont conservées avec leurs
empreintes avant leur retrait ; ce nettoyage ne réécrit pas l'historique et ne
supprime ni données utilisateur ni services installés.

`pnpm check:pipeline` contrôle les noms et modes de l'index Git, y compris les
fichiers ignorés ajoutés explicitement. Il rejette les paquets privés connus,
caches, données, fichiers d'environnement et liens vers du code externe.
Les suppressions examinées doivent être préparées dans l'index avant le contrôle.
Il n'exécute aucune compétence et ne lit aucun secret ; il ne remplace pas un
audit complet des secrets ou de la portabilité.

La traduction, les notifications, l'assistant d'ouverture des fichiers, la
publication sociale et la planification du backend conservent leurs contrats.
L'ancien orchestrateur de développement n'était pas une dépendance de ces services.

## Contenu révisé et généré

Les pages révisées expliquent l'intention, les limites, les flux, les invariants,
le comportement en cas d'erreur, la sécurité, les opérations et la vérification.
Les pages générées énumèrent des faits extraits du code : modules, routes,
variables d'environnement, exports, tests et paquets de compétences.

Ne déduisez pas l'architecture à partir des seuls noms. Ne recopiez pas
manuellement un tableau de 400 opérations d'API dans un guide.

## Procédure standard

Depuis `Gnosi/`, lancez le contrôle complet avant de préparer le changement
final dans l'index, puis une seconde fois après. Cette seconde exécution ne
doit produire aucune différence dans les fichiers générés :

```bash
uv run --group docs python pipeline/skills/technical_documentation/scripts/pre_pr.py --base-ref origin/main
```

Étapes individuelles de diagnostic, dans le même environnement Python :

```bash
python pipeline/skills/technical_documentation/scripts/generate.py
python pipeline/skills/technical_documentation/scripts/localize.py --generated-only
python pipeline/skills/technical_documentation/scripts/generate.py --check
python pipeline/skills/technical_documentation/scripts/validate.py
python pipeline/skills/technical_documentation/scripts/localize.py --check
mkdocs build --strict
mkdocs build --strict --config-file mkdocs-ca.yml
mkdocs build --strict --config-file mkdocs-es.yml
mkdocs build --strict --config-file mkdocs-fr.yml
```

Ensuite, servez ou ouvrez `site/engineering`, parcourez les pages modifiées,
inspectez les tableaux et diagrammes et vérifiez la console du navigateur.

## Accès public

Le portail canonique est publié à `https://gnosi.temenosismael.org/engineering/`.
Le dépôt public `ismigar/Gnosi` le construit directement avec
`.github/workflows/documentation-pages.yml` ; aucun miroir ne réécrit le code source.

À chaque changement pertinent envoyé sur la branche publique `main`, le workflow
vérifie les catalogues et versions localisées, valide la traçabilité, construit
les quatre portails MkDocs en mode strict et publie `site/` via GitHub Pages.
Publier ce répertoire parent préserve le segment `/engineering/` de l'URL.

La barre latérale de Gnosi pointe vers cette adresse. Son libellé est traduit
dans les quatre langues et le portail s'ouvre hors des routes internes de l'app.

## Métadonnées des pages

Chaque page Markdown révisée déclare :

```yaml
status: implemented
last_verified: YYYY-MM-DD
source_paths:
  - backend/path/to/source.py
tests:
  - backend/tests/test_behavior.py
```

Les statuts autorisés sont `implemented`, `partial`, `experimental`, `planned`
et `deprecated`. Une page marquée `implemented` doit décrire le comportement
actuel, et non une conception restant à implémenter.

## Couverture des domaines

`domains.json` est la carte révisée des responsabilités. Chaque entrée associe
un guide à des motifs de fichiers source, des motifs de tests et des directives
privées. La couverture générée indique `covered` uniquement si le guide et
les fichiers source correspondants existent. L'absence de tests est signalée
explicitement et nécessite une décision consciente.

## Quand mettre à jour la documentation

- Ajouter ou retirer une route, un écran, un modèle, une variable de configuration
  ou une compétence : régénérez les catalogues.
- Modifier un invariant, une frontière de confiance, un cycle de vie ou le
  responsable des données : actualisez le guide d'architecture ou du domaine.
- Ajouter un fournisseur ou une dépendance de déploiement : actualisez les
  guides du domaine et des opérations.
- Découvrir une erreur ou une contrainte de récupération : actualisez d'abord
  la directive, puis intégrez les connaissances consolidées au portail.
- Prendre une décision architecturale durable : ajoutez un ADR.

## Contrôle d'impact en CI

Le contrôle documentaire des PR couvre les changements susceptibles de modifier
une frontière du système ou un contrat opérationnel : API et services du backend,
intégrations, exécution native et desktop, déploiement, authentification,
routage, fournisseurs et structure principale du frontend.

Les changements ordinaires de composants, écrans, styles ou tests n'exigent pas
de modifier la prose si le contrat reste exact. Une mise à jour est nécessaire
s'ils modifient un invariant, la sécurité, le cycle de vie, la propriété des
données, la récupération ou un autre fait durable du système.

Après le déplacement, le contrôle protège `frontend/src/app/`,
`frontend/src/features/auth/`, `frontend/src/shared/auth/`,
`frontend/src/shared/routing/`, `frontend/src/shared/ui/layout/`, le fournisseur
API et les hooks d'authentification partagés, ainsi que `frontend/feature-public-entries.json`.
Les anciens chemins sensibles restent reconnus pour les suppressions et renommages.
Les changements limités à `*.test.*`, `*.spec.*`, `__tests__/`, `tests/` et CSS
restent exemptés. Déplacer une UI ordinaire n'en fait pas du code à fort impact.
Les changements sensibles exigent une documentation en anglais ; les versions
catalane, espagnole et française conservent les mêmes chemins techniques.
Les fixtures historiques peuvent garder d'anciens chemins, sans les présenter
comme des emplacements actuels du code.

## Validation contre les divergences

Le validateur contrôle les avis de génération, métadonnées, chemins source et
tests, liens internes, guides requis, chemins absolus locaux et secrets possibles.
`generate.py --check` compare les fichiers versionnés au code actuel.
`localize.py --check` vérifie la parité des arbres catalan, espagnol et français.
MkDocs en mode strict valide la navigation et les liens des quatre portails.

Les titres et libellés fixes des catalogues sont traduits de façon déterministe.
Les données extraites du code, identifiants et chemins restent identiques à
l'anglais. `localize.py --generated-only` les actualise sans modèles ni imports
de l'application. N'utilisez pas de traduction automatique complète pour les régénérer.

Ces contrôles ne prouvent pas l'exactitude de la prose : comparez les affirmations
au code et aux tests liés.
