# Préparer les médias et publier

Le centre multimédia conserve les ressources réutilisables. La publication sociale prépare et envoie le contenu aux réseaux configurés.

## Avant de commencer {#before-you-begin}

Activez Publication sociale et connectez le réseau cible avec le droit de publier. Utilisez un brouillon fictif pour apprendre.

## Étapes {#steps}

1. Ouvrez Médias, ajoutez une image que vous pouvez utiliser et vérifiez ses métadonnées. Ouvrez l’original pour contrôler qualité et disponibilité.

2. Ouvrez le compositeur social et sélectionnez réseau et compte. Écrivez un brouillon et joignez le média.

3. Vérifiez l’aperçu de chaque destination, notamment les limites de texte et de fichiers. Adaptez le contenu lorsque les exigences diffèrent.

4. Choisissez une publication immédiate ou une programmation explicite. Vérifiez destination, date et heure avant confirmation ; la préparation seule ne publie rien.

5. Après exécution, ouvrez l’historique et vérifiez le résultat de chaque réseau et son lien distant.

6. Si une destination échoue, examinez son résultat avant de réessayer. Excluez les destinations réussies pour éviter les doublons.

## Résultat attendu {#expected-result}

Le brouillon a une destination vérifiée et, après publication, un résultat contrôlable pour chaque réseau.

## En cas de problème {#troubleshooting}

Des identifiants expirés ou des limites du fournisseur peuvent bloquer la publication. Une miniature ne restaure pas l’original. Une programmation dépend aussi de la disponibilité de l’extension, du compte et du service.

## Guides associés {#related-guides}

- [Activer les extensions, connecter et automatiser](integrations-automations.md)
- [Questions fréquentes et récupération](troubleshooting.md)

## Publier un site web

Activez **Sites web**, ouvrez cette fonction depuis la barre latérale et créez ou sélectionnez un site. Choisissez les tables et pages sources, puis configurez la navigation et l’apparence. Téléversez un logo, une icône d’onglet ou une police avec les commandes d’apparence. Seules les ressources sélectionnées sont incluses dans le site publié ; téléverser un fichier ne le publie pas. Les polices système dépendent de l’appareil du visiteur.

La configuration s’enregistre automatiquement. Vérifiez l’état de l’enregistrement avant de réviser et de publier vers la destination choisie. La publication est une action explicite. Si l’enregistrement échoue, conservez le brouillon et réessayez avant de publier. Les identifiants des services privés et les brouillons de lettres d’information restent séparés du site public ; l’envoi d’une campagne nécessite sa propre révision et une action explicite.

### Révision, historique des versions et newsletters de test

Dans Contenus, choisissez une source avant de l’ajouter ; sélectionnez explicitement les champs publics, le corps et les pièces jointes. Utilisez Pages pour le contenu manuel et Navigation pour les menus.

La configuration est enregistrée automatiquement. Vérifiez l’état de sauvegarde et corrigez les erreurs avant de quitter. Examinez un instantané, ses changements et son aperçu pour ordinateur et mobile avant de publier la version révisée. Toute modification des sources ou de la configuration nécessite une nouvelle révision. Vérifiez le résultat de la tâche et l’historique des versions ; le retour arrière restaure une version du site, tandis que les messages, abonnés et campagnes restent séparés.

Dans Newsletters, choisissez la destination et la langue, puis ajoutez des contenus déjà publiés à un brouillon de synthèse ou de lecture mise en avant. La liste affiche d’abord les contenus les plus récents. Ordonnez jusqu’à vingt pages uniques, ajoutez une introduction et vérifiez le HTML, le texte brut et les destinataires avant de mettre explicitement un test en file d’attente. Les brouillons sont enregistrés automatiquement par site et destination ; toute modification de publication ou du brouillon nécessite une nouvelle révision. Les emails de test capturés sont consultables depuis la file d’envoi ; leur lecture n’active pas les liens de confirmation ou de désabonnement. Utilisez les commandes explicites de test de liens si nécessaire.

Le pilote actuel permet uniquement la publication dans l’espace de test protégé et la capture d’emails pour des destinataires synthétiques. La publication en production et l’envoi réel sont désactivés. Chaque destination nécessite aussi les dépendances de génération du site et du service privé ; vérifiez sa connexion avant de publier. Si le résultat d’une action est incertain, actualisez son état avant de réessayer.

### Importer un site et configurer sa connexion

Dans **Créer un site**, choisissez un site vide ou une importation par URL. Indiquez son adresse publique, analysez-la et vérifiez les pages, langues et avertissements avant d’importer la sélection. Les pages deviennent modifiables sans publication. Les services et formulaires d’origine du serveur ne sont pas migrés automatiquement.

Dans **Hébergement**, configurez le serveur, port, utilisateur, dossiers et authentification par agent SSH, clé de l’appareil ou mot de passe. Transférez les fichiers par SSH ou SFTP ; le mot de passe reste dans le gestionnaire d’identifiants de l’appareil. Testez la connexion : publier avec le service privé exige aussi des commandes SSH, PHP et SQLite. Une connexion SFTP seule peut être vérifiée sans remplir ces conditions de publication.

Dans **Formulaires de contact**, ajoutez, réordonnez ou supprimez les champs et modifiez les textes par langue, notamment le consentement, les erreurs et la confirmation. Laissez les textes facultatifs vides pour conserver les valeurs par défaut. Vérifiez le résultat avant publication.

L’aperçu des fiches évite de reconstruire plusieurs fois le même site. Chaque nouvel aperçu lit les notes actuelles et vérifie à nouveau la fiche après le rendu. Si elle change pendant la révision, relancez celle-ci. Préparer ou rouvrir un aperçu ne publie rien et ne modifie pas le contenu sélectionné.

Sur macOS et Linux, pour les pièces jointes téléchargées et inchangées, l’aperçu réutilise une copie locale vérifiée. Les notes sont relues. Si un fichier cloud ne peut pas être lu à temps, la révision s’arrête : téléchargez-le et réessayez. La confirmation vérifie à nouveau les originaux avant la publication.
