# Espais de treball, Vaults i compartició

L’espai de treball determina amb qui treballes i amb quins permisos. El Vault conté els fitxers de coneixement. Canviar-ne un pot modificar els registres i la configuració visibles.

## Abans de començar {#before-you-begin}

Un espai de treball existent. En una organització pots necessitar ser-ne membre i tenir rol d’editor. La compartició externa requereix el seu complement.

## Passos {#steps}

1. Comprova el nom de l’espai al selector. Tria’n un d’existent o utilitza **Nou espai de treball** si la instal·lació permet crear-ne.

2. Obre el selector de Vaults o Configuració → General → Fitxers. Selecciona el Vault previst o crea’n un amb un nom com “Grup de lectura”.

3. Crea una pàgina de prova i torna-la a obrir després de canviar de Vault i retornar-hi. Així comproves on pertany.

4. Per col·laborar, gestiona membres i rols a la configuració de l’espai. Dona accés d’edició a qui hagi de modificar el contingut.

5. Per compartir una pàgina externament, activa el complement de compartició i utilitza els controls de la pàgina. Revisa permisos i caducitat i obre l’enllaç en una sessió separada del navegador per comprovar què veu un visitant.

## Resultat esperat {#expected-result}

Pots identificar l’espai i el Vault actius i verificar l’abast d’una pàgina compartida.

## Si alguna cosa falla {#troubleshooting}

Un Vault local no apareix automàticament en un altre ordinador. La pertinença a un espai, la sincronització de fitxers i la compartició pública són mecanismes diferents. Si falta un espai, comprova el compte i la carpeta abans d’eliminar res.

## Guies relacionades {#related-guides}

- [Instal·la Gnosi i fes els primers passos](getting-started.md)
- [Preguntes freqüents i recuperació](troubleshooting.md)

## Catàleg i moderació de plantilles de Vault

En mode personal, Configuració → General → Estructura de fitxers → Vaults → Des del repositori obre el catàleg verificat. La cerca, els filtres per categoria i les previsualitzacions de contingut ajuden a triar una plantilla; la instal·lació crea un Vault nou. Publicar plantilla obre un inventari cercable dels fitxers inclosos, les exclusions i les possibles dades sensibles. Refrescar l’inventari esborra l’acceptació anterior.

## Disposicions desades i notes al canvas

Les disposicions desades recorden notes obertes, dibuixos, lectors PDF i EPUB, document actiu i mides dels panells. També restauren les posicions de lectura. Si un destí ja no existeix, Gnosi informa del problema abans de substituir la disposició actual.

En una targeta de pàgina del canvas, utilitza **Edita** i **Desa** per modificar-ne la nota. Els esborranys es conserven quan canvies de disposició durant la sessió; desa’ls abans de tancar l’aplicació. La importació i exportació JSON Canvas conserven les targetes, connexions i metadades compatibles. Importar no copia fitxers adjunts, i Gnosi informa de les estructures no compatibles.

## Emporta’t notes seleccionades sense connexió

Inicia sessió al servidor Gnosi, selecciona compte, espai de treball i Vault i obre el complement de notes sense connexió des de Configuració → General. Crea una col·lecció xifrada amb una contrasenya separada, carrega la llista del servidor i afegeix les notes de text que necessitis. Utilitza **Desa localment** després d’editar. Després de la primera càrrega correcta de producció, el complement es pot tornar a obrir sense xarxa. Al navegador mòbil, afegeix-lo a la pantalla d’inici; el servidor ha d’utilitzar HTTPS.

Reconnecta i sincronitza explícitament. Si les dues còpies han canviat, compara el text original, local i del servidor i tria o escriu una versió combinada. Conserva la contrasenya: no es pot recuperar i esborrar les dades del navegador elimina els canvis no sincronitzats. Els adjunts i les notes incrustades no es descarreguen amb la nota. El servidor continua utilitzant l’emmagatzematge existent; aquesta col·lecció local xifrada no és una còpia de seguretat.

## Publica una col·lecció de notes

Amb el connector de compartició activat, obre els controls de compartició d’una nota i tria la publicació de diverses pàgines. Selecciona les notes, posa nom al lloc i, opcionalment, defineix-ne la caducitat. Revisa la previsualització pública abans de publicar. La navegació i la cerca només inclouen les pàgines seleccionades; s’indiquen els adjunts, transclusions privades, HTML i consultes desades que s’ometen. Els canvis d’origen només es publiquen després de previsualitzar i publicar una actualització. Revoca el lloc des del mateix gestor per impedir lectures futures; els visitants poden haver-ne desat còpies.
