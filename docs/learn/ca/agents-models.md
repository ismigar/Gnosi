# Configura l’assistent i els seus perfils

El perfil predeterminat s’utilitza en converses noves i en accions de l’app. Cada conversa pot triar un altre perfil sense afectar les altres.

## Abans de començar {#before-you-begin}

Activa la funció d’IA. Un proveïdor al núvol necessita credencials vàlides i pot tenir cost; un model local necessita el servei en funcionament.

## Passos {#steps}

1. Obre la configuració de models i proveïdors i configura un proveïdor compatible o un servei local. Desa les credencials a Configuració i selecciona un model disponible.

2. Obre Configuració → Plugins → IA → Assistent i prem **Configura l’assistent**. Tria el model, posa nom al perfil i assigna-li les habilitats necessàries.

3. Obre el xat i comprova l’agent i el model seleccionats. Fes una pregunta curta per verificar la connexió.

4. Afegeix la pàgina, taula o fitxer concret com a context. Demana una tasca acotada, com “Resumeix les preguntes d’aquesta pàgina”.

5. Si vols que actuï, comprova que el model admet eines i que les habilitats i eines requerides estan disponibles. Revisa les peticions de confirmació abans d’acceptar-les.

6. Inspecciona el resultat i les fonts. Desa les conclusions útils en una pàgina i distingeix la interpretació pròpia del text generat.

### Perfils i converses

Crea perfils des de **Perfils addicionals (avançat)**. Al xat, obre el selector del nom de l’assistent i tria el **Perfil de la conversa**. El canvi s’aplica a les peticions següents i conserva l’historial. Cada conversa recorda el seu perfil. **Fes servir per defecte**, a Configuració, estableix el perfil per a converses noves; no canvia els xats existents.

### Un únic model per perfil

Cada perfil té un únic LLM. Per fer servir un altre model, tria un altre perfil o edita el model del perfil. No hi ha selecció automàtica ni models alternatius en cas de fallada. Si el perfil s’elimina o el model no està disponible, tria un altre perfil des del xat. Per eliminar el predeterminat, primer estableix-ne un altre. Per desactivar la IA, desactiva el plugin.

## Resultat esperat {#expected-result}

L’agent seleccionat respon amb el context previst i mostra les capacitats disponibles.

## Si alguna cosa falla {#troubleshooting}

Un model pot conversar sense admetre eines. Davant errors d’autenticació, temps d’espera o eines absents, revisa proveïdor, model i habilitats per separat. Comprova el resultat d’una acció abans de donar-la per feta.

## Guies relacionades {#related-guides}

- [Pregunta sobre les fonts seleccionades](notebooks.md)
- [Preguntes freqüents i recuperació](troubleshooting.md)

## Perfils dels plugins

Cada plugin d’IA declara un perfil editable i les habilitats que utilitzen les seves accions. Configuració → IA → Assistent mostra els perfils dels plugins separats dels personals. Hi pots editar l’únic model, les instruccions, les fonts i les habilitats assignades. Els perfils inicials copien només el model predeterminat actual; les actualitzacions preserven les edicions. Desactivar un plugin suspèn el seu perfil sense eliminar la configuració. Si falta el model o una habilitat necessària, l’acció falla explícitament sense recórrer al perfil personal. Les accions independents noves i les habilitats programades utilitzen el perfil del plugin; els treballs iniciats conserven la seva instantània. El perfil triat manualment en una conversa continua governant aquella conversa.

## Directiu i equip d’especialistes

A **Configura l’equip**, selecciona el Directiu, els membres i els papers de cadascun. Un agent pot tenir diversos papers. Indica també quins perfils de plugins poden delegar: les seves accions continuen pertanyent al plugin. La configuració no s’activa fins que deses els canvis. Només s’afegeix l’habilitat de coordinació al Directiu; es conserven els models, les instruccions i les altres habilitats.

Les rutes directes associen operacions conegudes a una llista d’executors. El servidor comprova disponibilitat, habilitats, context i límits abans de comparar el cost estimat de l’encàrrec. El cost desconegut es tracta com a desconegut. Una ruta directa evita la crida al Directiu; una petició ambigua requereix un pla. Un resultat vàlid es lliura sense una revisió automàtica del Directiu.

El pla té un màxim de quatre encàrrecs, dos especialistes temporals i dos encàrrecs de lectura simultanis. Les accions amb modificacions són seqüencials. Les operacions estructurades tenen vuit crides totals com a màxim, dins del pressupost del treball original. La reparació de format té un únic intent i no repeteix les accions. Només es replanteja automàticament treball de lectura; els efectes incerts requereixen revisió.

Autoritza explícitament els models i les habilitats disponibles per als temporals. No s’instal·len eines ni es concedeixen permisos nous. Els temporals pertanyen a una execució i no apareixen al selector general. A **Activitat**, pots revisar una proposta de conservació, editar-ne les instruccions reutilitzables i acceptar-la o rebutjar-la. Acceptar crea un perfil personal sense historial ni memòries; després el pots incorporar a l’equip. Rebutjar impedeix repetir la mateixa proposta.

Les confirmacions identifiquen l’executor. Aprovar una acció no autoritza altres accions. Reprendre reutilitza el pla i els encàrrecs completats; si una acció falla o el seu efecte és incert, no es repeteix automàticament. Cancel·lar el treball impedeix continuar els seus descendents. Els registres privats segueixen la retenció de l’execució.

El catàleg mostra valoracions independents per a Directiu, Tot terreny, Documentalista, Perit, Administratiu i Peó, amb evidències i proves pendents. La compatibilitat declarada no certifica la qualitat del català, les cites ni l’economia de delegació. Les etiquetes antigues es mantenen per compatibilitat, però no decideixen l’executor. Les proves automàtiques utilitzen proveïdors simulats; no executen avaluacions de pagament. Cal comparar qualitat i cost total sobre els mateixos casos abans d’ampliar les rutes.

A la configuració de cada agent, el camp opcional **Comanda** permet assignar una comanda única, com `/traductor`. Escriu `/traductor Tradueix aquest text…` al xat per enviar aquell torn directament a l’agent, amb el seu model, instruccions i habilitats, sense passar pel Directiu. La selecció habitual de la conversa no canvia. Les comandes no amplien els permisos i els agents desactivats no es poden invocar. Fes servir una lletra inicial i fins a 32 lletres sense accents, dígits, guions o guions baixos després de `/`; no es distingeixen majúscules i minúscules.

## Valoració dels perfils i dades pendents

Orientació, no certificació: mínim 60/100 i 60% de dades, amb requisits per paper. Intel·ligència, codi i capacitat agentiva es comparen amb el catàleg actual; context i velocitat saturen a 200.000 tokens i 100 tokens/s. Latència i preu puntuen amb 1/(1+x/2). El preu usa una barreja fixa de 4 tokens d’entrada per 1 de sortida; no és el cost real d’una tasca. No es dedueixen cites, català ni fiabilitat a partir del context.

Prem Actualitza per tornar a consultar les dades disponibles (es respecta la memòria cau del proveïdor). Si continuen absents, cal que la font publiqui la dada; no s’inventa ni es dedueix del nom o la mida del model.


Com verificar-ho: executar els mateixos casos sintètics amb Tot terreny, Directiu sempre actiu i Directiu amb rutes; validar el pla, els executors triats, les crides evitables i el cost total.

Com verificar-ho: provar instruccions en català i accions amb eines simulades; puntuar la qualitat lingüística, el compliment de les instruccions i el resultat de cada acció.

Com verificar-ho: fer preguntes sobre documents sintètics amb fragments i respostes coneguts; comprovar recuperació, cites exactes i cobertura de totes les fonts necessàries.

Com verificar-ho: resoldre problemes amb solució coneguda i casos sense informació suficient; mesurar encerts, contrast i reconeixement de la incertesa.

Com verificar-ho: extreure dades sintètiques amb resultat esperat i validar automàticament el contingut i l’esquema; executar procediments amb passos verificables.

Com verificar-ho: repetir transformacions amb sortida esperada i registrar encerts, temps i tokens; calcular el cost per tasca correcta, inclosos els reintents.

La columna Ús mostra només el perfil seleccionat i el seu percentatge; ordenar-la compara aquella puntuació, amb els valors desconeguts al final. Cost estimat i Proveïdor van a continuació. Sense filtre, ordenar Ús compara la millor puntuació disponible de cada model.

El panell Proves de perfils i estratègies de la comparativa permet triar agents habilitats i autoritzar cada execució amb consum real. Les proves per paper utilitzen 2–3 casos sintètics amb validadors deterministes. La comparació aplica els mateixos tres casos a Tot terreny, Directiu sempre actiu i Directiu amb rutes; inclou dues rutes conegudes i una resolució de fonts contradictòries amb dependències. Compara encerts, crides, intervencions evitables i cost; les dades absents no es consideren zero. És un laboratori aïllat que reutilitza l’elecció econòmica, sense eines de negoci. No és una certificació completa de llengua, recuperació extensa ni ús real d’eines.

Cada resultat conserva versió, data, model, proveïdor i comprovacions per cas dins de l’usuari i Vault originals. Les valoracions amb prou dades combinen 50% catàleg i 50% prova sintètica; les limitacions i mancances generals continuen visibles. Refresca la comparativa després de consultar els resultats. La prova té un límit global de 24 crides, fins a 512 tokens de sortida per crida; comparar les tres estratègies fa 17 crides. Les traces d’aquestes proves conserven només metadades. Cancel·la-les des d’Activitat. No canvien els models assignats.

Les propostes de conservació mostren les habilitats reutilitzables, les diferències de cobertura i model respecte dels agents existents i les execucions completades. No confonen completar una execució amb verificar tots els criteris particulars. Les instruccions permanents parteixen d’una plantilla d’habilitats registrades, sense copiar l’encàrrec; l’usuari pot revisar-les. Acceptar permet incorporar el nou perfil personal a l’equip. Una configuració equivalent existent evita una proposta duplicada. Rebutjar impedeix repetir la mateixa proposta.

Per resoldre una mida desconeguda, selecciona **Pendent de verificar** a la columna Paràmetres. **Consulta la font oficial** cerca una coincidència de versió exacta a les fitxes dels fabricants compatibles. Si la font no respon o no hi ha coincidència, la dada continua pendent. També pots registrar els milers de milions totals i actius, o una absència de publicació revisada, amb una font HTTPS i la confirmació explícita que has comprovat el model exacte. Les dades revisades manualment conserven la procedència i la data; no trobar una xifra no demostra que no estigui publicada. El servidor no visita els enllaços introduïts.
