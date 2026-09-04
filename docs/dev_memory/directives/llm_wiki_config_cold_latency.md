# Directiva: latència freda de la configuració LLM Wiki

## Objectiu

Reduir la latència freda de `GET /api/vault/llm-wiki/config` sense canviar el
payload, els codis HTTP, la migració v1/v2 ni la reconciliació de l'esquema, i
sense consultar serveis externs ni inspeccionar contingut personal.

## Abast

- Lectura i migració de `<vault>/.gnosi/llm_wiki.json`.
- Investigació de la resolució compatible de la taula de referències
  heretada, sense modificar-la si no explica el perfil mesurat.
- Proves amb directoris temporals i dependències fictícies.

## Procediment

1. Separar el cost de lectura del JSON del cost de resoldre la taula heretada.
2. Mesurar la detecció de capacitats opcionals sense importar els paquets.
3. Confirmar si el fallback v1 de referències explica el perfil abans de tocar
   el seu comportament observable.
4. Preservar la resolució best-effort per a documents v1 que encara en depenen.
5. Verificar contracte, concurrència i absència d'I/O extern amb proves
   deterministes.

## Invariants

- El document normalitzat retornat és idèntic per a totes les variants v1/v2.
- Una configuració v1 sense `source_tables` encara adopta la taula de
  referències heretada amb `include_body=true`.
- Errors de lectura o de resolució heretada continuen degradant a la
  configuració per defecte, sense impedir la resposta.
- No es desa en memòria cau cap dada del vault ni es fan crides de xarxa.
- Els indicadors de mòduls opcionals conserven el mateix significat:
  disponibilitat d'importació, no importació efectiva ni inicialització.

## Restriccions i casos límit

- Nota: `get_reference_table_id()` pot inicialitzar el registre del vault, però
  forma part del contracte de migració v1 i no s'ha de canviar sense una prova
  de perfil que l'identifiqui com a coll d'ampolla i fixtures de totes les
  variants heretades. En aquest diagnòstic, la càrrega de mòduls opcionals és la
  causa reproduïble i suficient, de manera que el fallback queda intacte.
- Nota: no s'han d'importar `pypdfium2`, `docx`, `ebooklib`, `yt_dlp` o
  `faster_whisper` per construir el diagnòstic de capacitats. En particular,
  importar `faster_whisper` pot inicialitzar una pila nativa pesada i dominar
  tota la latència freda. Cal consultar l'especificació del mòdul sense
  executar-lo.
- No s'han d'incloure rutes, títols, identificadors o contingut real en proves,
  logs o benchmarks.
- Nota de QA: el mypy estricte amb seguiment complet d'importacions a la base
  `0b63cd23a` arriba a un error preexistent fora d'abast a
  `backend/api/vault_routes.py` sobre el tipus de `registry_mutation`. No s'ha
  de modificar aquest owner en aquesta correcció; cal validar estrictament els
  fitxers afectats i informar separadament del resultat global.
- Nota de QA: amb imports omesos, el mateix mypy estricte també revela setze
  retorns `Any` preexistents a adaptadors d'extracció opcionals del fitxer
  `llm_wiki_extractors.py`. No s'han d'ampliar aquests contracts en un canvi de
  latència; la funció nova i la prova han de quedar completament tipades i la
  comprovació mypy ordinària del projecte ha de passar.
- Nota: `find_spec` pot llançar una excepció davant d'un registre de mòduls
  malformat. Cal degradar a `False`, igual que feia l'antic intent d'importació,
  per no convertir el diagnòstic en un error HTTP.
- Nota d'edició: no s'ha d'inserir un helper entre la preparació i el retorn
  d'una funció existent. Això deixa el retorn dins del helper i converteix la
  resposta en `None`; cal situar el helper complet abans de la funció pública i
  repetir proves i lint immediatament.

## Acceptació

- El diagnòstic retorna els mateixos booleans sense importar cap paquet
  opcional.
- Una configuració v1 conserva exactament el fallback existent.
- Les proves enfocades i Ruff passen; el detector i la seva prova passen mypy
  estricte. Els deutes mypy preexistents queden informats separadament.
- El canvi queda en un commit separat i no es publica.
