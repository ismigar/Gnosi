---
status: implemented
last_verified: 2026-10-26
source_paths:
  - backend/domains/sites/newsletter.py
  - frontend/src/features/websites/SourcesEditor.tsx
  - backend/domains/vault/publishing
  - frontend/src/features/sharing/publishing
  - frontend/src/features/offline
  - frontend/src/shared/offline
  - backend/api/auth_routes.py
  - backend/api/workspace_routes.py
  - backend/api/vaults_routes.py
  - backend/api/vault_templates_routes.py
  - backend/api/share_routes.py
  - backend/api/public_routes.py
  - backend/models/management.py
  - backend/services/auth_service.py
  - backend/services/auth_public_surface.py
  - backend/services/workspace_service.py
  - backend/services/vault_routing.py
  - backend/services/active_vault_middleware.py
  - frontend/src/shared/auth/auth-context.ts
  - frontend/src/features/auth
  - frontend/src/features/sharing
  - frontend/src/features/auth/context/AuthProvider.tsx
  - frontend/src/shared/routing
  - frontend/src/features/workspaces
tests:
  - backend/tests/test_sites_newsletter.py
  - frontend/src/features/websites/SourcesEditor.test.tsx
  - backend/tests/test_web_publishing.py
  - frontend/src/features/sharing/publishing/WebPublishingManager.test.tsx
  - frontend/src/shared/api/web-publishing.test.ts
  - backend/tests/test_auth_expected_account.py
  - frontend/src/features/auth/LoginPage.test.tsx
  - frontend/src/features/auth/public-entry.test.ts
  - backend/tests/test_auth_central_gate.py
  - backend/tests/test_auth_enforcement_flag.py
  - backend/tests/test_pat_authentication.py
  - backend/tests/test_workspace_bootstrap_race.py
  - backend/tests/test_workspace_invite_email_case.py
  - backend/tests/test_vault_canonical_routing.py
  - backend/tests/test_vault_recovery_identity.py
  - backend/tests/test_vault_templates.py
  - backend/tests/test_inline_comments_permissions.py
  - backend/tests/test_auth_public_surface.py
  - backend/tests/test_auth_account_settings.py
  - backend/tests/test_auth_email_case.py
  - backend/tests/test_auth_placeholder_account.py
  - backend/tests/test_password_hashing.py
---

# Autenticació, espais de treball i compartició

## Notes sense connexió i llocs publicats

El complement de notes sense connexió s’obre des de Configuració → General i utilitza el mateix origen del servidor. En una compilació de producció, el service worker només desa la interfície pública compilada. L’usuari tria les notes de text explícitament i protegeix la col·lecció local amb una contrasenya separada. Les desades locals xifren la col·lecció a IndexedDB; bloquejar-la esborra el text desxifrat conservat per l’aplicació. La sincronització comprova compte, espai de treball, Vault i versió de pàgina i mostra les dues versions si hi ha conflicte. El servidor continua conservant notes llegibles ordinàries. Adjunts, dibuixos i bases de dades queden fora d’aquesta col·lecció.

La publicació de diverses pàgines utilitza el connector de compartició i el backend del servidor propi. Un editor selecciona notes i revisa la instantània pública exacta abans de publicar-la. El visitant només rep aquella instantània; la navegació i la cerca es limiten a les pàgines seleccionades. S’ometen visiblement adjunts, HTML, transclusions privades i consultes desades. Les actualitzacions requereixen una previsualització nova; revisions, caducitat i revocació es desen a la base de dades de gestió. Les lectures anònimes utilitzen una ruta de token acotada, ometen credencials i no arrenquen l’aplicació privada. Publicar no desplega un altre servei ni actualitza automàticament els canvis de les notes originals.

## Modes operatius

El mode `personal` és l'experiència local predeterminada d'un sol usuari.
S'omet l'autenticació tret que la política efectiva l'exigeixi. El mode `org`
requereix identitat i pertinença a un espai de treball. Els desplegaments
exposats poden exigir autenticació independentment de l'etiqueta del mode.

El control del frontend selecciona l'inici de sessió o la interfície de
l'aplicació, però tota l'autorització s'aplica a les dependències i serveis
del backend.

L'estructura principal importa el formulari d'accés per l'entrada pública de
`features/auth`. La validació d'accés i registre, les sessions i el control de
política del backend mantenen el comportament existent. La configuració de compte
i espai de treball és independent d'aquest formulari; traslladar-ne l'entrada
no autoritza l'accés a cap espai de treball.

La funcionalitat de compartició exposa la pàgina de només lectura per una
entrada pública diferida. La ruta `/s/:token` continua fora del control
d'autenticació i de l'estructura de l'aplicació. Traslladar-la no amplia l'accés:
el backend resol el token i els enllaços caducats o invàlids mantenen l'error existent.

La resolució d'espai de treball valida les arrels configurades del projecte i
del vault abans d'inicialitzar res o seleccionar rutes. La inicialització
personal és segura davant de concurrència i confirma la pertinença guanyadora
després d'un conflicte d'unicitat. El mode d'organització concreta els rols i
les capacitats JSON abans de construir el context de petició. Si falten muntatges,
només s'utilitzen alternatives on la compatibilitat personal ho permet
explícitament; mai no s'inventa un vault d'organització.

## Autenticació amb sessions i tokens

L'accés amb correu i contrasenya verifica el hash de la contrasenya i emet un
JWT signat en una galeta HttpOnly amb SameSite=Lax. Els clients API admesos
també poden enviar un token bearer a `Authorization`. Els Personal Access
Tokens utilitzen un format opac separat; només se'n desa un hash SHA-256 i
el prefix visible.

Els clients que conserven canvis entre sessions poden enviar `X-Gnosi-Expected-User-ID`. El control central compara aquesta precondició amb la identitat autenticada per galeta/PAT abans d’atendre rutes protegides: si falta identitat retorna 401, i un canvi de compte retorna 409 amb `code: account_changed`. La capçalera mai no selecciona un usuari ni concedeix permisos, tampoc en instal·lacions locals amb autenticació opcional. Es continuen comprovant els rols d’espai de treball/Vault. Les excepcions públiques d’accés, sortida i salut conserven el comportament existent.

El secret de signatura ha de ser robust en desplegaments exposats. El backend
rebutja l'arrencada amb el valor públic de desenvolupament quan la política
efectiva del desplegament exigeix protecció.

La frontera de rutes d'autenticació està estrictament tipada i conserva els
esquemes de resposta congelats. Els models de gestió comparteixen una
`DeclarativeBase` tipada de SQLAlchemy; els descriptors de columna només es
concreten a la frontera ORM. La reclamació de comptes, la rotació de contrasenyes,
les actualitzacions de perfil i les galetes de sessió mantenen la validació i
les transaccions. Els objectes Pydantic de permisos conserven els valors
predeterminats històrics i la representació OpenAPI exacta.

El servei d'autenticació tipa als seus límits les sessions de gestió, els
generadors de memòria cau de polítiques, la identitat HTTP/WebSocket, la consulta
de PAT i la descodificació del subjecte JWT. Els stubs de `python-jose` estan
fixats al grup de dependències de desenvolupament. La mutació antiga de marques
temporals ORM que queda s'aïlla amb `setattr` fins que les declaracions de
columna passin completament a `Mapped[]`.

El WebSocket de col·laboració importa el mateix servei tipat d'identitat que
HTTP. La política d'autenticació, i no la disponibilitat de mòduls opcionals,
determina si cal una credencial: el mode personal continua sense obstacles i
el mode d'organització i els clients PAT comparteixen resolutor. Tancar abans
de l'acceptació continua indicant una infracció de política, i les claus de
sala conserven l'espai de noms del vault.

## Model d'autorització

```mermaid
flowchart LR
    Identity["Identitat de sessió o PAT"] --> Member["Pertinença a l'espai de treball"]
    Member --> Role["viewer < editor < admin < owner"]
    Member --> Access["Accés al vault"]
    Role --> Decision["Decisió de capacitat de la ruta"]
    Access --> Decision
    Decision --> Context["Espai de treball vinculat i vault actiu"]
```

Els rols proporcionen capacitats bàsiques ordenades. VaultAccess restringeix o
concedeix accés a un vault registrat. Mai no es confia en un identificador
d'espai de treball, usuari o vault aportat per una petició sense resoldre la
identitat autenticada i les pertinences.

La inicialització d'espais de treball és segura davant de concurrència: les
primeres peticions simultànies no creen espais, usuaris ni pertinences
predeterminats duplicats. Els comptes provisionals i creats automàticament
es marquen explícitament; el registre no pot reclamar-los utilitzant el correu
electrònic com a prova feble d'identitat.

La resolució del context de l'espai de treball manté estable la dependència
pública de FastAPI, mentre que funcions separades gestionen la pertinença, el
filtratge de vaults accessibles, la ruta d'emmagatzematge i les capacitats. Això
fa explícites les decisions d'autorització sense canviar capçaleres, codis
d'estat ni el comportament del vault actiu.

La identitat del vault, el slug, la ruta antiga opcional i la data de creació
utilitzen mapatges tipats SQLAlchemy, preservant les columnes i migracions
existents. El middleware canònic concreta l'identificador o slug com a cadena
abans de publicar el context. L'exportació de plantilles revalida la ruta antiga
anul·lable al límit del sistema de fitxers i retorna la resposta establerta de
recurs no trobat en lloc de construir un `Path` a partir de configuració absent.

L'API d'administració d'espais de treball converteix rols de pertinença antics
i descriptors de permisos JSON en valors concrets a la frontera ORM. Les
mutacions de rol i accés al vault utilitzen assignacions acotades segures per
als descriptors, preservant les pertinences, la normalització d'invitacions
i els esquemes de payload existents.

## Compartició pública

Un enllaç compartit és una fila opaca que vincula pàgina, espai de treball,
vault, creador, permís, caducitat i revocació. `/s/:token` queda expressament
fora de l'estructura autenticada del frontend. El resolutor públic del backend
utilitza la identitat desada del vault perquè una petició anònima no té galeta
ni capçalera de vault actiu.

La revocació és lògica per conservar el registre d'auditoria. Els enllaços
caducats o revocats no revelen contingut de pàgina. La resolució pública de
recursos hereta el mateix àmbit de compartició i no accepta rutes arbitràries.

El límit de rutes de compartició tipa la serialització, la resolució de rutes
de vault, les mutacions ORM i totes les respostes. Models Pydantic amb nom
validen els mapatges de crides directes abans de serialitzar-los; els registres
de compatibilitat desactiven explícitament la publicació de models de resposta
per preservar OpenAPI. Els identificadors de múltiples vaults es resolen en
rutes concretes abans d'activar el context de pàgina; la configuració absent
manté l'alternativa recuperable i la resposta de servei no disponible existents.

La configuració d'identitat de cada vault utilitza models Pydantic separats
per a peticions i lectures antigues. Els camps històrics desconeguts sobreviuen
a les lectures, les escriptures atòmiques conserven el perfil i les respostes
d'èxit es validen abans de retornar el mapatge directament indexable.

El llistat, la creació, el canvi de nom i l'eliminació de múltiples vaults
personals construeixen models de resposta Pydantic imbricats explícits. Els
slugs, els valors antics anul·lables, la selecció activa i els justificants
d'eliminació conserven la forma original de diccionari. El confinament de rutes,
la protecció del vault principal i la neteja d'artefactes no canvien.

## API pública

Les rutes autenticades amb PAT apliquen els àmbits del token i l'autorització
normal d'espai de treball i vault. El text en clar del token només es mostra
en crear-lo. Revocar-lo impedeix usos futurs sense eliminar la fila d'auditoria.
La façana pública tipada actualitza marques temporals ORM a través del límit
dels descriptors, confina les escriptures Markdown antigues al vault actiu i
encamina els registres configurats de Web Clipper pel flux normal de creació
de pàgines. Els resultats de token, ping, pàgina, configuració del clipper i
captura passen per models Pydantic amb nom i conserven la forma històrica de
diccionari o llista. El registre explícit `response_model=None` manté els
esquemes FastAPI idèntics byte a byte fins a la PR coordinada de contractes
OpenAPI i client.

## Invariants

- La identitat, la pertinença a l'espai de treball, el rol, l'accés al vault i
  l'operació demanada participen en l'autorització.
- Les galetes són HttpOnly; el frontend no necessita llegir el JWT.
- Els hashes de contrasenyes i tokens són unidireccionals.
- Un `X-User-ID` aportat pel client no pot esdevenir una via de creació de
  comptes ni d'escalada de privilegis.
- El contingut compartit públicament queda limitat a la pàgina i el vault desats.
- La comoditat del mode personal no pot debilitar un desplegament multiusuari exposat.

## Aspectes que cal verificar

Executeu proves de control central, indicador d'autenticació obligatòria,
comptes, comptes provisionals, majúscules del correu, contrasenyes, PAT,
superfície pública, respostes tipades directes, concurrència d'espais de treball,
pertinences i compartició. La QA al navegador comprova l'accés i la sortida,
les actualitzacions de compte, el canvi d'espai de treball i l'accés anònim
als enllaços compartits en una sessió neta.

Resoldre una biblioteca registrada és una operació de lectura. Si la carpeta falta, la identitat no està disponible i les rutes canòniques retornen 404; les peticions no recreen el camí antic. La creació explícita de carpetes continua al flux de creació de biblioteques. Triar una altra carpeta existent conserva les dues identitats i les seves rutes.

## Formularis públics de taula

`domains/forms/` publica preguntes explícites d'una taula registrada. GET anònim `/api/forms/public/{token}` retorna aquest esquema; POST `/submissions` valida cada camp i crea la pàgina mitjançant el procés canònic idempotent. Les fórmules, relacions i metadades reservades no són modificables. Un canvi incompatible d'esquema desactiva el formulari. El complement `share-links` regula la publicació i l'accés.

Formularis i reserves utilitzen `public_workflow_scope.py` per fixar espai, vault i propietari i comprovar de nou pertinença, escriptura, emmagatzematge i complements. Les galetes, capçaleres i paràmetres del visitant no seleccionen el destí. Les respostes són `no-store`; les pàgines públiques no envien referent ni s'indexen. El client públic omet credencials i capçaleres de l'espai. La migració `mgmt_0006` afegeix definicions i rebuts persistents sense modificar els registres existents.

La publicació d’un formulari exigeix una vigència d’1 a 365 dies (30 per defecte). Cada token nou desa una data de venciment; si falta o ja ha passat, es rebutgen tant les consultes com les respostes. El propietari pot revocar l’enllaç abans que caduqui.

El paquet del backend inclou `management_0006.py` entre els recursos revisats perquè les instal·lacions d’escriptori puguin aplicar la mateixa migració d’esquema per als formularis públics i les reserves.

Les migracions de gestió segueixen una única seqüència: `mgmt_0006` afegeix formularis i reserves; `mgmt_0007` hi afegeix previsualitzacions, llocs i revisions de publicació. Totes dues s’inclouen als recursos del backend d’escriptori. Les bases noves i les actualitzacions conserven els dos esquemes i les dades existents. Una base incompatible amb la mateixa etiqueta de revisió es rebutja per l’empremta exacta de l’esquema abans de modificar-la; l’etiqueta sola no n’autoritza l’adopció.

## Publicació al web de proves

El diàleg de compartició ofereix **Publica al web** per a un web de proves configurat per l’administrador. L’API `/api/vault/web-publishing` requereix un editor resolt per la política central d’identitat i el connector de compartició. Una instal·lació personal nativa de confiança utilitza el propietari desat sense crear credencials; les instal·lacions d’organització, exposades o amb autenticació obligatòria continuen requerint autenticació. Cada petició de publicació inclou la precondició obligatòria `X-Gnosi-Web-Expected-User-ID`: el servidor la compara amb el compte ja resolt i rebutja qualsevol discrepància abans d’executar el controlador. Aquesta capçalera no pot triar la identitat i és independent de la precondició de compte autenticat d’altres operacions. El servidor resol el vault autoritzat i executa únicament el controlador Python configurat, amb entrada JSON, entorn mínim i un límit de 60 segons per consultar l’estat i de 600 segons per a les accions de publicació. Cap petició pot canviar el vault, l’executable o el destí de producció. `GNOSI_WEB_PUBLISH_DRIVER` defineix la ruta absoluta `.py`; `GNOSI_WEB_PUBLISH_PYTHON` pot definir l’intèrpret. Per defecte s’utilitza `python3` del PATH, mai l’executable empaquetat de l’aplicació.

Les incorporacions, actualitzacions i retirades es trien explícitament. Les altres pàgines publicades es conserven i les traduccions apareixen a la revisió. Publicar consumeix una previsualització d’un sol ús vinculada al compte, espai de treball i vault. Els canvis d’àmbit cancel·len les peticions i eliminen les dades privades de la interfície. Canviar la selecció o trobar una previsualització caducada exigeix una revisió nova. L’historial permet restaurar versions de proves; Drupal continua en producció.

El butlletí mostra les subscripcions pendents, actives i de baixa, els idiomes i l’historial. El contingut del butlletí admet els idiomes del web `ca`, `es` i `en-gb`, independentment de l’idioma de la interfície. La previsualització HTML està aïllada i sense accés a la xarxa. Només s’accepta `test_mode: true`: la cua desa missatges al registre de proves sense enviar correus reals. Les previsualitzacions caduquen als 15 minuts o en reiniciar el servidor. Cancel·lar al navegador no desfà una publicació iniciada; cal actualitzar l’estat abans de repetir una acció incerta.

## Fonts de contingut dels webs i catàleg del butlletí

**Afegeix una font** obre el selector compartit de cerca i selecció única de
taules, vistes i pàgines. Cada opció mostra el tipus localitzat i el títol;
els registres importats no són fonts seleccionables. Obrir o cancel·lar el
selector no crea cap font. L'elecció explícita entra al desament automàtic
existent amb la publicació desactivada, sense camps públics ni adjunts triats
i amb la inclusió del cos desactivada. Aquestes fonts de contingut es trien
independentment dels [controls de tipografia](integrations-plugins.md).

El contingut disponible del butlletí s'ordena per data de creació descendent,
a partir de les metadades públiques `presentation.created` de la versió activa,
després d'eliminar duplicats i continguts retirats. S'accepten marques de temps
numèriques i dates ISO; les dates sense zona horària utilitzen UTC. Les dates
absents, invàlides o no finites van al final i els empats conserven l'ordre de
la versió. Això no llegeix dades del vault sense publicar, no afegeix camps
privats a l'API, no modifica la versió ni reordena les pàgines triades
explícitament a l'esborrany. Els elements exportats sense data pública
conserven el seu ordre relatiu al final del catàleg.
