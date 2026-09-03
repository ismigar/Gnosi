# Directiva: latència de la llista de pàgines del vault

## Objectiu

Mesurar i reduir la latència real de `GET /api/vault/pages` en vaults grans sense llegir, registrar ni mostrar contingut personal, mantenint els contractes públics 2.x i el comportament segur en mounts macOS File Provider.

## Abast

- Treballar exclusivament en un worktree aïllat creat des del repositori canònic Gnosi i de la base autoritzada.
- Instrumentar per fases amb fixtures temporals sintètiques: cache de resposta, registre, índex, comprovació d'entrades, construcció de models i serialització HTTP.
- Comptar operacions de filesystem, parseigs i reconstruccions; no registrar rutes, títols, metadades ni cossos reals.
- No modificar frontend ni OpenAPI.

## Procediment

1. Confirmar SHA base, branca i arbre net.
2. Construir un benchmark determinista amb milers d'entrades sintètiques i una variant de filesystem lent que simuli File Provider.
3. Mesurar una petició freda, una petició immediata i una petició posterior a l'expiració de la cache curta.
4. Localitzar scans, `stat`/`exists`, parseig de registre i construcció/serialització repetits.
5. Fer la mínima correcció que mantingui la detecció eventual de canvis externs i la invalidació immediata dels canvis fets per Gnosi.
6. Afegir proves de regressió funcionals i de comptatge d'operacions, sense llindars temporals fràgils com a única garantia.
7. Repetir mesures, Ruff, mypy estricte, tests enfocats i guardrails abans del commit.

## Restriccions i casos límit

- No usar el vault personal per perfilar contingut. Si es valida el runtime real, limitar-se a temps agregats, codis HTTP, bytes i comptatges.
- No forçar materialització ni obrir fitxers online-only. Les comprovacions massives `exists`/`stat` sobre `~/Library/CloudStorage` poden bloquejar-se o retornar errors transitoris.
- Una entrada no es pot eliminar per un únic error transitori de File Provider; només una absència inequívoca pot marcar-la com a obsoleta.
- La resposta cachejada ha de variar per vault, mode calendari i versió de l'índex. Els canvis interns continuen invalidant la cache explícitament; els externs s'incorporen quan acaba el refresc periòdic.
- El refresc periòdic ha de poder programar-se encara que la resposta derivada sigui una cache hit; mai ha de fer un scan síncron dins de la petició.
- No modificar payloads, rutes, codis d'estat, ordenació, deduplicació ni semàntica de filtres 2.x.
- Nota: no executar ordres Git des de l'arrel `Projectes`, perquè ja no és un repositori i produeix `fatal: not a git repository`. Cal apuntar sempre a `Projectes/Gnosi` o al worktree explícit.

## Criteris d'acceptació

- El benchmark sintètic gran mostra una reducció clara de reconstruccions i latència en peticions repetides més enllà de l'antiga finestra curta.
- Cap petició cachejada recorre o comprova individualment els fitxers del vault.
- Un canvi de versió de l'índex produeix una resposta reconstruïda i actualitzada.
- El refresc en segon pla continua programant-se amb cache hit quan correspon.
- Totes les validacions demanades passen i el commit només conté backend, proves i aquesta memòria.

## Aprenentatges

- La reconstrucció sintètica de 8.000 pàgines costava aproximadament 6,15 segons després de caducar la cache, mentre que serialitzar la resposta només costava uns 21 ms. El perfil va atribuir gairebé tot el temps a dues crides `datetime.fromtimestamp` per pàgina.
- En aquest macOS, resoldre repetidament la zona local implícita és extraordinàriament car: 16.000 conversions van costar uns 8,2 segons. Resoldre una vegada la zona IANA de `/etc/localtime` i usar-la explícitament va costar uns 52 ms i va conservar exactament el text ISO local, inclosos horaris d'estiu i hivern.
- La cache de resposta d'1,5 segons obligava a repetir tota la construcció encara que l'índex no canviés. La versió de l'índex és la frontera correcta de validesa, juntament amb la invalidació explícita dels canvis interns i el refresc periòdic dels canvis externs.
- Nota: no usar claus diferents per representar el vault en fixtures de cache i versió; pot ocultar o simular invalidacions impossibles en la composició real. Els tests han de distingir expressament la clau d'emmagatzematge intern de la clau pública retornada pel port quan vulguin provar aquesta frontera.
- Nota: no accedir a imports interns d'un mòdul de producció des de tests estrictes, perquè mypy ho considera un atribut no exportat. Cal substituir el rellotge sobre el mòdul estàndard compartit. En worktrees sense `.venv` propi, el guardrail també necessita el PATH de l'entorn canònic perquè pugui descobrir Ruff.

## Mesures verificades

- Fixture temporal de 8.000 pàgines, abans: snapshot fred 5.962,83 ms; reconstrucció després de caducar la cache 6.154,95 ms; serialització 20,84 ms.
- Perfil abans: 32.000 conversions `datetime.fromtimestamp` —dues per pàgina en dues reconstruccions— van consumir 17,79 dels 18,99 segons acumulats de `_build_pages` sota el profiler.
- Mateix fixture, després: snapshot fred 158,44 ms; reconstrucció forçada 158,96 ms; reducció del 97,4% respecte dels 6.154,95 ms.
- Endpoint FastAPI sintètic complet, després: 208,20 ms en fred i mediana de 24,85 ms en calent per una resposta de 3.163.561 bytes.
- La prova de File Provider demostra zero comprovacions `exists` síncrones per entrada; abans el camí podia executar-ne una per cadascuna quan vencia el control d'obsolescència.
