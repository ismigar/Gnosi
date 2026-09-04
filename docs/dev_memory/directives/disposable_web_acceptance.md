# Directiva: acceptació web disposable

## Objectiu

Validar el shell web, Knowledge i els fluxos prioritaris amb Chromium, dades
sintètiques i una barrera de xarxa que impedeixi accedir a comptes, vaults o
proveïdors externs.

## Abast

- Accessibilitat WCAG automatitzada en tema clar i fosc.
- Càrrega i disponibilitat visual de Knowledge.
- Navegació prioritària a calendari, correu, contactes i Knowledge.
- Persistència del tema en recarregar.
- Contractes API sintètics explícits i executats només sobre loopback.

## Procediment

1. Executar el projecte Playwright `disposable-web` contra un frontend local.
2. Interceptar totes les peticions del context abans d'obrir cap pàgina.
3. Avortar i registrar qualsevol host que no sigui loopback.
4. Respondre cada endpoint API amb una fixture sintètica explícita.
5. Fer fallar la prova si apareix un endpoint API no declarat.
6. Esperar la superfície real de cada feature, no només el shell o l'esquelet.
7. Executar axe, comprovacions de tema i errors de pàgina, i adjuntar el temps
   fins que el document Knowledge sigui visible.

## Restriccions i casos límit

- No usar credencials, sessions, dades o fitxers personals.
- No permetre peticions externes, ni tan sols a hosts de fixtures.
- No usar un mock universal amb resposta 200: amagaria deriva de contracte.
- No considerar aquesta suite prova del backend, persistència real, proveïdors,
  migracions ni instal·ladors. És acceptació del frontend amb contractes API
  sintètics.
- El gate axe d'aquesta suite cobreix la superfície inicial de Knowledge. En
  obrir la nota sintètica s'han detectat dues incidències de producció fora de
  l'abast d'aquest canvi: l'editor Tiptap amb `role=textbox` no té nom accessible
  i el botó del corrector ortogràfic té contrast 3,28:1 en tema clar. La suite
  valida que el document s'obre i mostra contingut, però no certifica
  l'accessibilitat de l'editor fins que aquests propietaris es corregeixin.
- No usar `networkidle`; l'aplicació pot mantenir polling o WebSockets.
- No ampliar timeouts per amagar una càrrega bloquejada. La suite adjunta el
  temps fins al document visible, però no imposa un pressupost de release sobre
  un Vite arbitrari: la mesura estricta s'ha de repetir sobre build de producció.
- Nota: no executar el wrapper pnpm des d'un worktree que només enllaça el
  `node_modules` arrel, perquè la comprovació d'estat pot intentar purgar i
  reinstal·lar el workspace. Cal reutilitzar també la façana
  `tests/e2e/node_modules` i invocar directament els binaris Node/Playwright
  verificats del checkout canònic; cap enllaç temporal entra al commit.
- Nota: no engegar el binari Vite des de l'arrel del repositori sense declarar
  `frontend/` com a root. Vite usa el directori de treball, pot servir informes
  E2E com a fitxers estàtics i retornar 404 a les rutes profundes. Cal iniciar-lo
  amb directori de treball `frontend/` i verificar una ruta SPA abans de Chromium.
- Nota: no usar un `addInitScript` que imposi el tema a cada document quan es
  prova persistència, perquè també s'executa després de `reload` i sobreescriu el
  valor que la prova vol verificar. El valor inicial només s'ha d'establir si la
  clau encara no existeix.
- Nota: no donar per bona una prova de DOM si el navegador ha emès errors de
  consola. Cal recollir `pageerror` i missatges `console.error` en tots els
  escenaris. En un worktree amb dependències enllaçades, Vite pot rebutjar fonts
  resoltes fora del seu allowlist; per a evidència visual neta cal usar el
  frontend canònic verificat o una còpia local de dependències admesa per Vite.
- Nota: no invocar ESLint des de l'arrel assumint que hi trobarà configuració;
  la configuració plana és a `frontend/eslint.config.js`. Per validar fitxers E2E
  focalitzats, que són fora del `basePath` del frontend, cal executar
  `frontend/node_modules/.bin/eslint --config frontend/eslint.config.js --no-ignore`
  des de l'arrel. `pnpm --dir frontend exec eslint` els ignora encara que se li
  indiqui la configuració explícitament.
- Els callbacks Playwright que només executen una operació `void` han d'usar un
  bloc explícit; la forma abreujada incompleix `no-confusing-void-expression`.

## Criteris d'acceptació

- Cap petició abandona loopback.
- Cap endpoint API queda sense contracte sintètic explícit.
- Knowledge elimina l'esquelet i mostra el shell principal.
- Clar i fosc s'apliquen; fosc persisteix després de recarregar.
- Axe no detecta infraccions en la superfície inicial de Knowledge en els dos
  temes.
- Calendari, correu, contactes i Knowledge mostren la seva superfície real.
- La suite focalitzada i el typecheck E2E passen.

## Resultat verificat a la base `b01e8862e`

- Chromium ha executat la càrrega de Knowledge en clar i fosc, ha obert la nota
  sintètica i n'ha mostrat el contingut.
- La superfície inicial de Knowledge passa axe en els dos temes.
- Calendari, correu, contactes i Knowledge mostren la superfície real amb
  contractes sintètics explícits.
- El tema fosc persisteix després de recarregar Knowledge.
- Cap petició funcional abandona loopback i la prova negativa demostra que una
  petició `.invalid` és avortada abans del transport.
- La disponibilitat completa de Knowledge mesurada contra el Vite canònic ha
  variat entre 13,7 i 18,0 segons. El recorregut de quatre rutes ha trigat fins a
  1,3 minuts. Confirma que el mode de desenvolupament continua lent i variable;
  no és una acceptació de rendiment ni substitueix la mesura de producció.
- El gate no certifica l'accessibilitat de l'editor obert: continuen pendents les
  dues incidències de producció documentades més amunt.
- Nota: no convertir un temps de Vite en pressupost de release. La compilació
  sota demanda ha fet variar el mateix flux entre 7,3 i 18,0 segons. Cal adjuntar
  la mesura disposable per diagnòstic i aplicar el gate només al build de
  producció controlat.
