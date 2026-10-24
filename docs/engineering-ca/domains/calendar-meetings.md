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

# Calendari i reunions

## Reversió

Els esdeveniments de calendari agrega els esdeveniments locals amb contactes de Google Calendar i CalDAV. Permet la selecció de calendari, les invitacions de l' esdeveniment, les explondes, les consultes de lliure/buss, geocoding, recordatoris, estat ocult, exportació d' exportació, la reunió, la transcripció i les notes de l' IA- validades.

El escrit estrictament `features/calendar/` El frontal és propietari de la pàgina de calendari, selecció d' origen, cerca, coordinació i diàlegs de la pàgina. La seva entrada pública manté el límit d' enviament mandrós original. Els renderitzadors de calendari també consumeixen per Vulta i correu que es comparteixen fora de la característica de ruta; els proveïdors d' adaptadors, els vigilants de recordatoris i els esdeveniments no canvien.

`features/meetings/` El seu controlador de captura/ droga, i presentació de recordatoris. La seva entrada pública de registre i mòduls de recordatori independentment. L' intèrpret d' ordres els munta a través de les mateixes portes de connectors que abans; la relocalització no canvia els permisos de gravació, l' enquestament, la navegació o els carregadors.

El límit HTTP és estrictament teclejat mentre es preserva el contracte de resposta existent. L' etiqueta Photon etiqueta normalization, rebuig d' URL, validació de resultats i desenganyació pertanyen al domini de calendari en comptes del mòdul de ruta; els proveïdors de proveïdors encara segueixen validats en aquest límit d' adaptador.

El servei de proveïdor híbrid és estrictament escrit i manté Google com un adaptador al costat de la detecció genèrica de comptes CalDAV. CalDAV, per tant, implementa el Nextcloud, iCloud, Fmail ràpid, els servidors radicals i compatibles mitjançant URL configurats, sense bodefinar el comportament específic de l' espai de treball d' emmagatzematge.

La ruta híbrid consultes externes directament als proveïdors. Obrir el calendari no inicia un segon mirall de proveïdor a Vulta, de manera que les actualitzacions de pàgina no poden duplicar o retardar Google i CalDAV llegeix. La marca existent a sota `Calendar/External` Encara hi ha dades d'usuari i mai s' esborra aquesta transició, però el temps d' execució web ja no refresca el mirall antic.

## Esdeveniment agregregació

La capa de ruta resol el context de l' espai de treball i les integració seleccionades, després normalitza els esdeveniments del proveïdor i els esdeveniments locals Markdown en una resposta compartida. Els identificadors del proveïdor es troben aparellats amb el seu origen del compte/calendar, un ID únic no és prou únic globalment per a la mutació.

Els esdeveniments ocults són registres de recobriment locals. Ocultar no esborra un esdeveniment del proveïdor. El no Oculta elimina el recobriment de manera que la següent acceleració ho inclogui de nou.

## Flux de la mutació

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

## Recordatoris i notes de reunió@ info: whatsthis

Els arranjaments del recordatori seleccionen el temps i el comportament. La col· lecció fusionarà els esdeveniments propers i despensi els requeriments recurrents per tal que els recordatoris duplicats no siguin creats. El visor de la botiga mostra recordatoris actius i pot navegar fins al calendari o rebutjar- los. @ info

El recordatori persisteix a l' estat JSON en arranjaments explícits, claus no confirmades i objectes de recordatori actius. L' anàlisi del temps accepta els valors del proveïdor a un límit, les etiquetes de l' assistent són normalitzades a cadenes, i la sortida de l' IA s' ha convertit abans d' emmagatzemar. La blocació de cicle i el flux d' estat fresc romanen l' autoritat per al planificador/ racesAPI.

Les pujades de la junta han lligat àudio a un flux de treball de fons. Els col· legis electorals de l' estat s' apliquen, la transcripció, la suma de notes, la creació de la compleció i el fracàs. Les notes generades s' escriuen a través de les operacions de seguretat Vulta i es mantenen en el context de l' esdeveniment/ codi. El servei de fons normalitza el resultat de la ruta de la crida a un mapatge de formigó abans de llegir l' identificador creat de pàgina; els gestors dinàmics de compatibilitat no es filtra en el límit de treball teclejat. Enregistra i les respostes electorals passen per models Pytant mentre tornen a la mateixa índex directament emprada pels diccionaris que es poden llegir els existents.

## Invariants

- El proveïdor d' esdeveniments inclou compte i context del calendari.
- El calendari escriu que requereix un context executable.
- Els esdeveniments locals basats en camins es queden dins de la volta activa.
- Ocultar és local i reversible; l' eliminació utilitza el proveïdor autoriu.
- Els recordatoris són de seguretat racial i no duplicats pel mateix esdeveniment/ window. @ info
- Falta la transcripció o els proveïdors de l'AI han fallat la feina de reunió, no el calendari.
- La sortida ICS utilitza zones horàries normalitzades i no exposen credencials privades.

## Concentrat de verificació

Prova el contenidor de la ruta local, esdeveniment normalització, repetició, estat ocult, dependències de recordatori, selecció de comptes, zones horàries i crea/ info/ repetició de la ruta local. S' hauria de gravar o pujar un estat de fons d' anàlisi, observar l' estat resultant de la pàgina Vulta.

## Escriptures CalDAV condicionals, videotrucades i reserves

Les escriptures privades conserven el proveïdor explícit en crear, actualitzar amb PATCH i eliminar amb DELETE. Si diversos comptes comparteixen correu, aquesta indicació selecciona el compte correcte; els proveïdors no admesos es rebutgen abans d’accedir-hi. DELETE accepta el paràmetre de consulta opcional `provider`, que els clients existents poden ometre. Els noms dels calendaris són etiquetes; les destinacions d’escriptura utilitzen els identificadors del proveïdor, compte i calendari.

`domains/calendar/provider_operations.py` resol el proveïdor del compte configurat. CalDAV utilitza descobriment i URL de recursos confinats, PUT/DELETE condicionals i l'ETag anterior. El frontend conserva l'ETag retornat per al desament següent. Un recurs modificat retorna un conflicte. Les sèries recurrents CalDAV no es poden modificar. Els esdeveniments nous amb hora utilitzen instants UTC per enviar dades completes sense dependre de l'extensió de fusos horaris per referència del servidor; les actualitzacions conserven la representació de les dates existents. `conference_links.py` normalitza l'enllaç de vídeo a `join_url`; l'inspector només obre HTTP(S), sense credencials ni referent.

El text no modificat conserva els espais i tots els paràmetres de la propietat. En editar-lo, es conserven els paràmetres d’idioma i d’extensió, però es retira ALTREP perquè la representació alternativa pot descriure el valor anterior.

`domains/booking/` agrega els intervals ocupats dels calendaris seleccionats, inclosos els locals, i aplica fus horari, setmana laboral, durada, marges, antelació i horitzó. Els errors del proveïdor tanquen la disponibilitat. La consulta alternativa CalDAV conserva la distinció entre dies nominals i hores transcorregudes, i bloqueja les recurrències no compatibles, incloses les hores locals inexistents que no pot resoldre amb garanties. El calendari de destí ha d'estar seleccionat. Com que les credencials externes són globals de la instal·lació, les reserves amb aquests comptes es limiten al propietari de l'espai personal.

La recurrència local omet les hores inexistents abans d’aplicar COUNT; les instàncies reals excloses continuen consumint el recompte. Les cites amb hora conserven la durada transcorreguda i les de tot el dia conserven dies nominals. L’expansió amb recompte finit es valida des de la primera instància, amb un límit de 3.000 instàncies avaluades; els intervals invàlids i les expansions no compatibles tanquen la disponibilitat.

L'accés anònim es limita a GET `/api/booking/public/{token}`, GET `/slots` i POST `/reservations` sota aquest enllaç. La gestió privada és a `/api/booking/links` i la consulta agregada a `/api/booking/availability`. Una reserva persistent a SQLite serialitza les franges dels enllaços del mateix propietari i de propietaris diferents que consulten el mateix vault o calendari extern abans de crear l'esdeveniment. Els calendaris de propietaris sense recursos compartits no es bloquegen entre ells. Els reintents no repeteixen una escriptura incerta: la petició pendent bloqueja la franja i és visible al propietari. Els canvis simultanis fets en altres clients de calendari no poden formar part de la mateixa transacció.

La lectura selecciona les metadades del compte sense desbloquejar credencials. L’autenticació continua dins de l’adaptador del proveïdor seleccionat, i es conserva la selecció de proveïdor, compte i calendari quan els comptes comparteixen una adreça de correu.
