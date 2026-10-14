# Utilitza correu, calendari i contactes

Connecta els comptes necessaris i identifica quina font és propietària de cada missatge, esdeveniment o contacte.

## Abans de començar {#before-you-begin}

Activa Correu, Calendari i Contactes segons calgui. Els comptes externs necessiten credencials o autorització; els esdeveniments i contactes locals no requereixen núvol.

## Passos {#steps}

1. A Integracions, afegeix el compte i prova la connexió. El correu utilitza IMAP/SMTP; els calendaris admeten Google Calendar o CalDAV, i els contactes Google o CardDAV, a més dels locals.

2. Obre Correu i tria compte i carpeta. Llegeix un missatge i prepara un esborrany; revisa destinataris i adjunts abans d’enviar-lo.

3. Obre Calendari i selecciona les fonts visibles. Crea un esdeveniment al calendari local o extern previst i comprova fus horari, inici, final i repetició.

4. Obre Contactes i crea un contacte local fictici o sincronitza una font autoritzada. Comprova la font abans d’editar dades del proveïdor.

5. Utilitza un suggeriment de contacte en un esborrany o camp d’assistents i verifica l’adreça: noms semblants poden correspondre a persones diferents.

6. Per gravar reunions, activa la funció corresponent i concedeix els permisos del dispositiu. La transcripció i les notes generades necessiten els seus serveis configurats.

## Resultat esperat {#expected-result}

Pots trobar el correu d’un compte, l’esdeveniment al calendari previst i un contacte amb una font coneguda.

## Si alguna cosa falla {#troubleshooting}

Si falten dades, revisa l’autorització i els filtres de fonts. Ocultar un esdeveniment no l’elimina del proveïdor. Evita reconnectar comptes o reenviar missatges mentre l’operació anterior no estigui resolta.

## Guies relacionades {#related-guides}

- [Activa complements, connecta serveis i automatitza](integrations-automations.md)
- [Preguntes freqüents i recuperació](troubleshooting.md)

## Escriptura CalDAV i videotrucades

Els calendaris CalDAV amb permís d'escriptura, inclòs iCloud, permeten crear, editar i eliminar esdeveniments individuals. Les modificacions conserven l'UID, els fusos horaris, les dates de dia complet i les propietats iCalendar no modificades. L'ETag del proveïdor evita sobreescriure un canvi simultani; actualitza l'esdeveniment abans de tornar-lo a editar si hi ha un conflicte. Les sèries recurrents CalDAV es mantenen en mode de lectura a Gnosi.

Si el proveïdor proporciona un enllaç de vídeo, obre la cita i prem **Entra a la videotrucada**. L'enllaç s'obre al navegador.

## Disponibilitat i reserves públiques

Obre **Disponibilitat** al panell lateral del calendari. Selecciona tots els calendaris que han de bloquejar reserves, inclosos els esdeveniments locals de Gnosi i calendaris de diversos comptes. Configura el fus horari, els dies i hores laborables, la durada, el marge, l'antelació i l'horitzó de reserva. Consulta les franges, tria un calendari de destí entre els seleccionats i crea un enllaç de reserva. Pots copiar i revocar els enllaços publicats.

Els visitants trien una franja i indiquen el nom i el correu. Gnosi torna a comprovar la disponibilitat abans de crear la cita. Si no pot consultar algun calendari, les reserves s'aturen. Si el resultat d'una escriptura al proveïdor és incert, la franja queda bloquejada i la reserva apareix pendent; verifica el calendari de destí abans de crear-ne una altra. Els comptes externs només es poden utilitzar en reserves públiques del propietari de l'espai personal.

L'enllaç públic requereix que els destinataris puguin accedir al servidor web de Gnosi. Una adreça localhost o d'escriptori només funciona al mateix dispositiu; crear l'enllaç no publica ni exposa la instal·lació.
