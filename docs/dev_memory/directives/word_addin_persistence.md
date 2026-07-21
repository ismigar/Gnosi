# Directiva: persistència del Word Add-in "Gnosi Cite"

**Problema**: a macOS, el botó **Cites Gnosi** desapareix del ribbon cada
vegada que es tanca el Word. Cal reobrir l'add-in des de *Complements de
desenvolupador* a cada sessió. A Windows no passa.

**Estat**: diagnosticat (2026-07-21). Cap acció de codi encara. Aquesta
directiva fixa la decisió abans de tocar res.

## Diagnòstic (verificat, no inferit)

Word manté dos búcquets de cau separats sota
`~/Library/Containers/com.microsoft.Word/Data/Library/Application Support/Microsoft/Office/16.0/Wef/`:

- El búcquet amb sufix `_ADAL` (autenticació de compte Microsoft) conté els
  add-ins que vénen d'un catàleg. El fitxer de control es diu, descodificat
  de base64, `EXCatalogMac_Word_ExEntitlementDetails`: *entitlements* de
  botiga lligats al compte.
- Un búcquet separat, sense `_ADAL`, conté els manifests carregats des de
  `~/Library/Containers/com.microsoft.Word/Data/Documents/wef/`.

Només els del primer búcquet s'escriuen a `Wef/AppCommands/17.0/`, que és el
registre que sobreviu a tancar el programa. A la màquina de referència aquell
directori contenia exclusivament entrades `EXCatalog` — Mendeley Cite
(`WA104382081`) i RefWorks (`WA200007520`) — i **cap** rastre de l'`<Id>` de
Gnosi Cite (`5e2c8b9a-1f2d-4b3c-9f8e-7d6c5b4a3e2f`).

**Conclusió**: no és un defecte del nostre manifest. El `VersionOverrides`
és correcte i el botó es registra bé dins la sessió; simplement el sideload
mai arriba al registre persistent. Problema conegut de plataforma:
OfficeDev/office-js#507. El Mendeley persisteix perquè està instal·lat des
de l'Office Store, no perquè el seu manifest sigui millor.

**No perdis temps** revisant el certificat TLS, el `SourceLocation`, el
LaunchAgent del frontend ni la versió del manifest: tot això es va descartar
amb mesures directes i cap n'és la causa.

## Opcions avaluades

### A. Plantilla `.dotm` a la carpeta Startup (mecanisme del Zotero)

Word carrega incondicionalment tot el que hi ha a
`~/Library/Group Containers/UBF8T346G9.Office/User Content.localized/Startup.localized/Word/`
a cada arrencada. És l'única via de persistència real que **no** depèn de
cap catàleg, compte de Microsoft ni allotjament públic. El Zotero ho fa
així i a la màquina de referència ja hi ha el seu `Zotero.dotm` funcionant.

Cost real, però: el Zotero no és només una plantilla. El VBA escriu ordres a
un fitxer-canonada (`.zoteroIntegrationPipe`) i és l'aplicació Zotero qui
respon governant el Word des de fora, amb una biblioteca Objective-C que fa
servir ScriptBridge/AppleScript. Replicar-ho a Gnosi vol dir: plantilla VBA
+ un helper natiu que condueixi el Word per AppleScript + una implementació
completament diferent per a Windows (COM). I es perd el Word per a la Web.

A favor: encaixa amb el local-first i ja tenim precedent d'helper natiu
(`host-open-helper`).

### B. Publicar a AppSource i allotjar el taskpane públicament

Era la hipòtesi inicial ("fer-ho públic"). **Descartada**: no només és cara
(revisió de Microsoft, compte de publicador, hostatge públic), sinó que va
en la direcció equivocada.

Els navegadors estan tancant precisament aquest patró. Chrome 142+ bloqueja
les peticions d'un origen HTTPS públic cap a `localhost` sense la
Permissions-Policy `local-network-access`, i Office incrusta els add-ins en
iframes que no la porten — sense prompt de permís possible
(OfficeDev/office-js#6281, #6174; oberts, a backlog, sense solució oficial).
Afecta específicament els add-ins "hosted on HTTPS domains (not development
servers)" que volen arribar a una aplicació local.

El muntatge actual (taskpane servit des de `https://localhost:5173` cridant
el backend a `localhost:5002`) és localhost→localhost i **no** queda afectat.
Publicar-lo ens mouria del cas sa al cas trencat: canviaríem una molèstia
només-Mac per un risc de ruptura a totes les plataformes.

### C. Desplegament de tenant (M365 Admin Center → Integrated Apps)

Dóna persistència tipus `EXCatalog` sense passar per AppSource. La validació
és més lleugera que la de la botiga, i com que cada client resoldria
`localhost` contra la seva pròpia màquina, en teoria evitaria el problema
del punt B. **Sense verificar**: desconegut si Microsoft accepta un
`SourceLocation` a `localhost` en desplegament centralitzat. Requereix
tenant de negoci, així que no serveix per a l'usuari individual.

### D. Acceptar-ho i reduir la fricció

És l'estat actual. El cost per sessió és reobrir des de *Complements de
desenvolupador*. A Windows no hi ha problema.

## Recomanació

No fer B. Si es vol resoldre de debò i mantenir el local-first, l'única via
sòlida és **A**, i s'ha de dimensionar com el que és: un component nou i
específic per plataforma, no un pedaç al manifest. Abans de comprometre-s'hi
convé provar **C** si hi ha tenant disponible, perquè és molt més barat si
la validació accepta `localhost`.

Mentrestant, D amb documentació honesta: el web i el README ja diuen
explícitament que a macOS cal reobrir-lo cada sessió i que és una limitació
del Word (corregit el 2026-07-21; abans afirmaven, falsament, "un cop").

## Restriccions i casos límit apresos

- **No canviïs `<Version>` esperant que Word rellegeixi el manifest sol**:
  Word indexa la cau per `<Id>_<Version>`. Deixar caure un manifest editat
  amb la mateixa versió és una operació nul·la i el botó no apareix mai.
  Cal pujar la versió a cada canvi publicat.
- **No deixis divergir el manifest de `wef/` del que hi ha al repo.** Va
  passar: el desplegat anava per 1.2.0.0 amb `?v=3` a les icones mentre el
  repo es va quedar a 1.1.0.0, i qui instal·lés des de la release s'enduia
  la versió sense les correccions. Edita sempre
  `frontend/public/word-addin/manifest.xml` i copia'l cap a `wef/`, mai al
  revés.
- **El botó viu a `TabReferences`, no a `TabHome`.** Es va moure i el README
  va quedar desactualitzat mesos.
- L'absència de l'`<Id>` a `Wef/AppCommands/17.0/` és el senyal diagnòstic
  ràpid: si no hi és, el botó no persistirà, i cap canvi al manifest ho
  arreglarà.
