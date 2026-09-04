# Directiva: càrrega inicial de Knowledge

## Objectiu

Reduir dràsticament els recursos i bytes descarregats en obrir `/@principal/knowledge`, sense alterar la UX, les rutes ni els contractes de dades.

## Abast

- Perfilar el graf d'importacions i la càrrega real de la ruta Knowledge.
- Convertir les pàgines de feature en fronteres de càrrega diferida reals.
- Carregar inicialment només el catàleg de l'idioma actiu.
- Afegir proves de regressió per a rutes i idiomes.
- Validar amb typecheck, lint, proves enfocades, build i una mesura de navegador local.

## Procediment

1. Capturar una línia base reproduïble: nombre de recursos, bytes transferits, fitxers de traducció i mòduls grans.
2. Identificar imports estàtics que travessen fronteres de ruta o índexs que reexporten features sencers.
3. Fer que cada ruta importi directament i de manera diferida el seu component de pàgina.
4. Separar el registre lleuger de locales dels catàlegs pesants i resoldre el locale actiu abans d'inicialitzar i18next.
5. Preservar el canvi d'idioma en calent carregant el catàleg sol·licitat abans d'activar-lo.
6. Repetir exactament la mesura inicial i comparar recursos, bytes i catàlegs carregats.
7. Dins de Knowledge, mantenir el shell, la navegació lateral i la vista de benvinguda al chunk de ruta; carregar editor, lector PDF, vistes de taula especialitzades i diàlegs només quan el seu estat els fa visibles.

## Restriccions i casos límit

- No tocar backend, OpenAPI, dades personals ni serveis externs.
- No canviar URLs, textos visibles, fallbacks, detecció d'idioma ni navegació.
- No importar índexs agregadors des del router: poden executar tots els features encara que exportin components `lazy`.
- No usar glob eager per als JSON de traducció. Cal mantenir loaders dinàmics explícits i validats.
- El locale desat pot tenir regió o majúscules diferents; cal normalitzar-lo amb el mateix registre canònic abans de carregar-lo.
- Si el catàleg sol·licitat falla, cal conservar un fallback local conegut i no deixar la UI sense recursos.
- Les proves han de demostrar que l'arrencada no sol·licita catàlegs no actius i que canviar d'idioma en carrega només el necessari.
- Nota: no executar una instal·lació offline completa assumint que el magatzem pnpm conté tots els tarballs, perquè pot fallar amb `ERR_PNPM_NO_OFFLINE_TARBALL`. En un worktree aïllat sense xarxa, cal reutilitzar una còpia local de les dependències canòniques ja verificades i mantenir-la fora del commit.
- Nota: no activar `onlyExplicitManualChunks` en aquesta base, perquè Vite 8/Rolldown el rebutja com una opció de sortida invàlida. Cal retirar els agrupaments manuals que converteixen un vendor diferit en dependència estàtica de l'entrada.
- Nota: Chromium headless pot fallar dins del sandbox de macOS amb `MachPortRendezvousServer: Permission denied`. Cal executar només el procés de navegador amb permís local ampliat i bloquejar explícitament qualsevol host que no sigui loopback.
- Nota: `vite preview` pot rebre `listen EPERM` dins el sandbox de macOS. Cal iniciar-lo amb autorització local abans d'interpretar un `ERR_CONNECTION_REFUSED` del perfilador.
- No considerar `networkidle` una condició obligatòria: Gnosi pot mantenir polling o WebSockets.
- No confondre la primera compilació sota demanda de Vite amb latència estable. Cal mesurar càrrega freda, càrrega calenta i build de producció.
- No ampliar timeouts per ocultar consultes lentes; cal mesurar la petició concreta i corregir-ne el propietari.
- No registrar payloads, textos de pàgines, credencials ni contingut del vault durant el perfilat.
- Nota: no renderitzar un component `lazy` tancat esperant que el seu `isOpen` eviti la descàrrega; React resol el mòdul tan bon punt el component entra a l'arbre. Cal condicionar el muntatge de la frontera `lazy` des del pare lleuger.
- Nota: no interpretar un lint global sense sortida que no finalitza com un resultat vàlid. Cal interrompre'l, validar tots els fitxers modificats de forma explícita i repetir el lint global en la integració canònica, on les dependències no són una còpia temporal del worktree.
- Nota: no deixar que diversos muntatges inicials consultin directament el mateix recurs. Cal compartir la clau i la promesa en curs, separar les claus dependents del vault i fer que la cancel·lació d'un consumidor no cancel·li els altres.
- Nota: no confondre coalescència amb una cache immutable. Els canvis de vault i els refrescos explícits han d'invalidar la clau corresponent abans de tornar a consultar.
- Nota: no executar el binari de Vitest del frontend des de l'arrel del repositori, perquè no carregarà la configuració jsdom del paquet i les proves d'emmagatzematge fallaran falsament. Cal executar-lo amb `frontend/` com a directori de treball.
- Nota: no introduir `QueryClient.fetchQuery` en la versió actual de TanStack, perquè està deprecat i el lint estricte ho rebutja. Cal usar `QueryClient.query` per compartir consultes imperatives.
- Nota: no comptar imports dinàmics repetits a les façanes públiques i al router com
  si fossin chunks diferents. El contracte de composició ha de comparar el
  conjunt de destinacions úniques i continuar exigint la llista exacta.
- Nota: no assumir que `i18n.t` sempre retorna text durant la composició de
  catàlegs purs; una prova o arrencada anterior a la inicialització pot retornar
  un valor buit. Les etiquetes de comandes han de preservar un fallback textual
  explícit abans de filtrar-les o convertir-les a minúscules.
- Nota: no serialitzar catàleg de vaults, idioma i preload de la ruta abans de
  muntar React. Són inicialitzacions independents després de sincronitzar la
  cookie activa i s'han d'esperar amb una única barrera paral·lela. En una
  mesura de producció real, la serialització deixava React sense muntar fins al
  segon 2,05 i Knowledge utilitzable entre 2,5 i 3,9 segons.
- Nota: no exportar el preloader des del mateix fitxer que els components de
  ruta, perquè `react-refresh/only-export-components` deixa de garantir Fast
  Refresh. Els carregadors compartits pertanyen a un mòdul pur separat.
- Nota: per executar scripts d'un paquet des de l'arrel cal usar
  `pnpm --dir <paquet> exec <binari>`; `pnpm --dir <paquet> <binari>` intenta
  resoldre el nom com una ordre recursiva i no executa la prova.
- Nota: no invocar scripts arrel de `pnpm` des d'un worktree que reutilitza
  `node_modules` mitjançant un enllaç simbòlic: el verificador de dependències
  pot intentar purgar-lo i avortar amb `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`.
  Cal executar el generador Python i el binari frontend ja instal·lat de manera
  directa, sense reinstal·lar ni alterar les dependències canòniques.
- Nota: no executar el binari `vite build` des de l'arrel encara que el binari
  sigui el correcte: Vite resol `index.html` respecte del directori de treball.
  Cal executar-lo amb `frontend/` com a directori de treball.
- Nota: no carregar `GET /api/vault/pages` per construir el shell inicial. El
  contracte existent `GET /api/vault/sidebar/summary?compact=true` conserva
  jerarquia, classificació, favorits, etiquetes i icones, mentre les pàgines i
  taules completes es demanen quan s'obren. La projecció ha de continuar sent
  optativa: sense `compact=true`, els consumidors 2.x reben les metadades
  completes com abans.
- Nota: el catàleg compacte no és suficient quan l'editor està obert, perquè
  relacions, suggeriments de propietats i planificació consumeixen camps d'altres
  registres. En obrir una nota cal carregar en paral·lel el document individual
  i el catàleg complet; a partir d'aquell moment, els refrescos han de continuar
  usant el catàleg complet. No s'ha de pagar aquest cost a la vista de benvinguda.
- Nota: les façanes de Brain i de configuració de plugins consulten el mateix
  document `llm-wiki/config`. Han de compartir una sola clau TanStack per vault
  i la mateixa promesa en curs; guardar-les sota claus o wrappers independents
  duplica la petició inicial. Les mutacions han d'invalidar aquesta clau.
- Nota: el propietari compartit d'una consulta OpenAPI no ha de degradar el
  resultat a `ApiResult<unknown>`: això impedeix que les façanes generades
  demostrin el seu contracte en TypeScript estricte. Cal conservar el tipus de
  resposta generat i deixar que cada façana n'apliqui la validació pròpia.
- Nota: no afegir `@pytest.mark.asyncio` a proves backend d'aquest repositori:
  la configuració de marcadors estricta no el declara i la col·lecció falla.
  Per a una corutina pura i acotada, cal executar-la amb `asyncio.run` des d'una
  prova síncrona.
- Nota: filtrar només `metadata` no elimina el cost lineal dels camps estructurals
  buits repetits a cada pàgina. La projecció inicial 3.0 ha de poder ometre de
  manera optativa valors `null`, col·leccions buides i defaults (`false` i cadena
  buida), mantenint `id`, `title` i `last_modified`; els paràmetres antics han de
  conservar exactament la resposta anterior. El client ha de reconstruir els
  defaults a la seva frontera tipada, no repartir objectes parcialment tipats per
  la UI.
- Nota: un `React.lazy` global no és diferit si el component es munta encara que
  visualment retorni només el botó tancat. El shell ha de renderitzar un
  llançador autònom i lleuger, i importar el controlador, transport i vistes
  d'Agent només després d'una acció explícita. El xat incrustat continua usant
  directament el component complet.
- Nota: no barrejar una projecció sparse amb el model de resposta legacy: la
  serialització de FastAPI torna a materialitzar camps amb defaults i anul·la
  l'estalvi, o bé el JSON deixa de complir l'OpenAPI. Cal exposar un endpoint
  additiu amb model sparse explícit i `exclude_none`, i mantenir intacte el
  resum anterior.
- Nota: el model sparse no pot estrènyer les claus de metadata a `str` mentre
  l'índex preserva frontmatter YAML amb claus `object`. Ha de reutilitzar el
  contracte `IndexedPageMetadata`; la conversió JSON continua sent
  responsabilitat de la frontera HTTP existent.

## Criteris d'acceptació

- Knowledge conserva el mateix resultat visual i funcional.
- La càrrega inicial descarrega un únic `translation.json`.
- Les pàgines no actives no formen part del graf inicial de Knowledge.
- Typecheck, lint, proves enfocades i build passen.
- Les mesures abans/després queden documentades i són reproduïbles.
- La vista inicial no descarrega el chunk complet d'Agent abans d'obrir el xat.
- La resposta compacta sparse és optativa, restaura defaults al client i no
  modifica la forma dels consumidors legacy.

## Resultat verificat

- El graf JS estàtic de producció baixa de 3.300.047 a 571.891 bytes, un 82,7% menys.
- La navegació equivalent a Knowledge amb Chromium i APIs fictícies baixa de 2.047.554 a 1.776.243 bytes transferits, un 13,3% menys, i de 6.886.447 a 6.034.661 bytes descomprimits.
- La prova de navegador carrega un únic catàleg actiu (`ca`); abans els quatre catàlegs estaven incrustats a l'entrada.
- Editor, calendari, PDF i dibuix deixen de ser dependències estàtiques d'arrencada.
- El nombre d'assets de la ruta completa es manté en 157 perquè Knowledge continua necessitant els seus components i icones; la millora és en bytes i en evitar codi d'altres rutes.

## Resultat de la divisió interna de VaultDashboard

- El chunk minificat de `VaultDashboard` baixa de 2.038.744 a 158.440 bytes, un 92,2% menys.
- Editor, Zotero, dibuix, taules i configuració queden en chunks independents i només es resolen quan la vista corresponent és activa.
- Els diàlegs de cerca, presentació, traducció, IA, esquema, comentaris i compartició no es descarreguen mentre estan tancats.
- El guardrail de build limita el chunk inicial de Knowledge a 200.000 bytes perquè una regressió no torni a incorporar funcionalitats diferides.

## Resultat del bootstrap paral·lel

- Catàleg de vaults, idioma actiu i chunk inicial de Knowledge comparteixen una
  única barrera paral·lela després de sincronitzar la cookie del vault.
- En cinc navegacions sobre el build de producció i el backend real, les
  càrregues estables baixen de 2,5–3,9 segons a 1,49–2,01 segons.
- Una primera arrencada amb procés Chromium i caches completament fredes encara
  pot arribar a 6,15 segons; s'ha de registrar separadament de la latència
  estable i no es pot ocultar ampliant el pressupost de navegació.
- El chunk inicial de Knowledge continua en 158.455 bytes i no incorpora cap
  altra ruta de forma eager.

## Resultat de la projecció inicial de pàgines

- Corpus determinista de 1.000 pàgines sintètiques amb camps d'usuari grans:
  el payload complet ocupa 3.953.340 bytes i la projecció compacta 369.450
  bytes; s'eviten 3.583.890 bytes, una reducció del 90,65%.
- La vista de benvinguda fa una sola petició a
  `/api/vault/sidebar/summary?compact=true` i no demana `/api/vault/pages`.
- En obrir una nota es mantenen, en paral·lel, el detall complet
  `/api/vault/pages/{id}` i el catàleg complet `/api/vault/pages`, perquè les
  relacions i els suggeriments de propietats conservin totes les metadades.
- Les dues façanes inicials de `llm-wiki/config` comparteixen una sola petició
  física per vault mentre la dada és vigent.
