# Collecter des sources, lire et citer

Suivez le parcours de recherche de la source à la preuve puis à votre rédaction. Lecture de flux et gestion bibliographique sont deux fonctions distinctes.

## Avant de commencer {#before-you-begin}

Activez Ressources pour les références et Lecteur de flux pour les abonnements. La recherche d’identifiants nécessite le réseau ; Word et LibreOffice nécessitent leur complément de citation.

## Étapes {#steps}

1. Ouvrez **Recherche bibliographique** (la fonction Ressources) et vérifiez la table de références configurée. Importez un DOI, ISBN, arXiv ou PMID, un fichier BibTeX/RIS ou une URL compatible.

2. Vérifiez titre, auteurs, date et identifiant avant d’utiliser la fiche. Résolvez les doublons éventuels au lieu de répéter l’importation.

3. Ouvrez un PDF ou EPUB joint. Annotez un passage en conservant sa page, son chapitre ou son emplacement et vérifiez que l’annotation pointe au bon endroit.

4. Créez une note de lecture avec la preuve et un paragraphe distinct pour votre interprétation. Reliez-la à la référence et au projet.

5. Pour suivre des flux, activez le Lecteur, ajoutez un flux et ouvrez un article. Son contenu peut nécessiter un accès auprès de l’éditeur.

6. Pour rédiger, installez et configurez le [complément Word](https://github.com/ismigar/Gnosi/tree/main/extensions/office/word-cite) ou l’[extension LibreOffice](https://github.com/ismigar/Gnosi/tree/main/extensions/office/libreoffice-cite). Utilisez le sélecteur de citations et la bibliographie ; vérifiez auteur, année et style.

## Résultat attendu {#expected-result}

Vous avez une référence vérifiée, une annotation traçable et une note reliée à votre rédaction.

### Champs des notes générées

Dans **Paramètres → Plugins → Connaissance**, sous chaque table de ressources, utilisez **Champs à remplir dans les notes de lecture → Ajouter un champ**. Choisissez un champ du Cerveau puis **Inférer avec l’IA**, **Copier le champ source**, **Valeur fixe** ou **Laisser vide**. Retirer une règle ne supprime pas le champ de la table. Cette sélection est indépendante des champs indexés.

L’IA attribue les valeurs selon chaque note et utilise uniquement les étiquettes et relations existantes. Les valeurs fixes respectent le type du champ, notamment les nombres, cases et dates ; les pièces jointes et autres champs structurés peuvent être copiés depuis la ressource. Les champs calculés et système sont gérés automatiquement. Les règles s’appliquent au traitement ou au retraitement de la ressource. **Laisser vide** efface la valeur dans les notes retraitées ; retirer la règle conserve les valeurs précédentes.

## En cas de problème {#troubleshooting}

Un identifiant apporte des métadonnées, sans garantir l’accès au texte intégral. En cas d’échec, vérifiez identifiant et fournisseur ou essayez un export compatible. Corrigez les métadonnées avant de modifier manuellement la bibliographie.

## Guides associés {#related-guides}

- [Interroger les sources sélectionnées](notebooks.md)
- [Créer des pages, des liens et des pièces jointes](pages-files.md)

## Écouter le podcast quotidien

Avec le Lecteur de flux activé, configurez le podcast quotidien dans ses réglages et le modèle de l’assistant affecté dans **Paramètres → IA**. L’épisode quotidien sélectionne les articles publiés au cours des 24 heures précédentes. Les sources illisibles sont signalées ; si aucune ne peut être lue, aucun épisode n’est publié.

Personnalisez la compétence **Résumé quotidien** affectée pour adapter son approche éditoriale et les préférences du podcast. Les valeurs par défaut demandent dix minutes et douze groupes thématiques au maximum. La révision par défaut vérifie les résumés des sources et la couverture thématique, y compris les sujets indépendants moins représentés ; la révision complète facultative examine les fragments originaux plus en détail. La durée est un objectif et la génération peut échouer si elle ne respecte pas la longueur ou la fidélité aux sources requises. Vérifiez l’épisode terminé et les sources indiquées avant de vous y fier.

Les réglages de voix sont partagés entre le chat, les podcasts du Lecteur et l’audio généré dans le Vault actif. Les changements s’enregistrent automatiquement ; vérifiez leur état avant d’écouter un essai. La voix locale doit être disponible sur le serveur et la voix neuronale nécessite le fournisseur configuré.

### Génération et récupération

Activez le Lecteur de flux et l’IA, configurez l’assistant affecté à la compétence du résumé quotidien et vérifiez les réglages vocaux. Dans le Lecteur, utilisez le bouton de génération du podcast ; si un épisode existe déjà, utilisez son bouton de régénération. Ouvrez le panneau vocal sous le lecteur audio pour écouter un essai, ou utilisez son bouton **Ouvrir les paramètres** pour modifier la configuration partagée. L’essai est indisponible pendant la génération.

L’épisode utilise les articles publiés au cours des 24 dernières heures, y compris ceux déjà lus. Les articles sans texte lisible ni résumé de flux sont omis et signalés. La génération peut prendre plusieurs minutes ; suivez sa progression et utilisez Activité pour inspecter ou annuler la tâche. Écoutez l’épisode terminé dans le lecteur audio. Une erreur ou une annulation conserve l’audio précédent ; si aucun article n’est lisible, aucun remplacement n’est produit.

Les journées pauvres en articles peuvent produire des épisodes plus courts. Les changements de configuration s’appliquent aux nouvelles tâches ; une tâche reprise conserve sa sélection et ses préférences initiales.
