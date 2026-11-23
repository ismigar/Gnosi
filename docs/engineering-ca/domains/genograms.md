---
status: implemented
last_verified: 2026-09-09
source_paths:
  - backend/domains/genograms
  - frontend/src/features/genograms
  - frontend/src/shared/api/genograms.ts
  - backend/services/builtin_plugins.py
  - frontend/src/features/vault/views/VaultViewBody.tsx
  - frontend/src/features/vault/views/db-view-embed/useEmbedDerived.ts
tests:
  - backend/tests/test_genograms.py
  - backend/tests/test_genograms_api.py
  - frontend/src/features/genograms/GenogramsConfig.test.tsx
  - frontend/src/shared/api/genograms.test.ts
  - frontend/src/features/genograms/genograms.test.tsx
  - frontend/src/features/genograms/export.test.ts
  - frontend/src/features/vault/view-config/page-view-modal/useViewAppearance.genogram.test.tsx
---

# Genogrames

El plugin integrat opcional `genograms` manté una xarxa familiar compartida a cada Vault. Activa’l a Configuració → Plugins → Genogrames i prem **Prepara les taules**. La preparació crea la base de dades Genogrames, les taules Persones i Relacions, les vistes tabulars principals i una vista Genograma inicial. Els noms segueixen l’idioma de la interfície: català, castellà, anglès o francès. Repetir la preparació reutilitza els identificadors de taules i camps i recupera els camps obligatoris que faltin.

La configuració permet seleccionar el Vault de destinació i inicialment mostra l’actiu. La preparació i la consulta d’estat utilitzen aquest identificador sense canviar el Vault actiu. Quan les dues taules existeixen, un missatge traduït amb el nom del Vault substitueix el botó principal de preparació. L’estat es consulta en obrir el panell, en recuperar el focus i cada 15 segons mentre és visible; eliminar qualsevol de les dues taules fa reaparèixer l’acció de preparació. Els missatges de càrrega, error, absència de vaults i confirmació estan traduïts al català, anglès, castellà i francès. La consulta d’estat i la preparació amb permisos d’edició estan disponibles encara que Genogrames estigui desactivat al Vault de destinació; no activen el plugin. Les consultes del graf continuen requerint que el plugin estigui activat.

Selecciona una persona de referència al dibuix. Per defecte s’inclouen dues generacions d’ascendents, una de descendents, els germans de la persona de referència i les parelles immediates. L’expansió de parelles no recorre tota la seva família. Les inclusions, exclusions i els filtres habituals de la taula delimiten la xarxa visible. La cerca ressalta noms sense filtrar el dibuix. S’indica el nombre de connexions ocultes i no s’inventen filiacions entre les persones que continuen visibles.

## Registres i validació

Les persones i relacions continuen sent registres Markdown normals amb camps YAML amb nom i cos de nota. Els camps s’identifiquen pel seu identificador estable; canviar-ne el nom o el de la taula no trenca l’adaptador. Les opcions es desen amb el nom traduït de la taula i l’API les normalitza a codis estables. Els identificadors són independents dels noms, que es poden repetir. Les fonts enllacen a registres del Vault; les persones també admeten etiquetes.

Les dates parcials conserven la precisió original (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`) amb indicadors d’aproximació separats. Les dates desconegudes queden buides. Un registre gestacional pot convertir-se en persona sense canviar d’identitat. Els naixements múltiples comparteixen un grup. Les unions, filiacions dirigides i relacions emocionals tenen identitat pròpia; cada filiació pot referenciar una unió concreta. L’absència d’un vincle emocional significa que no està documentat. Es conserven les dates, però aquesta versió no reconstrueix estats històrics.

Les escriptures Markdown i els moviments a la paperera comparteixen validacions amb l’editor visual. Un bloqueig de fitxer per Vault i un bloqueig dins del procés serialitzen la validació i l’escriptura entre processos locals del servidor. Es mantenen les proteccions ETag. Es rebutgen autorelacions, referències inexistents, duplicats, unions incompatibles i cicles de filiació. S’admeten avantpassats compartits i cicles de parella o emocionals. Les relacions buides són esborranys i apareixen com a incidències fins a completar els extrems. Les contradiccions de dates generen avisos. Cal resoldre les relacions abans d’eliminar un registre referenciat; no hi ha eliminació en cascada.

Les consultes llegeixen les dues carpetes de la xarxa sense dependre d’un índex asíncron. Les relacions modificades externament que no siguin vàlides generen incidències i s’exclouen del dibuix; la lectura no repara fitxers. Els fitxers que no es poden llegir bloquegen les modificacions fins a resoldre la incidència, perquè no es pot validar una xarxa incompleta.

## Vistes i dibuix

L’objecte versionat `genogram` del registre de vista desa la persona de referència, profunditats, inclusions, etiquetes, capes i coordenades manuals. El mateix component serveix per a taules, panells i notes. Copiar una vista a una nota conserva les opcions. Moure un símbol només modifica aquella vista. Les dades dels registres són compartides; desactivar el plugin conserva les taules i configuracions i mostra l’estat de plugin desactivat a les vistes gràfiques.

La disposició es calcula en un procés separat del navegador. La filiació determina els nivells; les parelles només s’alineen si no contradiu l’ascendència. Les parelles i els naixements múltiples s’agrupen, i els germans s’ordenen per naixement o ordre explícit. Cada persona es representa una vegada. Els vincles emocionals no afecten les posicions. Les coordenades manuals prevalen fins a prémer **Reorganitza**. Les revisions i la cancel·lació per Vault descarten càrregues, respostes de disposició i desaments obsolets.

El dibuix és SVG monocrom amb símbols geomètrics i patrons de línia diferenciats. La llegenda només inclou les convencions utilitzades. El repertori es basa en la [simbologia de GenoPro](https://genopro.com/genogram/symbols/) i els seus [vincles emocionals](https://genopro.com/genogram/emotional-relationships/). La llegenda identifica el símbol neutre amb rombe i interrogant i les adaptacions monocromes. Les branques complexes es poden ajustar manualment.

## API i exportació

- `GET /api/vault/genograms/status`: consulta sense modificar dades si les dues taules existeixen al Vault seleccionat.
- `POST /api/vault/genograms/prepare`: preparació idempotent, reservada a editors.
- `POST /api/vault/genograms/graph`: resol opcions desades o locals, normalitza i valida la xarxa i retorna identificadors visibles, incidències i correspondències de camps.
- Les altes i modificacions utilitzen les API normals de pàgines del Vault i ETag.

Les exportacions parteixen de l’SVG visible, amb títol, data de generació i llegenda si està activada. Els noms complets, inicials o àlies només afecten la representació. S’eliminen atributs interactius i ressaltats de selecció. L’SVG incorpora els estils. El PNG utilitza fons blanc i resolució doble, reduïda proporcionalment si supera 32 megapíxels o 16.000 píxels per costat, sense retallar el dibuix.

La conversió PDF carrega localment jsPDF i [svg2pdf.js](https://github.com/yWorks/svg2pdf.js/), incorpora Liberation Sans i admet A4/A3, orientació vertical o horitzontal i ajust a pàgina o mosaic. La llicència de les fonts s’inclou als recursos de la funcionalitat. La conversió no requereix serveis externs ni IA.

## Verificació

Les proves del servidor cobreixen la preparació i modificacions en Vaults temporals, els cicles i canvis simultanis, els camps reanomenats, ETag, la conversió de gestacions, la desactivació del plugin i els fitxers externs incorrectes. Les proves de la interfície cobreixen disposició determinista, avantpassats compartits, parelles de generacions diferents, posicions manuals, simbologia perinatal, privadesa de l’exportació i opcions de vistes inserides.

La prova PDF executa els conversors reals, comprova les fonts incorporades i un mosaic de nou pàgines, i només substitueix la geometria de text que falta a jsdom. La revisió al navegador cobreix l’edició sense sortir de la vista, la selecció de línies, l’arrossegament, l’estabilitat de la capa emocional i l’ocultació i restauració de persones.

Un conjunt determinista mesura la disposició de 200 persones i 500 relacions. El límit d’1,5 segons detecta regressions; no és una promesa per a tots els dispositius ni una mesura completa de representació. Les xarxes grans s’han de consultar per focus i branques. L’API no trunca registres silenciosament.

GEDCOM, reconstrucció temporal, condicions clíniques estructurades i ecomapes queden per a ampliacions.
