---
status: implemented
last_verified: 2026-09-08
source_paths:
  - backend/domains/genograms
  - frontend/src/features/genograms
  - frontend/src/shared/api/genograms.ts
  - backend/services/builtin_plugins.py
  - frontend/src/features/vault/views/VaultViewBody.tsx
  - frontend/src/features/vault/views/db-view-embed/useEmbedDerived.ts
tests:
  - backend/tests/test_genograms.py
  - backend/tests/test_genograms_api.py
  - frontend/src/features/genograms/genograms.test.tsx
  - frontend/src/features/genograms/export.test.ts
  - frontend/src/features/vault/view-config/page-view-modal/useViewAppearance.genogram.test.tsx
---

# Génogrammes

Le plugin intégré facultatif `genograms` conserve un réseau familial partagé dans chaque Vault. Activez-le dans Paramètres → Plugins → Génogrammes, puis choisissez **Préparer les tables**. Cette opération crée la base Génogrammes, les tables Personnes et Relations, leurs vues tabulaires principales et une première vue Génogramme. Les noms suivent la langue de l’interface : catalan, espagnol, anglais ou français. Répéter la préparation réutilise les identifiants stables des tables et champs et restaure les champs obligatoires manquants.

Choisissez une personne de référence dans le dessin. Par défaut, la vue comprend deux générations d’ascendants, une de descendants, la fratrie de la personne de référence et les partenaires immédiats. L’expansion des partenaires ne parcourt pas toute leur famille. Les inclusions, exclusions et filtres habituels de la table délimitent le réseau visible. La recherche souligne les noms sans filtrer le dessin. Le nombre de connexions masquées est indiqué ; aucune filiation n’est inventée entre les personnes encore visibles.

## Registres et validation

Les personnes et relations restent des registres Markdown ordinaires, avec des champs YAML nommés et un corps de note. Les champs sont reconnus par leurs identifiants stables : renommer un champ ou une table ne casse pas l’adaptateur. Les options sont stockées sous leur nom traduit dans la table ; l’API les normalise en codes stables. Les identifiants sont indépendants des noms, qui peuvent se répéter. Les sources renvoient à d’autres registres du Vault ; les personnes acceptent aussi des étiquettes.

Les dates partielles conservent leur précision (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`), avec des indicateurs d’approximation séparés. Une date inconnue reste vide. Un registre de grossesse peut devenir une personne sans changer d’identité. Les naissances multiples partagent un groupe. Unions, filiations dirigées et liens émotionnels ont leur propre identité ; une filiation peut désigner une union précise. L’absence de lien émotionnel signifie qu’il n’est pas documenté. Les dates sont conservées, mais cette version ne reconstitue pas les états historiques.

Les écritures Markdown et les déplacements vers la corbeille partagent les validations de l’éditeur visuel. Un verrou de fichier par Vault et un verrou interne sérialisent validation et écriture entre les processus locaux du serveur. Les protections ETag sont conservées. Les autorrelations, références inexistantes, doublons, unions incompatibles et cycles de filiation sont refusés. Les ancêtres communs et cycles de partenaires ou de liens émotionnels sont acceptés. Les relations vides restent des brouillons signalés jusqu’à ce que leurs extrémités soient complétées. Les contradictions de dates produisent des avertissements. Il faut résoudre les relations avant de supprimer un registre référencé ; aucune suppression en cascade n’est effectuée.

Les requêtes lisent les deux dossiers du réseau sans dépendre d’un index asynchrone. Les relations invalides modifiées extérieurement sont signalées et exclues du dessin ; la lecture ne répare jamais les fichiers. Les fichiers illisibles bloquent les modifications jusqu’à résolution du problème, car un réseau incomplet ne peut pas être validé.

## Vues et dessin

L’objet versionné `genogram` du registre de vue conserve la référence, les profondeurs, inclusions, libellés, couches et coordonnées manuelles. Le même composant sert dans les tables, panneaux et notes. Copier une vue dans une note conserve ses options. Déplacer un symbole ne modifie que cette vue. Les données des registres sont partagées ; désactiver le plugin conserve les tables et configurations et affiche son état désactivé dans les vues graphiques.

La disposition est calculée dans un processus distinct du navigateur. La filiation détermine les niveaux ; les partenaires ne sont alignés que si cela ne contredit pas l’ascendance. Les partenaires et naissances multiples sont regroupés ; la fratrie est ordonnée par naissance ou ordre explicite. Chaque personne apparaît une seule fois. Les liens émotionnels n’affectent pas les positions. Les coordonnées manuelles prévalent jusqu’à **Réorganiser**. Les révisions et annulations propres au Vault écartent les chargements, réponses de disposition et sauvegardes obsolètes.

Le dessin utilise un SVG monochrome, des symboles géométriques et des motifs de ligne distincts. La légende ne présente que les conventions utilisées. Le répertoire s’appuie sur les [symboles GenoPro](https://genopro.com/genogram/symbols/) et les [liens émotionnels](https://genopro.com/genogram/emotional-relationships/). La légende identifie le symbole neutre en losange avec point d’interrogation et les adaptations monochromes. Les branches complexes peuvent être ajustées manuellement.

## API et exportation

- `POST /api/vault/genograms/prepare` : préparation idempotente réservée aux éditeurs.
- `POST /api/vault/genograms/graph` : résout les options enregistrées ou locales, normalise et valide le réseau et renvoie les identifiants visibles, problèmes et correspondances de champs.
- Création et modification utilisent les API ordinaires des pages du Vault et ETag.

Les exports partent du SVG visible, avec titre, date de génération et légende si elle est activée. Noms complets, initiales et alias n’affectent que le rendu. Les attributs interactifs et surbrillances de sélection sont retirés. Le SVG intègre les styles. Le PNG utilise un fond blanc et une résolution double, réduite proportionnellement au-delà de 32 mégapixels ou 16 000 pixels par côté, sans recadrage.

La conversion PDF charge localement jsPDF et [svg2pdf.js](https://github.com/yWorks/svg2pdf.js/), incorpore Liberation Sans et propose A4/A3, portrait ou paysage, ajustement à la page ou mosaïque. La licence des polices est incluse dans les ressources de la fonctionnalité. La conversion ne nécessite ni service externe ni IA.

## Vérification

Les tests du serveur couvrent préparation et modifications dans des Vaults temporaires, cycles et modifications simultanées, champs renommés, ETag, conversion de grossesses, désactivation du plugin et fichiers externes incorrects. Les tests de l’interface couvrent disposition déterministe, ancêtres communs, partenaires de générations différentes, positions manuelles, symboles périnataux, confidentialité des exports et options des vues insérées.

Le test PDF exécute les véritables convertisseurs, vérifie les polices incorporées et une mosaïque de neuf pages et ne remplace que la géométrie de texte absente de jsdom. La revue dans le navigateur couvre l’édition sans quitter la vue, la sélection des lignes, le déplacement manuel, la stabilité de la couche émotionnelle et le masquage ou rétablissement des personnes.

Un jeu déterministe mesure la disposition de 200 personnes et 500 relations. Le seuil de 1,5 seconde détecte les régressions ; il ne garantit pas les performances de chaque appareil et ne mesure pas tout le rendu. Les grands réseaux doivent être explorés par personne de référence et branches. L’API ne tronque jamais les registres silencieusement.

GEDCOM, reconstitution temporelle, conditions cliniques structurées et écomaps restent de futures extensions.
