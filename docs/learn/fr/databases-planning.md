# Organiser les fiches et planifier le travail

Une base de données regroupe des tables. Une table définit les propriétés de fiches qui sont des pages ; ses vues présentent les mêmes fiches de différentes façons.


Les champs Date partagent un éditeur avec une modalité ponctuelle ou période et des heures facultatives indépendantes. Une période peut couvrir plusieurs jours avec des heures de début et de fin ; la fin peut rester à définir. La durée naturelle compte les jours calendaires inclusifs sans heures, et les heures écoulées avec heures. Changer de modalité conserve l’intervalle et les heures enregistrées ; les options de planification restent disponibles. Le début, la fin, la durée, la récurrence et l’aide des règles de planification suivent la langue sélectionnée de l’interface.

Dans une vue intégrée à une page, un filtre comme **Conteneur = Cette page** renseigne automatiquement ce champ avec la page contenant la vue lors de l’ajout d’un document. Cela fonctionne avec toute table, y compris les modèles et les sous-éléments. Les nouveaux documents restent ainsi dans la vue lorsque cette relation avec la page était la valeur manquante.

## Avant de commencer {#before-you-begin}

Un Vault accessible en écriture. Les vues générales font partie des connaissances ; la planification avancée nécessite l’extension Planification.

## Étapes {#steps}

1. Dans Connaissances, choisissez **Créer une BD** ou **Ajouter une base de données** et nommez-la « Projet de lecture ». Créez-y la table « Sources » : le groupe seul ne crée pas de table.

2. Ajoutez des propriétés comme un statut et une date. Choisissez des statuts cohérents, par exemple « À lire », « En cours » et « Lu ».

3. Créez deux fiches et renseignez leurs propriétés. Dépliez **Contenu** sous la table pour ouvrir les pages et **Vues** pour retrouver les vues enregistrées.

4. Créez une vue filtrée des sources à lire. Utilisez un tableau de cartes ou un calendrier lorsque les champs de statut ou de date conviennent, puis vérifiez les fiches retenues.

5. Pour programmer des tâches, activez Planification et configurez semaine de travail et jours fériés. Testez début, durée et dépendances sur un petit exemple avant un projet réel.

6. Consultez l’aide à côté de la contrainte de date pour comprendre la règle. Comparez la fin calculée aux jours ouvrés attendus.

Pour lire les notes à la suite, ouvrez les paramètres de la galerie et choisissez **Taille des cartes → Pleine largeur** et **Aperçu → Contenu**. Les cartes occupent toute la largeur de la vue, se placent les unes sous les autres et grandissent selon le texte. Dans une galerie groupée, **Espace** développe le groupe ciblé et entre dans sa première note ; **Échap** depuis une note revient à l’en-tête du groupe et le replie. Un second **Échap** revient à la vue. Le clic sur l’en-tête continue de développer et de replier le groupe.

Dans la **chronologie**, choisissez **Jour**, **Semaine**, **Mois**, **Année**, **Aujourd’hui** ou **Afficher tout le projet**. Redimensionnez la colonne des titres et réduisez les phases. Avec une période ou des champs de début et de fin modifiables, faites glisser une barre pour déplacer la tâche et ses extrémités pour l’allonger ou la raccourcir. Faites glisser le point de connexion à la fin d’une tâche sur la barre de la tâche suivante pour ajouter une dépendance de fin à début. Les modifications sont enregistrées dans les données partagées avec le tableau ; les tâches suivantes concernées sont recalculées même si les filtres les masquent. Les cycles sont refusés. **Annuler la modification du calendrier** restaure la dernière opération pendant la session de la vue. **Échap** annule un déplacement. Lorsqu’une barre a le focus, les flèches la déplacent et **Maj + flèche** ajuste la fin. Les tâches sans dates affichent **Définir les dates** ; les jalons sont des losanges.

Pour supprimer une dépendance, cliquez sur la ligne reliant les tâches et confirmez **Supprimer la dépendance**. Les dates sont conservées et vous pouvez annuler la modification.

## Résultat attendu {#expected-result}

Vous savez consulter les fiches sous différentes vues et expliquer la date calculée d’une tâche.

## En cas de problème {#troubleshooting}

Une vue vide peut simplement avoir un filtre restrictif. Vérifiez dates, statuts et dépendances avant de recréer des fiches. Gnosi gère les dates de création et modification ; ce ne sont pas des dates de planification modifiables.

## Guides associés {#related-guides}

- [Créer des pages, des liens et des pièces jointes](pages-files.md)
- [Activer les extensions, connecter et automatiser](integrations-automations.md)

## Formulaires publics de table

Activez **Partage externe**, ouvrez une table et choisissez **Formulaires publics**. Publiez un formulaire avec titre, description, questions choisies, aide, champs obligatoires et expiration. Les questions acceptent texte, nombres, dates, courriel, URL, téléphone, cases à cocher et choix de la table. Les formules, relations et champs internes ne sont pas exposés.

Partagez le lien depuis un serveur Gnosi accessible aux destinataires. Ils peuvent répondre sans compte et ne peuvent pas consulter les enregistrements existants. Chaque réponse acceptée crée une page dans la table fixée par le processus habituel. Réessayer un envoi interrompu conserve son identité et ne duplique pas l'enregistrement. Révoquez le lien pour arrêter les nouvelles réponses. Retirer le droit d'écriture du propriétaire ou changer le schéma d'un champ exposé arrête également le formulaire.

Les liens expirent toujours : choisissez 7, 30, 90 ou 365 jours lors de la publication. Publiez un nouveau formulaire pour obtenir un autre lien après expiration.
