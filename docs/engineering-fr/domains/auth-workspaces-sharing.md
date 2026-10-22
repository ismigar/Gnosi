---
status: implemented
last_verified: 2026-10-13
source_paths:
  - backend/domains/vault/publishing
  - frontend/src/features/sharing/publishing
  - frontend/src/features/offline
  - frontend/src/shared/offline
  - backend/api/auth_routes.py
  - backend/api/workspace_routes.py
  - backend/api/vaults_routes.py
  - backend/api/vault_templates_routes.py
  - backend/api/share_routes.py
  - backend/api/public_routes.py
  - backend/models/management.py
  - backend/services/auth_service.py
  - backend/services/auth_public_surface.py
  - backend/services/workspace_service.py
  - backend/services/vault_routing.py
  - backend/services/active_vault_middleware.py
  - frontend/src/shared/auth/auth-context.ts
  - frontend/src/features/auth
  - frontend/src/features/sharing
  - frontend/src/features/auth/context/AuthProvider.tsx
  - frontend/src/shared/routing
  - frontend/src/features/workspaces
tests:
  - backend/tests/test_web_publishing.py
  - frontend/src/features/sharing/publishing/WebPublishingManager.test.tsx
  - frontend/src/shared/api/web-publishing.test.ts
  - backend/tests/test_auth_expected_account.py
  - frontend/src/features/auth/LoginPage.test.tsx
  - frontend/src/features/auth/public-entry.test.ts
  - backend/tests/test_auth_central_gate.py
  - backend/tests/test_auth_enforcement_flag.py
  - backend/tests/test_pat_authentication.py
  - backend/tests/test_workspace_bootstrap_race.py
  - backend/tests/test_workspace_invite_email_case.py
  - backend/tests/test_vault_canonical_routing.py
  - backend/tests/test_vault_recovery_identity.py
  - backend/tests/test_vault_templates.py
  - backend/tests/test_inline_comments_permissions.py
  - backend/tests/test_auth_public_surface.py
  - backend/tests/test_auth_account_settings.py
  - backend/tests/test_auth_email_case.py
  - backend/tests/test_auth_placeholder_account.py
  - backend/tests/test_password_hashing.py
---

# Authentification, espaces de travail et partage

## Notes hors connexion et sites publiés

Le compagnon de notes hors connexion s’ouvre dans Paramètres → Général et utilise la même origine serveur. Dans une compilation de production, son service worker ne met en cache que l’interface publique compilée. L’utilisateur choisit explicitement les notes textuelles et protège la collection locale avec une phrase secrète distincte. Les sauvegardes locales chiffrent la collection dans IndexedDB ; le verrouillage efface le texte déchiffré détenu par l’application. La synchronisation vérifie compte, espace de travail, Vault et version de page, puis présente les deux versions en cas de conflit. Le serveur conserve toujours des notes ordinaires lisibles. Pièces jointes, dessins et bases de données sont hors de cette collection.

La publication de plusieurs pages utilise le plugin de partage et le backend du serveur personnel. Un éditeur sélectionne les notes et vérifie l’instantané public exact avant de publier. Le visiteur ne reçoit que cet instantané ; navigation et recherche se limitent aux pages sélectionnées. Pièces jointes, HTML, transclusions privées et requêtes enregistrées sont visiblement omis. Une mise à jour exige un nouvel aperçu ; révisions, expiration et révocation sont stockées dans la base de gestion. Les lectures anonymes utilisent une route de jeton étroitement définie, omettent les identifiants et ne démarrent pas l’application privée. Publier ne déploie pas un autre service et ne répercute pas automatiquement les modifications des notes originales.

## Modes de fonctionnement

Le mode `personal` est l'expérience locale par défaut pour un seul utilisateur. L'authentification est contournée sauf si la politique effective l'exige. Le mode `org` exige une identité et une appartenance à un espace de travail. Les déploiements exposés peuvent imposer l'authentification quel que soit le libellé convivial du mode.

Le contrôle du frontend sélectionne l'écran de connexion ou l'application, mais toutes les autorisations sont appliquées dans les dépendances et services du backend.

Le shell importe le formulaire de connexion via l'entrée publique de
`features/auth`. La validation de connexion et d'inscription, les sessions
et la politique du backend conservent leur comportement. Les paramètres du
compte et du workspace restent distincts de ce formulaire ; déplacer l'entrée
n'autorise pas l'accès à un espace de travail.

La fonctionnalité de partage expose sa page en lecture seule via une entrée
publique à chargement différé. La route `/s/:token` reste hors du contrôle
d'authentification et du shell. Son déplacement n'élargit pas les accès : le
backend résout toujours le jeton et les liens expirés ou invalides conservent
leur affichage d'erreur.

La résolution du workspace valide les racines configurées du projet et des
vaults avant tout amorçage ou choix de chemin. L'amorçage personnel résiste aux
accès concurrents et confirme l'appartenance retenue après un conflit d'unicité.
Le mode organisation précise les types des rôles et capacités JSON avant de
construire le contexte. Les montages absents n'entraînent un repli que si la
compatibilité du mode personnel l'autorise explicitement, sans jamais inventer
un vault d'organisation.

## Authentification de session et de jetons

La connexion par adresse e-mail et mot de passe vérifie le hachage du mot de passe et émet un JWT signé dans un cookie HttpOnly, SameSite=Lax. Les clients API acceptés peuvent également envoyer un jeton bearer dans `Authorization`. Les Personal Access Tokens utilisent un format opaque distinct ; seuls un hachage SHA-256 et un préfixe d'affichage sont stockés.

Les clients conservant des modifications entre sessions peuvent envoyer `X-Gnosi-Expected-User-ID`. Le contrôle central compare cette précondition à l’identité authentifiée par cookie/PAT avant de servir les routes protégées : une identité absente renvoie 401, et un changement de compte renvoie 409 avec `code: account_changed`. Cet en-tête ne sélectionne jamais un utilisateur et n’accorde aucune autorisation, même dans les installations locales à authentification facultative. Les rôles de l’espace de travail/Vault restent vérifiés. Les exceptions publiques de connexion, déconnexion et santé gardent leur comportement existant.

Le secret de signature doit être robuste sur les déploiements exposés. Le backend refuse de démarrer avec la valeur publique de développement lorsque la protection est requise par le déploiement effectif.

La frontière des routes d'authentification est strictement typée et conserve les
schémas de réponse gelés. Les modèles de gestion partagent une
`DeclarativeBase` SQLAlchemy typée ; les types des descripteurs de colonnes ne
sont précisés qu'à la frontière ORM. La revendication de compte, la rotation
du mot de passe, la mise à jour du profil et les cookies conservent validation
et transactions. Les objets Pydantic de permissions préservent leurs valeurs
par défaut historiques et leur représentation OpenAPI exacte.

Le service d'authentification type les sessions de gestion, les générateurs
du cache de politique, l'identité HTTP/WebSocket, la recherche de PAT et le
décodage du sujet JWT à leurs frontières. Les stubs `python-jose` sont verrouillés
dans le groupe de dépendances de développement ; la mutation historique restante
des horodatages ORM est isolée avec `setattr` jusqu'au passage complet des
déclarations de colonnes à `Mapped[]`.

Le WebSocket de collaboration importe le même service d'identité typé que HTTP.
La politique d'authentification, et non la disponibilité de modules facultatifs,
décide si un identifiant est requis : le mode personnel reste simple, tandis
que le mode organisation et les clients PAT partagent un résolveur. Une fermeture
avant acceptation signale toujours une violation de politique, et les clés des
salons conservent leur espace de noms par vault.

## Modèle d'autorisation

```mermaid
flowchart LR
    Identity["Identité de session ou de PAT"] --> Member["Appartenance au workspace"]
    Member --> Role["viewer < editor < admin < owner"]
    Member --> Access["Accès au vault"]
    Role --> Decision["Décision de capacité de la route"]
    Access --> Decision
    Decision --> Context["Workspace lié et vault actif"]
```

Les rôles fournissent des capacités de base hiérarchisées. VaultAccess restreint ou accorde l'accès à un vault enregistré. Un identifiant de workspace, d'utilisateur ou de vault fourni par la requête n'est jamais considéré comme fiable sans résolution de l'identité authentifiée et de ses appartenances.

L'amorçage des workspaces résiste aux accès concurrents : des premières requêtes simultanées ne créent pas de doublons d'espaces, d'utilisateurs ou d'appartenances par défaut. Les comptes provisoires et provisionnés automatiquement sont explicitement marqués ; l'inscription ne peut pas les revendiquer sur la seule base d'une adresse e-mail, preuve d'identité insuffisante.

La résolution du contexte d'espace de travail conserve la dépendance FastAPI
publique, tandis que des fonctions distinctes gèrent l'appartenance, le filtrage
des vaults accessibles, le chemin de stockage et les capacités. Les décisions
d'autorisation restent ainsi explicites sans modifier les en-têtes, les codes
d'état ni le comportement du vault actif.

L'identité du vault, son slug, son éventuel chemin historique et sa date de
création utilisent des mappings SQLAlchemy typés, sans changer les colonnes ni
les migrations. Le middleware canonique résout un identifiant ou slug en chaîne
concrète avant de publier le contexte. L'export de modèles revalide le chemin
historique nullable à la frontière du système de fichiers et renvoie la réponse
habituelle de ressource introuvable au lieu de construire un `Path` à partir
d'une configuration absente.

L'API d'administration du workspace convertit les rôles historiques et
descripteurs de permissions JSON en valeurs concrètes à la frontière ORM.
Les mutations des rôles et accès aux vaults utilisent des affectations locales
compatibles avec les descripteurs, en conservant les contrôles d'appartenance,
la normalisation des invitations et les schémas de payloads existants.

## Partage public

Un lien de partage est un enregistrement opaque liant page, workspace, vault, créateur, permission, expiration et révocation. `/s/:token` est volontairement hors du shell authentifié du frontend. Le résolveur public du backend utilise l'identité du vault stockée, car une requête anonyme n'a ni cookie ni en-tête de vault actif.

La révocation est logique afin de conserver une trace d'audit. Les liens expirés ou révoqués ne révèlent aucun contenu de page. La résolution des ressources publiques hérite du périmètre du partage et n'accepte pas un chemin arbitraire.

La frontière des routes de partage type la sérialisation, la résolution des
chemins de vault, les mutations ORM et chaque réponse. Des modèles Pydantic
nommés valident les mappings d'appels directs avant sérialisation ; les routes
de compatibilité désactivent explicitement la publication des modèles de
réponse pour préserver OpenAPI. Les identifiants multivaults stockés sont résolus
en chemins concrets avant l'activation du contexte de page. Une configuration
absente conserve le repli récupérable et la réponse de service indisponible.

Les paramètres d'identité du vault utilisent des modèles Pydantic distincts
pour les requêtes et les lectures historiques. Les champs historiques inconnus
survivent aux lectures, les écritures atomiques préservent la structure du profil
et les réponses réussies sont validées avant de renvoyer leur mapping directement
indexable.

Le listing, la création, le renommage et la suppression personnels multivaults
construisent des modèles de réponse Pydantic imbriqués explicites. Les slugs,
valeurs historiques nullables, sélection active et reçus de suppression
conservent leur structure de dictionnaire ; le confinement des chemins, la
protection du vault principal et le nettoyage des artefacts restent inchangés.

## API publique

Les routes authentifiées par PAT appliquent les périmètres du jeton en plus des
autorisations ordinaires de workspace et de vault. Le jeton en clair n'est affiché
qu'à sa création. Sa révocation empêche toute utilisation ultérieure sans
supprimer sa ligne d'audit.
La façade publique typée actualise les horodatages ORM via la frontière des
descripteurs, confine les écritures Markdown historiques au vault actif et
achemine les enregistrements Web Clipper configurés vers la création normale
des pages. Les résultats de jetons, ping, pages, configuration du clipper et
captures passent par des modèles Pydantic nommés puis conservent leur structure
historique de dictionnaire ou de liste. L'enregistrement explicite
`response_model=None` préserve les schémas FastAPI octet par octet jusqu'à la PR
coordonnée du contrat OpenAPI/client.

## Invariants

- L'identité, l'appartenance, le rôle, l'accès au vault et l'opération demandée participent tous à l'autorisation.
- Les cookies sont HttpOnly ; le frontend n'a pas besoin de lire le JWT.
- Les hachages des mots de passe et des jetons sont irréversibles.
- Un `X-User-ID` fourni par le client ne peut pas permettre la création d'un compte ou une élévation de privilèges.
- Le contenu du partage public est limité au périmètre de la page et du vault stockés.
- La commodité du mode personnel ne peut pas affaiblir un déploiement multi-utilisateurs exposé.

## Aspects de vérification

Exécutez les tests de contrôle central, d'authentification imposée, de compte,
de compte provisoire, de casse des e-mails, de mots de passe, de PAT,
d'interfaces publiques, de réponses typées directes, de concurrence à
l'amorçage des workspaces, d'appartenance et de partage. La QA dans le navigateur
vérifie connexion et déconnexion, mises à jour du compte, changement de workspace
et accès anonyme aux partages dans une session vierge.

Résoudre une bibliothèque enregistrée est une opération de lecture. Si son dossier est absent, l’identité est indisponible et les routes canoniques renvoient 404 ; les requêtes ne recréent jamais l’ancien emplacement. La création explicite des dossiers reste dans le flux de création de bibliothèque. Choisir un autre dossier existant conserve les deux identités et leurs chemins.

## Formulaires publics de table

`domains/forms/` publie des questions explicites d'une table enregistrée. GET anonyme `/api/forms/public/{token}` renvoie ce schéma ; POST `/submissions` valide chaque champ et crée une page par le processus canonique idempotent. Les formules, relations et métadonnées réservées ne sont pas modifiables. Une modification incompatible du schéma désactive le formulaire. Le module `share-links` contrôle publication et accès.

Formulaires et réservations utilisent `public_workflow_scope.py` pour fixer espace, vault et propriétaire et revérifier appartenance, écriture, stockage et modules. Les cookies, en-têtes et paramètres du visiteur ne sélectionnent pas la destination. Les réponses sont `no-store` ; les pages publiques n'envoient pas de référent et ne sont pas indexées. Le client public omet identifiants et en-têtes d'espace. La migration `mgmt_0006` ajoute définitions et reçus persistants sans modifier les enregistrements existants.

La publication d’un formulaire exige une durée de validité de 1 à 365 jours (30 par défaut). Chaque nouveau jeton conserve une échéance ; si elle manque ou est dépassée, les lectures et les réponses sont refusées. Le propriétaire peut révoquer le lien avant son expiration.

Le backend distribué inclut `management_0006.py` parmi ses ressources vérifiées pour que les installations de bureau puissent appliquer la même migration de schéma aux formulaires publics et aux réservations.

Les migrations de gestion suivent une séquence unique : `mgmt_0006` ajoute les formulaires et les réservations ; `mgmt_0007` ajoute les aperçus, sites et révisions de publication. Les deux font partie des ressources du backend de bureau. Les nouvelles bases et les mises à niveau conservent les deux schémas et les données existantes. Une base incompatible portant la même étiquette de révision est rejetée selon l’empreinte exacte du schéma avant toute modification ; l’étiquette seule n’autorise jamais son adoption.

## Publication sur le site de test

Le dialogue de partage propose **Publier sur le web** pour un site de test configuré par l’administrateur. `/api/vault/web-publishing` exige un éditeur authentifié et le module de partage. Le serveur résout le coffre autorisé et exécute uniquement le pilote Python configuré, avec une entrée JSON, un environnement minimal et une limite de 600 secondes. Les requêtes ne peuvent modifier le coffre, l’exécutable ou la destination de production. `GNOSI_WEB_PUBLISH_DRIVER` définit le chemin absolu `.py` ; `GNOSI_WEB_PUBLISH_PYTHON` permet de définir l’interpréteur. Par défaut, il s’agit de `python3` du PATH, jamais de l’exécutable empaqueté de l’application.

Les ajouts, actualisations et retraits sont explicites. Les autres pages publiées sont conservées et les traductions apparaissent dans la liste à vérifier. La publication consomme un aperçu à usage unique lié au compte, à l’espace de travail et au coffre. Un changement de contexte annule les requêtes et efface les données privées de l’interface. Modifier la sélection ou rencontrer un aperçu périmé exige une nouvelle vérification. L’historique permet de restaurer une version de test ; Drupal reste en production.

La lettre affiche les abonnements en attente, actifs et résiliés, les langues et l’historique. Le contenu de la lettre accepte les langues du site `ca`, `es` et `en-gb`, indépendamment de la langue de l’interface. L’aperçu HTML est isolé et sans accès au réseau. Seul `test_mode: true` est accepté : la file enregistre les messages de test sans envoyer de courriels réels. Les aperçus expirent après 15 minutes ou au redémarrage du serveur. Annuler dans le navigateur n’annule pas une publication déjà lancée ; il faut actualiser l’état avant de répéter une action incertaine.
