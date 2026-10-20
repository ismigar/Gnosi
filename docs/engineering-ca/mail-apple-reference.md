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

# Referència d'Apple Mail i cobertura de Gnosi

Aquesta investigació utilitza l'Apple Mail 16.0 instal·lat, compilació
3901.100.1.1.12, com a referència de comportament per millorar el mòdul de
correu de Gnosi. El SHA-256 de l'executable és
`9e1d4526c45462d3facdfe47e133c42d97ead0fd97229dfc6ef5a0eab2e44aec`.
El codi d'implementació i els recursos d'Apple no s'incorporen a Gnosi.

## Evidències i límits

REA ha descodificat els 107 documents d'interfície compilats amb una unió exacta
de camins i hashes: 2.057 controls amb etiqueta o acció, 595 connexions d'acció
definides, 359 selectors diferents i 112 declaracions de dreceres. Setanta
taules de localització en anglès i la definició de scripting aporten
declaracions addicionals. Són observacions estàtiques de les interfícies
distribuïdes, no mesures d'execució ni de rendiment.

El registre de la interfície del paquet original és
`ev_2d60c93b3784f4bfb6d28a5cc15692cd0fb15675c27a1cfc6668e48f34bd6941`.
El límit de 64 documents del descodificador ha exigit una segona passada per
43 recursos idèntics byte a byte en un contenidor d'anàlisi diferent i no
executable, registrada com a
`ev_fd593629b7968addfc22971fb12419e41ea7d64c12a65cff3ecea039ee8b0a05`.
Les dues passades no tenen camins de documents originals superposats ni absents.
El contenidor temporal s'ha eliminat després d'exportar les evidències.

`PreferencesWindow.loctable` declara un mapatge específic de la bústia d'arxiu,
i les preferències compilades connecten el seu selector.
`ViewerPreferences.loctable` declara missatges relacionats, l'ordre del més
recent al més antic i el comportament de lectura. `Mail.sdef` declara la
memòria cau de tots els missatges IMAP amb adjunts o sense. Aquestes
declaracions, per si soles, no estableixen el comportament en execució. Les
observacions del codi natiu següents ofereixen una referència més específica,
encara estàtica. Els serveis privats dels proveïdors i el comportament dels
frameworks del sistema requereixen evidències separades. La cobertura de la
interfície no implica una reproducció funcional completa ni compatibilitat.

## Càrrega de converses al codi natiu

REA/Ghidra ha inspeccionat l'executable distribuït sense iniciar Mail ni llegir
missatges personals. L'exportació completa d'evidències natives conté
17 registres; el seu SHA-256 és
`129707b63e9075725b31b680fb955e2ebbc60ea8a7c0c2ee9442932ca07ff412`.
Les adreces canòniques i els identificadors d'evidència identifiquen els
procediments observats:

| Procediment | Observació estàtica | Evidència REA |
| --- | --- | --- |
| `ConversationPrefetcher::initWithMessageListContentController:messagesTableView:` (`0x10008214c`) | Crea un `NSCache` anomenat `ConversationPre-FetchCache` amb un límit de 50 entrades i observa el desplaçament. | `ev_fa7824691df165d433ae2ae6f0a8122afb53b8f7fd241172423490e3715cab0b` |
| `_prefetchVisibleConversations:` (`0x100082520`) | Resol les files visibles de la taula, utilitza els identificadors de conversa com a claus de la memòria cau i inicia la càrrega asíncrona dels membres de les converses absents. | `ev_2cc61803626bfcdcef5c971285210d249c1017f7d628b444ef26cdd9e268f011` |
| `_armTimerWithDelay:` (`0x1000823a8`) | Reinicia un temporitzador pendent; el retard configurat és de 0,5 segons i la tolerància és la meitat del retard. | `ev_70f9eed5ec18bb84493c275d867d41892580cf18d0baa9dffb452e9fc5d48de7` |
| Bloc de finalització de la precàrrega (`0x1000828f8`) | Comprova que l'entrada de la memòria cau encara existeix i prepara com a màxim set membres ordenats al voltant de la posició inicial de lectura. | `ev_8f1d539fba64e142c477c3d076f362edef762d0484d118dbeaeb04ec15116773` |
| Bloc de preparació dels membres (`0x1000829d0`) | Crida `asyncLoadAllowingRemoteFetch:reloadBanners:completionHandler:` amb els arguments `false, true, nil`. | `ev_f24b1a6a24c5954202253a8128275fe78b4c58ad551bb642c4a7f461bdb7dbfd` |
| Bloc d'expulsió de la memòria cau (`0x100082ad4`) | S'executa al fil principal i crida `cancelLoad` per als membres de la conversa. | `ev_a40b73b4d199efd1d2fcef64f7149bb5b6a1c4e1ebf7866712f832ba26e378fe` |
| `Conversation::asyncLoadConversationMembers` (`0x100077afc`) | Reutilitza els membres carregats, fa seguiment dels callbacks de finalització i dels missatges inicials, i programa un temps límit de recuperació ràpida de 0,25 segons. | `ev_26327235dd05d4b42ab1697e8632e1bc9b26a71d35ce36c90857b5522506a57a` |
| `Conversation::_quickFetchTimeout` (`0x100077fbc`) | Publica els missatges inicials disponibles i invoca els callbacks en espera. | `ev_b89bc7b39845cf75858696637d657cd325dd9e8d08f1de0103ac8784e47e545c` |
| `ConversationMember::cancelLoad` (`0x10007c8c8`) | Cancel·la el generador de documents i buida l'estat de càrrega. | `ev_73a8b31cd6c3cbb7ba0b6b9e78e715eee9630c23af9bb03d7964716191b09ccd` |

Aquestes observacions donen suport a la preparació asíncrona, la reutilització
acotada, la disponibilitat parcial de converses i la cancel·lació com a
referències de disseny. No mesuren la latència real. En particular, la crida
de precàrrega observada desactiva `allowingRemoteFetch`; afirmar que descarrega
anticipadament els cossos remots dels missatges aniria més enllà de les
evidències. No s'han traçat la implementació MailUI cridada, l'emmagatzematge
durador de missatges, la planificació de connexions amb els proveïdors ni la
semàntica completa sense connexió. La connexió IMAP separada per als cossos i
la memòria cau del lector de 16 entrades/4 MiB/cinc minuts de Gnosi són decisions
d'implementació independents, no valors recuperats d'Apple.

## Cobertura funcional

«Existent» descriu el codi font de Gnosi inspeccionat, no l'equivalència amb
totes les operacions d'Apple. «Parcial» identifica una mancança concreta pendent
del producte. El treball previst no queda acceptat pel fet de superar les
regressions de l'arxiu o del lector.

| Àmbit d'Apple Mail | Implementació de Gnosi i treball pendent |
| --- | --- |
| Bústies, preferits, obertura ràpida i pestanyes | Navegació unificada i per compte existent; es conserva el descobriment de carpetes personalitzades. L'arbre complet de carpetes de cada compte, els preferits i l'obertura ràpida de bústies continuen sent parcials. |
| Arxivar, moure, copiar i eliminar | S'han corregit les llistes d'Arxiu/Tot el correu i el tractament de les etiquetes d'arxiu; hi ha accions existents de moviment i paperera. La còpia i el cicle de vida complet de les bústies personalitzades continuen sent parcials. |
| Converses i missatges relacionats | Converses de Gmail desplegables existents; s'han corregit la reutilització dels cossos i la cancel·lació. La reconstrucció genèrica d'IMAP a partir de References/In-Reply-To continua sent parcial. |
| Lector, capçaleres, font i aparença | Lector existent d'HTML sanejat i text, previsualització i temes. Les eines completes de font original i capçaleres i l'aparença de cada missatge continuen sent parcials. |
| Estat de lectura, marques i prioritat | Accions existents de lectura i estrella; les operacions en segon pla deixen disponible el bucle d'esdeveniments. Les marques de colors, les prioritats completes i els controls d'estat de tots els missatges continuen sent parcials. |
| Cerca, ordenació i filtres | S'han corregit la cerca de text completa al proveïdor i la paginació; hi ha una interfície existent d'ordenació i filtres. La composició avançada de consultes al servidor i el conjunt complet de metadades d'adjunts continuen sent parcials. |
| Bústies intel·ligents i cerques desades | Vistes desades persistents existents amb filtres AND/OR. Els criteris encara operen sobre les files carregades i no són un motor complet de consultes al servidor. |
| Categories i safata d'entrada prioritària | Categories existents. La categorització persistent dels remitents i les prioritats sensibles al temps continuen sent parcials. |
| Compositor, destinataris, àlies i grups | Editor, Per a/Cc/Cco, identitats, autocompleció i àlies existents. Els controls complets de grups i capçaleres d'adreces continuen sent parcials. |
| Esborranys, lliurament, enviament programat i desfer | Esborranys i lliurament immediat existents. Encara cal implementar una safata de sortida duradora sense connexió, la programació i desfer l'enviament. |
| Respostes, reenviament i redirecció | Resposta, resposta a tothom i reenviament existents amb conservació de les imatges CID citades. La redirecció i el reenviament com a missatge adjunt continuen sent parcials. |
| Adjunts i previsualitzacions | Descàrregues, previsualització de PDF, CID i imatges remotes amb restriccions existents. Les accions completes sobre adjunts, el flux de redimensionament d'imatges i un equivalent de Mail Drop continuen sent parcials. |
| Text enriquit, tipus de lletra i ortografia | Editor de text enriquit existent. El conjunt complet de conversions entre text pla i enriquit per missatge i de controls d'ortografia i tipografia continua sent parcial. |
| Signatures | Signatures d'identitat existents. La paritat en la gestió de signatures encara s'ha de verificar. |
| Sincronització, reconstrucció i quota de bústies | Sincronització IMAP/IDLE i actualització explícita existents. La reconciliació i reconstrucció completes, la quota i la interfície de manteniment dels comptes continuen sent parcials. |
| Importació, exportació i impressió | Hi ha còpies locals en Markdown/HTML. La importació i exportació de bústies, l'intercanvi EML/mbox, la impressió de correu i l'exportació a PDF continuen sent parcials. |
| Regles de correu entrant i accions | Les vistes desades configuren controls de visualització. Encara cal implementar un avaluador persistent de regles de correu entrant i les accions de les regles. |
| Comptes, SMTP, TLS i autenticació | Google IMAP OAuth, IMAP/SMTP manual i Microsoft Graph existents. No es reprodueixen POP ni tot el comportament dels comptes específic d'Exchange. |
| Emmagatzematge sense connexió i diagnòstic | Còpies locals i memòries cau acotades de llistes i cossos existents. Una bústia duradora completa sense connexió i un diagnòstic de l'estil de Connection Doctor continuen sent parcials. |
| Privacitat del contingut remot | Entorn aïllat, restriccions d'URL/IP/tipus/mida/termini i recuperació explícita d'imatges existents. No és un relé de privacitat anonimitzador. |
| Signatura i xifratge | Hi ha protecció TLS i de credencials. No es reprodueixen la signatura i el xifratge S/MIME ni el cicle de vida dels certificats. |
| Correu brossa, bloqueig, silenciament i baixa | Accions existents de correu brossa. Els fluxos persistents de bloqueig, silenciament i baixa continuen sent parcials. |
| Recordatoris, seguiment i notificacions | Ajornament i extracció al calendari i als contactes de Gnosi existents. El seguiment complet i els controls de notificacions i concentració específics del correu continuen sent parcials. |
| Extensions i integració amb el sistema | Integracions i eines de l'agent de Gnosi existents. No es reprodueixen les extensions Apple MailKit ni els contractes dels serveis natius. |
| Resposta intel·ligent, previsualitzacions d'enllaços i adreces privades | Assistència opcional existent d'IA per a esborranys i anàlisi. El comportament d'adreces privades i previsualitzacions d'enllaços ofert pels proveïdors continua sent parcial. |
| Programació d'absències | Encara no reproduïda al mòdul de correu inspeccionat. |
| Accessibilitat i scripting | Infraestructura compartida de teclat i accessibilitat i API de l'agent existents. El conjunt complet de dreceres de Mail, objectes de scripting i comportaments dels serveis de macOS continua sent parcial. |

## Límits de reproducció i validació

El defecte de l'arxiu s'ha reproduït sense credencials: un servidor IMAP fictici
amb missatges de la Safata d'entrada i arxivats retornava només els de la Safata
d'entrada amb `folder=all`. Un escenari separat ha reproduït notes locals
arxivades classificades com a eliminades. Els escenaris del lector han reproduït
una petició duplicada del cos per a una còpia de Tot el correu de Gmail i el
reinici de peticions després de substitucions innòcues del resum o del callback.

La cobertura de regressió comprova les connexions independents dels cossos, la
disponibilitat del bucle d'esdeveniments, els terminis de lectura i errors del
proveïdor recuperables, la paginació completa entre diverses carpetes, el
descobriment de bústies entre cometes o literals, l'escapament de la cerca i
UTF-8, les metadades d'arxiu de cada compte, els identificadors RFC originals,
la conservació d'etiquetes, la identitat dels cossos, els resultats obsolets i
el reintent.
Escenaris de regressió addicionals cobreixen la invalidació de credencials
durant l'inici de sessió, el tractament separat dels errors de transport, totes
les carpetes d'arxiu, l'ordenació per data dels missatges importats, les lectures
incompletes de capçaleres natives i la reutilització i reinici de la memòria
cau de lots amb 2.001 missatges. Un escenari separat de fallada de conversa
verifica HTTP 503 per als errors de transport o de membres parcials i la lectura
local dels identificadors RFC desats sense ordres remotes d'UID. Una llista
agregada en fred encara necessita totes les petites capçaleres coincidents
abans de l'ordenació global; no és un índex durador complet de metadades sense
connexió.
Les proves de navegador d'un sol ús exerciten la paginació de Tot el correu amb
121 missatges i d'Arxiu amb 61 missatges, amb geometria real de desplaçament i
cerca als cossos pel proveïdor. Aquests resultats validen aquests escenaris,
no els altres àmbits funcionals de la taula.
Una regressió addicional amb dos comptes reprodueix com un compte no disponible
bloqueja la paginació del compte sa i com un reintent explícit descarta les
pàgines del compte sa. La paginació i el reintent aïllats per compte són necessaris per
a la bústia unificada.

## Seqüència d'integració

La referència descriu un programa de producte considerable. Manteniu separada
l'acceptació de cada grup funcional perquè les regressions del lector no puguin
substituir la compatibilitat completa amb Mail:

1. Establir lectures àgils, reintents que reflecteixin l'estat real, Arxiu/Tot el
   correu complets i cerca al proveïdor. El candidat actual aborda aquesta base.
2. Afegir l'arbre de bústies de cada compte i el seu cicle de vida, la
   reconstrucció genèrica de converses IMAP, les eines de missatge original i
   la reconciliació duradora sense connexió. Verificar la identitat entre
   comptes i entre carpetes amb escenaris de servidor sintètics.
3. Afegir cues duradores de lliurament, enviament programat i desfer l'enviament,
   regles de correu entrant i cerques desades avançades. Verificar la recuperació
   després de reiniciar i el comportament dels proveïdors fallits abans
   d'exposar aquests controls.
4. Completar els grups de compatibilitat individuals, incloent-hi la importació,
   exportació i impressió, marques més riques, controls de remitents, protocols
   dels comptes, xifratge i integració amb el sistema, amb acceptació específica
   per a cada proveïdor i plataforma compatibles.

Canviar l'aplicació instal·lada requereix, a més, un codi font reconciliat que
contingui tots els commits registrats al manifest dels seus components, el nou
treball de correu i els altres canvis concurrents acceptats. Superar una
comprovació al worktree de codi font, per si sol, no estableix l'acceptació de
la versió instal·lada ni publicada.
