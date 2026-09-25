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
