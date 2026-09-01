---
status: implemented
last_verified: 2026-08-28
source_paths:
  - backend/api/social_routes.py
  - backend/services/social_clients.py
  - backend/services/social_store.py
  - backend/domains/social
  - frontend/src/features/social
  - frontend/src/features/media
tests:
  - frontend/src/features/social/SocialDashboard.test.tsx
  - frontend/src/features/social/ContentCalendar.test.tsx
  - frontend/src/features/social/components/socialComponents.test.tsx
  - frontend/src/features/media/browser/MediaCenter.test.tsx
  - backend/tests/test_social_clients_contract.py
  - backend/tests/test_social_store.py
  - backend/tests/test_media_upload.py
  - backend/tests/test_connection_scheduler_alignment.py
---

# Publication sur les réseaux sociaux et médias

## Responsabilité

Ce domaine prépare, planifie, publie et suit les contenus sur les réseaux
sociaux configurés. Le centre de médias fournit des ressources visuelles et
des métadonnées réutilisables. La publication est toujours un effet externe.

Les anciennes instructions de publication Drupal propres au mainteneur ne font
pas partie de l'application publique. Retirer ce paquet du pipeline ne supprime
pas la publication sociale : les routes et adaptateurs indiqués ci-dessus
restent la voie prise en charge.

La fonctionnalité sociale gère son tableau de bord, son compositeur, son
calendrier de contenus planifiés, son historique et ses composants privés.
La fonctionnalité médias gère séparément la navigation des ressources, les
filtres, les vues enregistrées et les métadonnées. Toutes deux exposent des
entrées de routes différées ; importer l'entrée sociale n'évalue aucun des deux
écrans. L'icône de réseau reste partagée avec les paramètres. Les adaptateurs
HTTP et permissions de publication sont inchangés ; les consommateurs des
autres fonctionnalités n'importent jamais les fichiers d'implémentation privés.

## Adaptateurs réseau

Les clients isolent les particularités de Mastodon, Bluesky, Telegram et des
autres réseaux configurés : authentification, limites de texte, téléversement
des médias, identifiants de publications, fils, normalisation des réponses et
signalement des erreurs. Les entrées des réseaux référencent les identifiants
locaux ; les réponses ne renvoient jamais les secrets.

L'API expose les réseaux configurés, les flux, les actions de publication et les paramètres associés. Les onglets de l'interface sont indexés par des identifiants de réseau stables ; les noms affichés et les libellés utilisent des chaînes localisées.

Le JSON des fournisseurs est validé et normalisé à la frontière de
l'adaptateur. Les routes HTTP sont strictement typées tout en conservant le
contrat OpenAPI existant ; le JSON des messages stockés est décodé par des
helpers typés avant d'utiliser aperçus, URL ou publications planifiées.

L'historique des publications est stocké sous forme d'enregistrements Markdown
ordinaires dans la table stable `Publicacions Socials` du vault. Le service
préserve les noms de champs lisibles et fusionne les résultats par réseau avec
le texte original. Des ports typés du vault, résolus tardivement, isolent les
opérations de registre, de pages et de frontmatter. Les imports circulaires de
compatibilité restent ainsi remplaçables sans propager de types dynamiques
dans le domaine social.

## Flux de publication

```mermaid
flowchart LR
    Source["Page du vault ou contenu rédigé"] --> Prepare["Préparation adaptée au réseau"]
    Media["Ressource média sélectionnée"] --> Prepare
    Prepare --> Validate["Validation des limites, identifiants et cibles"]
    Validate --> Confirm["Publication explicite ou planification approuvée"]
    Confirm --> Adapter["Client réseau"]
    Adapter --> Result["Id, URL, état et diagnostics à distance"]
```

La préparation peut traduire ou reformater le contenu, mais ne publie pas à elle seule. La publication immédiate exige une action explicite de l'utilisateur ; la publication planifiée exige une planification enregistrée dont la politique d'exécution autorise la même cible.

## Traitement des médias

Les téléversements valident le type de fichier, la taille, les racines autorisées et les noms générés. Les vues de médias indexent les ressources sans considérer les caches ou miniatures comme des originaux. Une miniature absente peut être régénérée ; une ressource source perdue ne le peut pas.

## Invariants

- Les identifiants secrets d'un réseau ne sont résolus que dans le backend au moment de l'exécution.
- L'aperçu/la préparation et la publication sont des états distincts.
- Les limites de texte et de médias sont validées pour chaque cible avant l'appel externe.
- Un échec partiel sur plusieurs réseaux signale chaque résultat sans annoncer une réussite globale.
- Les publications planifiées et interactives utilisent le même contrat d'adaptateur.
- Les identifiants et URL des publications distantes sont stockés pour l'audit et les actions de suivi.

## Aspects de vérification

Testez le confinement des téléversements, l'alignement des planifications et
connexions, la normalisation des réponses des réseaux, les limites de nouvelles
tentatives, les échecs partiels multicibles et une publication en environnement
de test ou simulée. Une publication réelle ne doit jamais être un effet de bord
fortuit d'un test unitaire.
