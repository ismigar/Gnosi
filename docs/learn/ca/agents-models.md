# Configura l’assistent i els seus perfils

L’assistent executa les tasques d’IA de Gnosi. Un perfil en desa la configuració: model, instruccions, fonts i habilitats. El perfil principal és el que utilitzen el xat, les funcions d’IA i les automatitzacions quan s’executen.

## Abans de començar {#before-you-begin}

Activa la funció d’IA. Un proveïdor al núvol necessita credencials vàlides i pot tenir cost; un model local necessita el servei en funcionament.

## Passos {#steps}

1. Obre la configuració de models i proveïdors i configura un proveïdor compatible o un servei local. Desa les credencials a Configuració i selecciona un model disponible.

2. Obre Configuració → Plugins → IA → Assistent i prem **Configura l’assistent**. Tria el model, posa nom al perfil i assigna-li les habilitats necessàries.

3. Obre el xat i comprova l’agent i el model seleccionats. Fes una pregunta curta per verificar la connexió.

4. Afegeix la pàgina, taula o fitxer concret com a context. Demana una tasca acotada, com “Resumeix les preguntes d’aquesta pàgina”.

5. Si vols que actuï, comprova que el model admet eines i que les habilitats i eines requerides estan disponibles. Revisa les peticions de confirmació abans d’acceptar-les.

6. Inspecciona el resultat i les fonts. Desa les conclusions útils en una pàgina i distingeix la interpretació pròpia del text generat.

### Perfils addicionals

A **Perfils addicionals (avançat)** pots desar altres configuracions. **Crea un perfil** no canvia el principal. Prem **Utilitza com a principal** per aplicar aquella configuració; el perfil anterior es conserva. Les automatitzacions necessiten tenir la seva habilitat assignada al nou principal.

Pots eliminar els perfils addicionals. Per eliminar el principal, tria primer un altre perfil com a principal. Si vols desactivar tota la IA, desactiva el plugin d’IA a Plugins.

### Tria de model segons la tasca

A la configuració de l’assistent pots triar tres opcions:

- **Model fix:** fa servir sempre el model principal.
- **Alternatives si falla:** conserva el principal i permet alternatives davant errors temporals o si el principal no està disponible.
- **Selecció automàtica:** tria un model per a cada petició segons la tasca, les capacitats, la disponibilitat i el pressupost.

Activa explícitament els models alternatius que vols permetre. Han d’estar habilitats i ser compatibles; un assistent local només pot fer servir alternatives locals. Les instruccions, la memòria i les habilitats continuen pertanyent al mateix assistent.

En selecció automàtica pots fer servir el selector intern de Gnosi o **Jev (TypeSafe)**. Per activar Jev, desa la clau de TypeSafe al camp corresponent. Quan calgui triar entre models, se li enviarà el text de la petició actual; no s’hi afegeixen automàticament la memòria ni les fonts adjuntes. Les consultes compten en la despesa. Si falta la clau, el servei falla o la decisió és incerta, Gnosi fa la selecció interna. Els detalls de la resposta indiquen quin selector s’ha utilitzat.

## Resultat esperat {#expected-result}

L’agent seleccionat respon amb el context previst i mostra les capacitats disponibles.

## Si alguna cosa falla {#troubleshooting}

Un model pot conversar sense admetre eines. Davant errors d’autenticació, temps d’espera o eines absents, revisa proveïdor, model i habilitats per separat. Comprova el resultat d’una acció abans de donar-la per feta.

## Guies relacionades {#related-guides}

- [Pregunta sobre les fonts seleccionades](notebooks.md)
- [Preguntes freqüents i recuperació](troubleshooting.md)
