# Espaces de travail, Vaults et partage

L’espace de travail définit les personnes et les permissions. Le Vault contient les fichiers de connaissances. Changer l’un peut modifier les données et les réglages visibles.

## Avant de commencer {#before-you-begin}

Un espace existant. Dans une organisation, une adhésion et un rôle d’éditeur peuvent être nécessaires. Le partage externe nécessite son extension.

## Étapes {#steps}

1. Vérifiez le nom de l’espace dans le sélecteur. Choisissez un espace existant ou **Nouvel espace de travail** si votre installation autorise sa création.

2. Ouvrez le sélecteur de Vaults ou Paramètres → Général → Fichiers. Sélectionnez le Vault prévu ou créez-en un nommé « Groupe de lecture ».

3. Créez une page de test puis retrouvez-la après avoir changé de Vault et être revenu. Vous confirmez ainsi son emplacement.

4. Pour collaborer, gérez les membres et les rôles dans les paramètres de l’espace. Accordez la modification aux personnes qui doivent changer le contenu.

5. Pour partager une page à l’extérieur, activez l’extension de partage et utilisez les commandes de la page. Vérifiez permissions et expiration, puis ouvrez le lien dans une autre session du navigateur pour contrôler ce qu’un visiteur voit.

## Résultat attendu {#expected-result}

Vous savez identifier l’espace et le Vault actifs et vérifier la portée d’une page partagée.

## En cas de problème {#troubleshooting}

Un Vault local n’apparaît pas automatiquement sur un autre ordinateur. Adhésion, synchronisation de fichiers et liens publics sont des mécanismes distincts. Vérifiez le compte et le dossier avant toute suppression pour résoudre un espace manquant.

## Guides associés {#related-guides}

- [Installer Gnosi et faire ses premiers pas](getting-started.md)
- [Questions fréquentes et récupération](troubleshooting.md)

## Catalogue et modération des modèles de Vault

En mode personnel, Paramètres → Général → Structure des fichiers → Vaults → Depuis le dépôt ouvre le catalogue vérifié. La recherche, les filtres par catégorie et les aperçus du contenu aident à choisir un modèle ; l’installation crée un nouveau Vault. Publier un modèle ouvre un inventaire consultable des fichiers inclus, des exclusions et des données potentiellement sensibles. Actualiser l’inventaire efface l’acceptation précédente.

## Dispositions enregistrées et notes du canvas

Les dispositions enregistrées retiennent notes ouvertes, dessins, lecteurs PDF et EPUB, document actif et dimensions des panneaux. Elles restaurent aussi les positions de lecture. Si une destination n’existe plus, Gnosi signale le problème avant de remplacer la disposition actuelle.

Sur une carte de page du canvas, utilisez **Modifier** et **Enregistrer** pour changer la note. Les brouillons survivent aux changements de disposition pendant la session ; sauvegardez-les avant de fermer l’application. L’import et l’export JSON Canvas préservent les cartes, connexions et métadonnées compatibles. L’import ne copie pas les pièces jointes, et Gnosi signale les structures non prises en charge.

## Emporter des notes sélectionnées hors connexion

Connectez-vous au serveur Gnosi, sélectionnez compte, espace de travail et Vault, puis ouvrez le compagnon de notes hors connexion dans Paramètres → Général. Créez une collection chiffrée avec une phrase secrète distincte, chargez la liste du serveur et ajoutez les notes textuelles nécessaires. Utilisez **Enregistrer localement** après modification. Après le premier chargement réussi en production, le compagnon peut se rouvrir sans réseau. Dans le navigateur mobile, ajoutez-le à l’écran d’accueil ; le serveur doit utiliser HTTPS.

Reconnectez-vous et synchronisez explicitement. Si les deux copies ont changé, comparez les textes original, local et serveur, puis choisissez ou rédigez une version fusionnée. Conservez la phrase secrète : elle ne peut pas être récupérée et effacer les données du navigateur supprime les modifications non synchronisées. Pièces jointes et notes incorporées ne sont pas téléchargées avec la note. Le serveur garde son stockage existant ; cette collection locale chiffrée n’est pas une sauvegarde.

## Publier une collection de notes

Avec le plugin de partage activé, ouvrez les commandes de partage d’une note et choisissez la publication de plusieurs pages. Sélectionnez les notes, nommez le site et définissez éventuellement son expiration. Vérifiez l’aperçu public avant de publier. Navigation et recherche ne comprennent que les pages sélectionnées ; les pièces jointes, transclusions privées, HTML et requêtes enregistrées omis sont signalés. Les modifications des sources n’apparaissent qu’après prévisualisation et publication d’une mise à jour. Révoquez le site depuis le même gestionnaire pour empêcher les lectures futures ; les visiteurs peuvent avoir déjà enregistré des copies.
