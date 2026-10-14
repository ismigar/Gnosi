# Utiliser courrier, calendrier et contacts

Connectez les comptes nécessaires et identifiez la source propriétaire de chaque message, événement ou contact.

## Avant de commencer {#before-you-begin}

Activez Courrier, Calendrier et Contacts selon vos besoins. Les comptes externes nécessitent des identifiants ou une autorisation ; événements et contacts locaux ne nécessitent pas de cloud.

## Étapes {#steps}

1. Dans les intégrations, ajoutez le compte et testez la connexion. Le courrier utilise IMAP/SMTP ; les calendriers Google Calendar ou CalDAV ; les contacts Google ou CardDAV, en plus des entrées locales.

2. Ouvrez Courrier et choisissez compte et dossier. Lisez un message et préparez un brouillon ; vérifiez destinataires et pièces jointes avant l’envoi.

3. Ouvrez Calendrier et sélectionnez les sources visibles. Créez un événement dans le calendrier local ou externe prévu et vérifiez fuseau horaire, début, fin et récurrence.

4. Ouvrez Contacts et créez un contact local fictif ou synchronisez une source autorisée. Vérifiez l’origine avant de modifier les données du fournisseur.

5. Utilisez une suggestion de contact dans un brouillon ou un champ de participants et vérifiez l’adresse : des noms similaires peuvent désigner des personnes différentes.

6. Pour enregistrer des réunions, activez la fonction correspondante et accordez les permissions du dispositif. Transcription et notes générées nécessitent leurs services configurés.

## Résultat attendu {#expected-result}

Vous retrouvez le courrier d’un compte, un événement dans le calendrier prévu et un contact d’origine connue.

## En cas de problème {#troubleshooting}

Si des données manquent, vérifiez autorisation et filtres. Masquer un événement ne le supprime pas chez le fournisseur. Évitez de reconnecter les comptes ou de renvoyer un message tant que l’opération précédente reste incertaine.

## Guides associés {#related-guides}

- [Activer les extensions, connecter et automatiser](integrations-automations.md)
- [Questions fréquentes et récupération](troubleshooting.md)

## Écriture CalDAV et visioconférences

Les calendriers CalDAV modifiables, dont iCloud, permettent de créer, modifier et supprimer des événements individuels. Les modifications conservent l'UID, les fuseaux horaires, les dates de journée entière et les propriétés iCalendar non modifiées. L'ETag du fournisseur évite d'écraser une modification simultanée ; actualisez l'événement en cas de conflit. Les séries récurrentes CalDAV restent en lecture seule dans Gnosi.

Si le fournisseur transmet un lien vidéo, ouvrez le rendez-vous et choisissez **Rejoindre la visioconférence**. Le lien s'ouvre dans le navigateur.

## Disponibilité et réservations publiques

Ouvrez **Disponibilité** dans le panneau latéral du calendrier. Sélectionnez tous les calendriers qui doivent bloquer les réservations, y compris les événements locaux et les calendriers de plusieurs comptes. Configurez le fuseau horaire, les jours et heures ouvrés, la durée, la marge, le préavis et l'horizon. Consultez les créneaux, choisissez un calendrier de destination parmi ceux sélectionnés et créez un lien. Vous pouvez copier et révoquer les liens publiés.

Les visiteurs choisissent un créneau et saisissent leur nom et leur courriel. Gnosi vérifie à nouveau la disponibilité avant de créer le rendez-vous. Si un calendrier ne peut pas être consulté, les réservations sont suspendues. Si le résultat d'une écriture est incertain, le créneau reste bloqué et la réservation est en attente ; vérifiez le calendrier de destination avant d'en créer une autre. Les comptes externes sont réservés au propriétaire de l'espace personnel pour les réservations publiques.

Les destinataires doivent pouvoir accéder au serveur web de Gnosi. Une adresse localhost ou de bureau fonctionne seulement sur cet appareil ; créer un lien ne publie ni n'expose l'installation.
