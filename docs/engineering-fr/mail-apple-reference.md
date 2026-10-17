---
status: partial
last_verified: 2026-10-17
source_paths:
  - backend/domains/mail
  - frontend/src/features/mail
  - backend/services/microsoft_mail_service.py
tests:
  - backend/tests/test_mail_move_identity.py
  - backend/tests/test_mail_cache_scope.py
  - backend/tests/test_mail_archive_listing.py
  - backend/tests/test_mail_archive_identity.py
  - backend/tests/test_mail_connection_lifecycle.py
  - backend/tests/test_mail_conversation_truthfulness.py
  - backend/tests/test_mail_ordered_header_listing.py
  - backend/tests/test_mail_detail_responsiveness.py
  - backend/tests/test_mail_read_negative_contract.py
  - frontend/src/features/mail/components/MailViewer.loading.test.tsx
  - tests/e2e/tests/disposable/mail-archive-pagination.spec.ts
  - tests/e2e/tests/disposable/mail-reader-responsiveness.spec.ts
---

# Référence Apple Mail et couverture de Gnosi

Cette investigation utilise l'installation d'Apple Mail 16.0, version de compilation
3901.100.1.1.12, comme référence de comportement pour améliorer le module de
courrier de Gnosi. Le SHA-256 de l'exécutable est
`9e1d4526c45462d3facdfe47e133c42d97ead0fd97229dfc6ef5a0eab2e44aec`.
Le code d'implémentation et les ressources d'Apple ne sont pas incorporés à Gnosi.

## Éléments probants et limites

REA a décodé les 107 documents d'interface compilés avec une union exacte des
chemins et empreintes : 2 057 contrôles avec libellé ou action, 595 connexions
d'action définies, 359 sélecteurs distincts et 112 déclarations de raccourcis.
Soixante-dix tables de localisation en anglais et la définition de scripting
apportent des déclarations supplémentaires. Ce sont des observations statiques
des interfaces distribuées, pas des mesures d'exécution ou de performance.

L'enregistrement de l'interface du paquet d'origine est
`ev_2d60c93b3784f4bfb6d28a5cc15692cd0fb15675c27a1cfc6668e48f34bd6941`.
La limite de 64 documents du décodeur a nécessité un second passage sur
43 ressources identiques octet par octet dans un conteneur d'analyse distinct
et non exécutable, enregistré sous
`ev_fd593629b7968addfc22971fb12419e41ea7d64c12a65cff3ecea039ee8b0a05`.
Les deux passages ne présentent aucun chemin de document d'origine commun ou
manquant. Le conteneur temporaire a été supprimé après l'export des éléments
probants.

`PreferencesWindow.loctable` déclare une correspondance dédiée pour la boîte
d'archive, et les préférences compilées raccordent son sélecteur.
`ViewerPreferences.loctable` déclare les messages associés, l'ordre du plus
récent au plus ancien et le comportement de lecture. `Mail.sdef` déclare la
mise en cache de tous les messages IMAP, avec ou sans pièces jointes. Ces
seules déclarations n'établissent pas le comportement à l'exécution. Les
observations du code natif ci-dessous fournissent une référence plus précise,
qui reste statique. Les services privés des fournisseurs et le comportement
des frameworks système nécessitent des éléments probants distincts. La
couverture de l'interface ne signifie pas une reproduction fonctionnelle
complète ou une compatibilité.

## Chargement des conversations dans le code natif

REA/Ghidra a inspecté l'exécutable distribué sans lancer Mail ni lire de
messages personnels. L'export complet des éléments probants natifs contient
17 enregistrements ; son SHA-256 est
`129707b63e9075725b31b680fb955e2ebbc60ea8a7c0c2ee9442932ca07ff412`.
Les adresses canoniques et les identifiants d'éléments probants désignent les
procédures observées :

| Procédure | Observation statique | Élément probant REA |
| --- | --- | --- |
| `ConversationPrefetcher::initWithMessageListContentController:messagesTableView:` (`0x10008214c`) | Crée un `NSCache` nommé `ConversationPre-FetchCache` avec une limite de 50 entrées et observe le défilement. | `ev_fa7824691df165d433ae2ae6f0a8122afb53b8f7fd241172423490e3715cab0b` |
| `_prefetchVisibleConversations:` (`0x100082520`) | Résout les lignes visibles du tableau, utilise les identifiants de conversation comme clés du cache et lance le chargement asynchrone des membres des conversations absentes. | `ev_2cc61803626bfcdcef5c971285210d249c1017f7d628b444ef26cdd9e268f011` |
| `_armTimerWithDelay:` (`0x1000823a8`) | Réinitialise un temporisateur en attente ; le délai configuré est de 0,5 seconde et la tolérance vaut la moitié du délai. | `ev_70f9eed5ec18bb84493c275d867d41892580cf18d0baa9dffb452e9fc5d48de7` |
| Bloc de fin du préchargement (`0x1000828f8`) | Vérifie que l'entrée du cache existe encore et prépare au plus sept membres ordonnés autour de la position de lecture initiale. | `ev_8f1d539fba64e142c477c3d076f362edef762d0484d118dbeaeb04ec15116773` |
| Bloc de préparation des membres (`0x1000829d0`) | Appelle `asyncLoadAllowingRemoteFetch:reloadBanners:completionHandler:` avec les arguments `false, true, nil`. | `ev_f24b1a6a24c5954202253a8128275fe78b4c58ad551bb642c4a7f461bdb7dbfd` |
| Bloc d'éviction du cache (`0x100082ad4`) | S'exécute sur le thread principal et appelle `cancelLoad` pour les membres de la conversation. | `ev_a40b73b4d199efd1d2fcef64f7149bb5b6a1c4e1ebf7866712f832ba26e378fe` |
| `Conversation::asyncLoadConversationMembers` (`0x100077afc`) | Réutilise les membres chargés, suit les callbacks de fin et les messages initiaux, et programme un délai d'expiration de récupération rapide de 0,25 seconde. | `ev_26327235dd05d4b42ab1697e8632e1bc9b26a71d35ce36c90857b5522506a57a` |
| `Conversation::_quickFetchTimeout` (`0x100077fbc`) | Publie les messages initiaux disponibles et invoque les callbacks en attente. | `ev_b89bc7b39845cf75858696637d657cd325dd9e8d08f1de0103ac8784e47e545c` |
| `ConversationMember::cancelLoad` (`0x10007c8c8`) | Annule le générateur de documents et efface l'état de chargement. | `ev_73a8b31cd6c3cbb7ba0b6b9e78e715eee9630c23af9bb03d7964716191b09ccd` |

Ces observations étayent la préparation asynchrone, la réutilisation bornée, la
disponibilité partielle des conversations et l'annulation comme références de
conception. Elles ne mesurent pas la latence réelle. En particulier, l'appel de
préchargement observé désactive `allowingRemoteFetch` ; affirmer qu'il télécharge
par anticipation les corps distants des messages dépasserait les éléments
probants. L'implémentation MailUI appelée, le stockage durable des messages,
l'ordonnancement des connexions aux fournisseurs et la sémantique hors ligne
complète n'ont pas été retracés. La connexion IMAP séparée pour les corps et le
cache du lecteur de 16 entrées/4 MiB/cinq minutes de Gnosi sont des choix
d'implémentation indépendants, pas des valeurs retrouvées chez Apple.

## Couverture fonctionnelle

« Existant » décrit le code source de Gnosi inspecté, pas une équivalence avec
toutes les opérations d'Apple. « Partiel » désigne une lacune concrète du produit
restant à combler. Réussir les régressions de l'archive ou du lecteur ne vaut
pas acceptation du travail prévu.

| Domaine d'Apple Mail | Implémentation de Gnosi et travail restant |
| --- | --- |
| Boîtes, favoris, ouverture rapide et onglets | Navigation unifiée et par compte existante ; la découverte des dossiers personnalisés est préservée. L'arborescence complète des dossiers de chaque compte, les favoris et l'ouverture rapide des boîtes restent partiels. |
| Archivage, déplacement, copie et suppression | Les listes Archive/Tous les messages et la gestion des libellés d'archive ont été corrigées ; des actions de déplacement et de mise à la corbeille existent. La copie et le cycle de vie complet des boîtes personnalisées restent partiels. |
| Conversations et messages associés | Conversations Gmail dépliables existantes ; la réutilisation des corps et l'annulation ont été corrigées. La reconstruction IMAP générique à partir de References/In-Reply-To reste partielle. |
| Lecteur, en-têtes, source et apparence | Lecteur existant de HTML assaini et de texte, aperçu et thèmes. Les outils complets de source brute et d'en-têtes ainsi que l'apparence par message restent partiels. |
| État de lecture, drapeaux et priorité | Actions de lecture et d'étoile existantes ; les opérations en arrière-plan laissent la boucle d'événements disponible. Les drapeaux colorés, les priorités complètes et les contrôles d'état de tous les messages restent partiels. |
| Recherche, tri et filtres | La recherche textuelle complète chez le fournisseur et la pagination ont été corrigées ; une interface de tri et de filtrage existe. La composition avancée de requêtes serveur et l'ensemble des métadonnées des pièces jointes restent partiels. |
| Boîtes intelligentes et recherches enregistrées | Vues enregistrées persistantes existantes avec filtres AND/OR. Les critères s'appliquent encore aux lignes chargées et ne constituent pas un moteur complet de requêtes serveur. |
| Catégories et boîte de réception prioritaire | Catégories existantes. La catégorisation persistante des expéditeurs et les priorités sensibles au temps restent partielles. |
| Compositeur, destinataires, alias et groupes | Éditeur, À/Cc/Cci, identités, autocomplétion et alias existants. Les contrôles complets des groupes et des en-têtes d'adresses restent partiels. |
| Brouillons, livraison, envoi programmé et annulation | Brouillons et livraison immédiate existants. Une boîte d'envoi hors ligne durable, la programmation et l'annulation d'envoi restent à implémenter. |
| Réponses, transfert et redirection | Réponse, réponse à tous et transfert existants avec préservation des images CID citées. La redirection et le transfert comme message joint restent partiels. |
| Pièces jointes et aperçus | Téléchargements, aperçu PDF, CID et images distantes restreintes existants. Les actions complètes sur les pièces jointes, le redimensionnement des images et un équivalent de Mail Drop restent partiels. |
| Texte enrichi, polices et orthographe | Éditeur de texte enrichi existant. L'ensemble des conversions entre texte brut et enrichi par message et des contrôles d'orthographe et de typographie reste partiel. |
| Signatures | Signatures d'identité existantes. La parité de gestion des signatures reste à vérifier. |
| Synchronisation, reconstruction et quota des boîtes | Synchronisation IMAP/IDLE et actualisation explicite existantes. La réconciliation et la reconstruction complètes, le quota et l'interface de maintenance des comptes restent partiels. |
| Import, export et impression | Des copies locales Markdown/HTML existent. L'import et l'export des boîtes, les échanges EML/mbox, l'impression du courrier et l'export PDF restent partiels. |
| Règles de courrier entrant et actions | Les vues enregistrées configurent les contrôles d'affichage. Un évaluateur persistant de règles de courrier entrant et les actions des règles restent à implémenter. |
| Comptes, SMTP, TLS et authentification | Google IMAP OAuth, IMAP/SMTP manuel et Microsoft Graph existants. POP et l'ensemble des comportements de compte propres à Exchange ne sont pas reproduits. |
| Stockage hors ligne et diagnostics | Copies locales et caches bornés de listes et de corps existants. Une boîte hors ligne durable complète et des diagnostics de type Connection Doctor restent partiels. |
| Confidentialité du contenu distant | Bac à sable, restrictions d'URL/IP/type/taille/délai et récupération explicite des images existants. Il ne s'agit pas d'un relais de confidentialité anonymisant. |
| Signature et chiffrement | La protection TLS et des identifiants existe. La signature et le chiffrement S/MIME ainsi que le cycle de vie des certificats ne sont pas reproduits. |
| Indésirables, blocage, silence et désabonnement | Actions de courrier indésirable existantes. Les parcours persistants de blocage, de mise en silence et de désabonnement restent partiels. |
| Rappels, suivi et notifications | Report et extraction vers le calendrier et les contacts de Gnosi existants. Le suivi complet et les contrôles de notifications et de concentration propres au courrier restent partiels. |
| Extensions et intégration au système | Intégrations et outils d'agent Gnosi existants. Les extensions Apple MailKit et les contrats des services natifs ne sont pas reproduits. |
| Réponse intelligente, aperçus de liens et adresses privées | Assistance IA facultative existante pour les brouillons et l'analyse. Les comportements d'adresses privées et d'aperçus de liens assurés par les fournisseurs restent partiels. |
| Programmation d'absence | Pas encore reproduite dans le module de courrier inspecté. |
| Accessibilité et scripting | Infrastructure partagée de clavier et d'accessibilité et API d'agent existantes. L'ensemble des raccourcis de Mail, des objets de scripting et des comportements des services macOS reste partiel. |

## Limites de reproduction et de validation

Le défaut d'archive a été reproduit sans identifiants : un faux serveur IMAP
contenant des messages de la Boîte de réception et archivés ne renvoyait que
ceux de la Boîte de réception avec `folder=all`. Un scénario distinct a reproduit
le classement de notes locales archivées comme supprimées. Les scénarios du
lecteur ont reproduit une requête de corps en double pour une copie de Tous les
messages de Gmail et le redémarrage des requêtes après un remplacement sans
conséquence du résumé ou du callback.

La couverture de régression vérifie les connexions indépendantes des corps, la
disponibilité de la boucle d'événements, les délais de lecture et erreurs
fournisseur récupérables, la pagination complète de plusieurs dossiers, la
découverte de boîtes entre guillemets ou littérales, l'échappement de la
recherche et UTF-8, les métadonnées d'archive propres au compte, les identifiants
RFC d'origine, la préservation des libellés, l'identité des corps, les résultats
obsolètes et les nouvelles tentatives.
Des scénarios de régression supplémentaires couvrent l'invalidation des
identifiants pendant la connexion, le traitement séparé des erreurs de
transport, tous les dossiers d'archive, le tri par date des messages importés,
les lectures incomplètes d'en-têtes natifs et la réutilisation et la
réinitialisation du cache de lots avec 2 001 messages. Un scénario distinct de
panne de conversation vérifie HTTP 503 pour les erreurs de transport ou de
membres partiels et la lecture locale d'identifiants RFC enregistrés sans
commandes UID distantes. Une liste agrégée à froid nécessite encore tous les
petits en-têtes correspondants avant le tri global ; il ne s'agit pas d'un
index de métadonnées hors ligne durable complet.
Les tests de navigateur jetables exercent la pagination de Tous les messages
avec 121 messages et d'Archive avec 61 messages, avec une géométrie réelle de
défilement et une recherche dans les corps côté fournisseur. Ces résultats
valident ces scénarios, pas les autres domaines fonctionnels du tableau.
Une régression supplémentaire à deux comptes reproduit le blocage de la
pagination du compte sain par un compte indisponible et la perte des pages
chargées du compte sain lors d'une nouvelle tentative explicite. Une pagination et des
nouvelles tentatives isolées par compte sont nécessaires pour la boîte unifiée.

## Séquence d'intégration

La référence décrit un programme produit conséquent. Gardez l'acceptation de
chaque groupe fonctionnel séparée afin que les régressions du lecteur ne
puissent pas tenir lieu de compatibilité complète avec Mail :

1. Établir des lectures réactives, des reprises reflétant l'état réel,
   Archive/Tous les messages complets et la recherche chez le fournisseur.
   Le candidat actuel traite cette base.
2. Ajouter l'arborescence des boîtes de chaque compte et leur cycle de vie, la
   reconstruction générique des conversations IMAP, les outils de message brut
   et la réconciliation hors ligne durable. Vérifier l'identité entre comptes
   et entre dossiers avec des scénarios de serveur synthétiques.
3. Ajouter des files de livraison durables, l'envoi programmé et son annulation,
   les règles de courrier entrant et les recherches enregistrées avancées.
   Vérifier la récupération après redémarrage et le comportement des
   fournisseurs en échec avant d'exposer ces contrôles.
4. Achever les groupes de compatibilité individuellement, notamment l'import,
   l'export et l'impression, des drapeaux plus riches, les contrôles des
   expéditeurs, les protocoles des comptes, le chiffrement et l'intégration au
   système, avec une acceptation dédiée à chaque fournisseur et plateforme
   pris en charge.

Modifier l'application installée nécessite en outre un code source réconcilié
contenant tous les commits enregistrés dans le manifeste de ses composants,
les nouveaux travaux sur le courrier et les autres changements concurrents
acceptés. Réussir une vérification dans le worktree du code source ne suffit
pas à établir l'acceptation de la version installée ou publiée.
