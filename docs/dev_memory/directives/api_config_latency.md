# Directiva: latència i concurrència de `/api/config`

## Objectiu

Fer que la lectura i l'actualització de la configuració no bloquegin altres
respostes del backend, sense modificar el document públic, la precedència de
configuració ni la protecció dels secrets.

## Abast

- Ruta GET i POST de la configuració general.
- Lectura de `params.yaml`, consulta d'existència de credencials, sanitització
  i escriptura atòmica.
- Memòria cau privada del document ja sanititzat, separada per vault.
- Proves amb fitxers i Keychain ficticis; mai credencials personals.

## Procediment

1. Mesurar separadament la càrrega de YAML i la sanitització amb un Keychain
   lent simulat.
2. Executar tot l'I/O síncron des d'un worker, tant al GET com al POST.
3. Consultar en paral·lel només l'existència de credencials independents durant
   la construcció del document públic.
4. Publicar una còpia profunda del document sanititzat en una memòria cau amb
   caducitat curta i clau derivada del vault actiu, sense incloure secrets.
5. Col·lapsar reconstruccions simultànies de la mateixa clau en una sola feina.
6. Serialitzar una actualització amb les lectures de la mateixa clau i
   invalidar-la només després que l'escriptura atòmica i la migració de secrets
   hagin acabat.
7. Verificar que una petició de salut concurrent respon mentre el Keychain lent
   continua treballant i que el següent GET observa una configuració actualitzada.

## Invariants

- El payload i els codis HTTP 2.x no canvien.
- Les claus `api_key` i `password` no apareixen mai al document retornat ni als
  logs.
- La precedència procés, `.env` local i fitxer compartit es conserva perquè la
  càrrega canònica continua sent `load_params`.
- Una resposta emmagatzemada mai comparteix diccionaris mutables amb el caller.
- Un error de lectura o sanitització no es desa a la memòria cau.
- Els canvis externs acaben sent visibles en caducar la memòria cau; els canvis
  fets via API la invaliden immediatament.

## Restriccions i casos límit

- Nota: no s'ha d'executar `load_params`, Keychain, YAML o `safe_write_text`
  directament dins d'una ruta `async`, perquè bloqueja totes les altres
  respostes del procés. Cal encapsular la transacció síncrona i executar-la en
  un worker.
- Nota: no s'ha de considerar que `credential_ref` prova l'existència del
  secret; això canviaria el significat de `has_api_key`. Cal consultar el
  magatzem segur i conservar el resultat booleà existent.
- Nota: no s'han de posar valors de variables de credencials a la clau de
  memòria cau, logs o mètriques. La clau només identifica el context del vault.
- Les consultes independents al Keychain poden acabar fora d'ordre; el mapa
  final ha de conservar l'ordre original dels proveïdors.
- Nota de perfilatge: no s'han d'incrustar accessos amb cometes escapades dins
  d'una expressió `f-string` executada com a línia de shell, perquè Python la
  rebutja abans de mesurar. Cal calcular els valors derivats abans de formatar.
- Nota d'E2E: `GNOSI_VALIDATION_RUNTIME=1` no desactiva el planificador. En una
  arrencada descartable cal establir també `GNOSI_DISABLE_SCHEDULER=1`, perquè
  altrament s'inicien tasques de fons encara que el vault sigui una fixture.
- Nota de QA: no s'han d'endevinar noms de suites històriques de Keychain. Cal
  inventariar primer els fitxers actuals i executar els owners reals de
  configuració, credencials i secrets.
- Nota de base: a `e85afab85`, el mypy global amb les dependències resoltes el
  4 de setembre de 2026 informa un error aliè a configuració a
  `backend/services/handwriting.py` per la crida no tipada de Transformers.
  No s'ha de modificar aquest owner fora d'abast ni presentar el global com a
  verd; cal exigir mypy estricte verd als fitxers afectats i registrar el deute
  independent.

## Acceptació

- Amb sis credencials fictícies que triguen 250 ms cadascuna, la primera
  sanitització ha d'apropar-se al cost d'una consulta i no a la suma de sis.
- Una segona lectura cachejada no ha de tornar a consultar el Keychain.
- Dues lectures simultànies de la mateixa clau fan una sola reconstrucció.
- Una petició `/api/health` concurrent no espera la lectura lenta de config.
- Un POST invalida la resposta anterior i el GET següent retorna el canvi.
- Ruff, mypy estricte, proves enfocades i guardrails passen.
