# Captura fonts, llegeix i cita

Segueix el recorregut de recerca des de la font fins a l’evidència i l’escriptura pròpia. El lector de canals i la gestió bibliogràfica són funcions diferents.

## Abans de començar {#before-you-begin}

Activa Recursos per gestionar referències i Lector de canals per seguir canals. La consulta d’identificadors necessita xarxa; les citacions a Word o LibreOffice requereixen el complement corresponent.

## Passos {#steps}

1. Obre **Cerca bibliogràfica** (la funció Recursos) i comprova la taula de referències configurada. Importa un DOI, ISBN, arXiv o PMID, un fitxer BibTeX/RIS o una URL compatible.

2. Revisa títol, autoria, data i identificador abans d’utilitzar el registre. Resol els possibles duplicats en lloc de repetir la importació.

3. Obre un PDF o EPUB adjunt. Anota un passatge conservant-ne la pàgina, el capítol o una altra localització i verifica que hi apunta correctament.

4. Crea una nota de lectura amb l’evidència i un paràgraf separat amb la teva interpretació. Enllaça-la amb la referència i el projecte.

5. Per seguir canals, activa el Lector, afegeix-hi un canal i obre un article. El contingut pot requerir accés al web de l’editor.

6. Per redactar, instal·la i configura el [complement de Word](https://github.com/ismigar/Gnosi/tree/main/extensions/office/word-cite) o l’[extensió de LibreOffice](https://github.com/ismigar/Gnosi/tree/main/extensions/office/libreoffice-cite). Utilitza el selector de citacions i la bibliografia i comprova autoria, any i estil.

## Resultat esperat {#expected-result}

Tens una referència revisada, una anotació rastrejable i una nota connectada amb el teu escrit.

### Camps de les notes generades

A **Configuració → Plugins → Coneixement**, dins de cada taula de recursos, utilitza **Camps a omplir a les notes de lectura → Afegir camp**. Tria un camp del Cervell i selecciona **Inferir amb IA**, **Copiar camp font**, **Valor fix** o **Deixar buit**. Pots treure una regla sense eliminar el camp de la taula. Aquesta selecció és independent dels camps amb índex.

La IA assigna valors segons cada nota i només utilitza les etiquetes i relacions existents. Els valors fixos respecten el tipus del camp, inclosos números, caselles i dates; els adjunts i altres camps estructurats es poden copiar del recurs. Els camps calculats i del sistema es gestionen automàticament. Les regles s’apliquen en processar o tornar a processar el recurs. **Deixar buit** buida el valor en les notes reprocessades; treure la regla conserva els valors anteriors.

## Si alguna cosa falla {#troubleshooting}

L’identificador aporta metadades, però no garanteix accés al text complet. Si falla, revisa l’identificador i el proveïdor o prova una exportació compatible. Corregeix les metadades abans d’editar manualment la bibliografia.

## Guies relacionades {#related-guides}

- [Pregunta sobre les fonts seleccionades](notebooks.md)
- [Crea pàgines, enllaços i adjunts](pages-files.md)

## Escoltar el pòdcast diari

Amb el Lector de canals activat, configura el pòdcast diari als ajustos del connector i el model de l’assistent assignat a **Configuració → IA**. L’episodi diari selecciona articles publicats durant les 24 hores anteriors. S’informa de les fonts que no es poden llegir; si no se’n pot llegir cap, no es publica cap episodi.

Personalitza l’habilitat **Resum diari** assignada per ajustar-ne l’enfocament editorial i les preferències del pòdcast. Per defecte es demanen deu minuts i un màxim de dotze grups temàtics. La revisió per defecte comprova els resums de les fonts i la cobertura temàtica, inclosos els temes independents menys representats; la revisió completa opcional examina més a fons els fragments originals. La durada és un objectiu i la generació pot fallar si no compleix els requisits de longitud o de contrast amb les fonts. Comprova l’episodi acabat i les fonts indicades abans de donar-lo per bo.

La configuració de veu es comparteix entre el xat, els pòdcasts del Lector i l’àudio generat dins del Vault actiu. Els canvis es desen automàticament; comprova’n l’estat abans d’escoltar una prova. La veu local ha d’estar disponible al servidor i la veu neuronal requereix el proveïdor configurat.

### Generació i recuperació

Activa el Lector de canals i la IA, configura l’assistent assignat a l’habilitat del resum diari i comprova la configuració de veu. Al Lector, fes servir el botó per generar el pòdcast; si ja hi ha un episodi, fes servir el botó per regenerar-lo. Obre el panell de veu sota el reproductor per escoltar-ne una prova, o fes servir el botó **Obre la configuració** per editar la configuració compartida. La prova no està disponible durant la generació.

L’episodi utilitza els articles publicats durant les 24 hores anteriors, inclosos els ja llegits. Els articles sense text llegible ni resum del canal s’ometen i s’indiquen en un avís. La generació pot durar uns quants minuts; segueix-ne el progrés i fes servir Activitat per inspeccionar la tasca o cancel·lar-la. Escolta l’episodi acabat al reproductor. Un error o una cancel·lació conserva l’àudio anterior; si no es pot llegir cap article, no es genera cap substitució.

Els dies amb pocs articles poden produir episodis més curts. Els canvis de configuració s’apliquen a tasques noves; una tasca represa conserva la selecció i les preferències originals.
