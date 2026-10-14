# Créer des pages, des liens et des pièces jointes

Utilisez les pages pour vos idées et conservez les documents qui les étayent à proximité. Gnosi enregistre les connaissances dans des fichiers Markdown et YAML.

## Avant de commencer {#before-you-begin}

Un Vault actif accessible en écriture. L’IA est facultative ; partage et traduction nécessitent leurs extensions.

## Étapes {#steps}

1. Ouvrez Connaissances et créez « Projet de lecture ». Ajoutez un titre, un paragraphe et une liste de questions avec l’éditeur de blocs.

2. Créez « Notes de la source ». Insérez un lien vers cette page depuis la première avec le sélecteur ; vérifiez le résultat si des titres se ressemblent.

3. Joignez un petit document avec les commandes de l’éditeur. Rouvrez-le pour vérifier la disponibilité du fichier original.

4. Ajoutez une citation avec sa source et son emplacement. Séparez-la de votre interprétation pour pouvoir en retrouver l’origine.

5. Quittez puis rouvrez la page pour vérifier l’enregistrement automatique. Retrouvez-la par la recherche ou la barre latérale et testez le lien.

### Tableaux larges

Dans le menu **⋯** de la page, activez **Largeur libre** pour permettre aux tableaux de s’étendre et de défiler horizontalement. Les paragraphes gardent une largeur lisible. Ce réglage est mémorisé pour chaque page sur cet appareil et ne modifie pas le Markdown. Désactivez-le dans le même menu pour retrouver la présentation habituelle.

### Rechercher dans les notes complètes et réutiliser le contenu

La recherche globale trouve des mots dans toute la note et affiche un extrait.
Utilisez `"expression exacte"`, `(rouge OR bleu) -vert`, `tag:recherche`,
`content:"mémoire de travail"`, `task-todo:relire` ou `[statut:Brouillon]`.
`line:(renard roux)`, `block:(renard roux)` et `section:(renard roux)` exigent
les mots dans la même ligne, le même bloc ou la même section. Une requête
incorrecte affiche une erreur permettant de la corriger. Le bloc **Résultats de recherche**,
ou un bloc de code Markdown nommé `query`, conserve des résultats de recherche
actualisés dans une note.

Écrivez `![[Notes de source]]` pour afficher tout leur contenu mis en forme.
`![[Notes de source#Titre]]` et `![[Notes de source#^id-bloc]]` incorporent une
partie précise. Les tableaux, le code et les notes imbriquées sont affichés ;
les références circulaires s'arrêtent avec une explication. La source reste une
note indépendante et la transclusion se met à jour après les modifications.

L'éditeur source Markdown propose la coloration, plusieurs curseurs, le mode
Vim et un aperçu. Configurez les raccourcis dans les paramètres et enregistrez
des thèmes ou extraits CSS dans Apparence. Si un extrait gêne l'utilisation,
ouvrez Gnosi avec `?gnosi-safe-appearance=1` et réinitialisez l'apparence.

### Composer des notes et enregistrer des accès

Dans le menu **⋯** d’une note, choisissez **Combiner et extraire des notes**. Sélectionnez la note entière, un titre ou des lignes Markdown complètes, puis choisissez une nouvelle note ou une destination existante. **Prévisualiser les modifications** montre la source, la destination et les liens affectés. Vérifiez chaque changement avant de l’appliquer. La source conserve une transclusion et son historique. Si un autre éditeur modifie un fichier, préparez un nouvel aperçu.

Dans les **Favoris** de la barre latérale, enregistrez notes, sections, recherches, vues de graphe ou liens web et attribuez-leur un groupe. Modifiez un favori pour le renommer, le déplacer ou le supprimer. Ces favoris appartiennent au compte, à l’espace de travail et au Vault sélectionnés sur cet appareil.

## Résultat attendu {#expected-result}

Votre note contient du texte lisible, un lien et une pièce jointe accessible.

## En cas de problème {#troubleshooting}

En cas de conflit d’enregistrement, conservez le texte non enregistré et comparez-le à la version récente avant de réessayer. Si une pièce jointe manque, vérifiez l’original et le Vault ; une miniature ne remplace pas une sauvegarde.

## Guides associés {#related-guides}

- [Collecter des sources, lire et citer](reading-references.md)
- [Organiser les fiches et planifier le travail](databases-planning.md)
