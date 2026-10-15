---
status: implemented
last_verified: 2026-10-13
source_paths:
  - backend/api/calendar_routes.py
  - backend/domains/calendar/geocoding.py
  - backend/api/meeting_routes.py
  - backend/models/calendar.py
  - backend/services/google_calendar_service.py
  - backend/services/hybrid_calendar_service.py
  - backend/services/meeting_reminders.py
  - frontend/src/features/calendar
  - frontend/src/features/meetings
tests:
  - frontend/src/features/meetings/MeetingControls.test.tsx
  - frontend/src/features/meetings/public-entry.test.ts
  - frontend/src/features/calendar/page/CalendarPage.test.tsx
  - frontend/src/features/calendar/public-entry.test.ts
  - backend/tests/test_calendar_geocoding_domain.py
  - backend/tests/test_hybrid_calendar_service.py
  - backend/tests/test_calendar_path_containment.py
  - backend/tests/test_google_calendar_event_updates.py
  - backend/tests/test_meeting_reminders_race.py
  - tests/e2e/tests/e2e/calendar.spec.ts
---

# Calendrier et réunions

## Responsabilité

Calendrier regroupe les événements locaux du vault et ceux des comptes Google Calendar et CalDAV connectés. Il prend en charge la sélection des calendriers, le CRUD des événements, les invitations, les réponses RSVP, les requêtes de disponibilité, le géocodage, les rappels, les événements masqués, l'export ICS, l'enregistrement des réunions, leur transcription et les notes générées par IA.

Le frontend strictement typé `features/calendar/` gère la page de calendrier,
la sélection des sources, la recherche, la coordination des récurrences et
les dialogues de page. Son entrée publique conserve le chargement différé
d'origine. Les composants de rendu aussi utilisés par Vault et Mail restent
partagés hors de cette fonctionnalité ; les adaptateurs de fournisseurs, la
surveillance des rappels et les payloads d'événements sont inchangés.

`features/meetings/` gère l'enregistreur flottant, son contrôleur de capture et
de téléversement, ainsi que l'affichage des rappels. Son entrée publique charge
les modules d'enregistrement et de rappels indépendamment à la demande. Le shell
les monte avec les mêmes contrôles de plugins ; le déplacement ne change ni
les permissions d'enregistrement, ni les interrogations périodiques, ni la
navigation, ni les payloads.

La frontière HTTP est strictement typée tout en conservant le contrat de
réponse existant. La normalisation des libellés Photon, le rejet des URL, la
validation des résultats et la déduplication appartiennent au domaine de
géocodage Calendar plutôt qu'au module de routes ; les payloads fournisseur
sont validés à cette frontière d'adaptation.

Le service hybride des fournisseurs est strictement typé et conserve Google
comme adaptateur aux côtés du CalDAV générique. La détection CalDAV prend ainsi
en charge Nextcloud, iCloud, Fastmail, Radicale et les serveurs compatibles via
des URL configurées, sans comportement lié au fournisseur de stockage.

La route hybride interroge directement les fournisseurs externes. L'ouverture
du calendrier ne déclenche pas un second miroir du fournisseur vers le vault ;
les actualisations de l'index des pages ne peuvent donc ni dupliquer ni retarder
les lectures Google et CalDAV. Le Markdown existant sous `Calendar/External`
reste une donnée utilisateur que cette transition ne supprime jamais, mais le
web ne rafraîchit plus ce miroir hérité.

## Agrégation des événements

La couche de routes résout le contexte du workspace et les intégrations sélectionnées, puis normalise les événements des fournisseurs et les événements Markdown locaux dans une réponse commune. Les identifiants restent associés au compte et au calendrier d'origine ; un identifiant seul n'est pas suffisamment unique globalement pour effectuer une mutation.

Le masquage des événements est une surcouche locale. Il ne supprime pas l'événement chez le fournisseur. Le réaffichage retire cette surcouche pour que l'agrégation suivante inclue à nouveau l'événement.

## Flux de mutation

```mermaid
sequenceDiagram
    participant UI as Calendar UI
    participant API as Calendar routes
    participant Resolver as Integration resolver
    participant Provider as Google or CalDAV
    participant Vault as Local event page
    UI->>API: Create, patch, delete, RSVP, or invite
    API->>Resolver: Resolve account and enforce editor role
    alt Remote event
        Resolver->>Provider: Provider-specific operation
        Provider-->>API: Normalized event or error
    else Vault event
        Resolver->>Vault: Contained Markdown operation
        Vault-->>API: Updated local event
    end
    API-->>UI: Unified response
```

## Rappels et notes de réunion

Les paramètres des rappels définissent le délai d'anticipation et le comportement. La collecte fusionne les événements à venir et déduplique les requêtes concurrentes pour éviter les doublons. Le mécanisme de surveillance du frontend affiche les rappels actifs et permet d'ouvrir le calendrier ou de les fermer.

La persistance des rappels précise les types de l'état JSON en paramètres,
clés déjà notifiées et objets de rappels actifs explicites. Les dates des
fournisseurs sont analysées à une frontière unique, les libellés des participants
sont normalisés en chaînes et la sortie IA est convertie avant stockage. Le
verrou couvrant tout le cycle et la fusion avec l'état récent restent la
référence pour les accès concurrents du planificateur et de l'API.

L'enregistrement téléverse un audio de taille limitée vers un traitement en
arrière-plan. L'interrogation de l'état distingue enregistrement, transcription,
synthèse, création de note, réussite et échec. Les notes utilisent les opérations
sûres du vault et conservent le contexte d'événement et de source. Le service
normalise la réponse historique des routes du vault en mapping concret avant
de lire l'identifiant de page créée ; les gestionnaires dynamiques de compatibilité
ne se propagent pas à la frontière typée du travail. Les réponses d'enregistrement
et de suivi passent par des modèles Pydantic dédiés, tout en renvoyant les mêmes
dictionnaires directement indexables aux appelants existants.

## Invariants

- L'identité de l'événement du fournisseur comprend le contexte de compte et de calendrier.
- Les écritures du calendrier exigent un contexte disposant des droits d'édition.
- Les événements locaux identifiés par chemin restent dans le vault actif.
- Le masquage est local et réversible ; la suppression utilise le fournisseur faisant autorité.
- Les rappels résistent aux accès concurrents et ne sont pas dupliqués pour le même événement et la même fenêtre.
- Un fournisseur de transcription ou d'IA absent fait échouer le traitement de la réunion, pas le calendrier.
- L'export ICS utilise des fuseaux horaires normalisés et n'expose pas d'identifiants secrets.

## Aspects de vérification

Testez le confinement des chemins locaux, la normalisation des événements, les récurrences, le masquage, la concurrence des rappels, le choix de compte, les fuseaux horaires et les parcours Playwright de création, modification et suppression. La QA des réunions doit enregistrer ou téléverser un fichier de test, suivre l'état du traitement et vérifier la page produite dans le vault.

## Écritures CalDAV conditionnelles, visioconférences et réservations

Les écritures privées conservent le fournisseur explicite lors de la création, de la mise à jour par PATCH et de la suppression par DELETE. Si plusieurs comptes partagent une adresse courriel, cette indication sélectionne le bon compte ; les fournisseurs non pris en charge sont rejetés avant tout accès. DELETE accepte le paramètre de requête facultatif `provider`, que les clients existants peuvent omettre. Les noms des calendriers servent d’étiquettes ; les destinations d’écriture utilisent les identifiants du fournisseur, du compte et du calendrier.

`domains/calendar/provider_operations.py` résout le fournisseur du compte configuré. CalDAV utilise une découverte et des URL confinées, des PUT/DELETE conditionnels et l'ETag précédent. Le frontend conserve l'ETag renvoyé pour la prochaine sauvegarde. Un changement concurrent renvoie un conflit. Les séries récurrentes CalDAV ne sont pas modifiables. Les nouveaux événements avec heure utilisent des instants UTC pour transmettre des données complètes sans dépendre de l'extension de fuseaux horaires par référence du serveur ; les mises à jour conservent la représentation des dates existantes. `conference_links.py` normalise le lien vidéo en `join_url` ; l'inspecteur ouvre uniquement HTTP(S), sans identifiants ni référent.

Le texte inchangé conserve ses espaces et tous les paramètres de la propriété. Une modification conserve les paramètres de langue et d’extension, mais retire ALTREP, dont la représentation alternative peut décrire l’ancienne valeur.

`domains/booking/` agrège les périodes occupées des calendriers sélectionnés, y compris locaux, et applique fuseau horaire, semaine ouvrée, durée, marges, préavis et horizon. Une erreur du fournisseur ferme la disponibilité. La requête de repli CalDAV conserve la distinction entre jours nominaux et heures écoulées, et bloque les récurrences non prises en charge, notamment les heures locales inexistantes qu'elle ne peut pas résoudre de manière fiable. La destination doit être sélectionnée. Les identifiants externes étant globaux à l'installation, ces réservations sont limitées au propriétaire de l'espace personnel.

La récurrence locale ignore les heures inexistantes avant d’appliquer COUNT ; les occurrences réelles exclues consomment toujours le compte. Les événements avec heure conservent leur durée écoulée et ceux sur toute la journée conservent des jours nominaux. L’expansion à compte fini est validée depuis la première occurrence, avec une limite de 3 000 occurrences évaluées ; les intervalles invalides et les expansions non prises en charge ferment la disponibilité.

L'accès anonyme est limité à GET `/api/booking/public/{token}`, GET `/slots` et POST `/reservations` sous ce lien. La gestion privée utilise `/api/booking/links` et la consultation agrégée `/api/booking/availability`. Une réservation persistante dans SQLite sérialise les créneaux des liens du même propriétaire ainsi que ceux de propriétaires différents consultant le même vault ou calendrier externe avant de créer l'événement. Les calendriers de propriétaires sans ressources partagées ne se bloquent pas entre eux. Une nouvelle tentative ne répète pas une écriture incertaine : la demande en attente bloque le créneau et reste visible au propriétaire. Les changements simultanés dans d'autres clients ne peuvent pas participer à cette transaction.

La lecture sélectionne les métadonnées du compte sans déverrouiller les identifiants. L’authentification reste dans l’adaptateur du fournisseur sélectionné, et la sélection du fournisseur, du compte et du calendrier est conservée lorsque les comptes partagent une adresse électronique.
