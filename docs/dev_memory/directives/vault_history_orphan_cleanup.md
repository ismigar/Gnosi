# Neteja d'historials orfes a `.history/` del vault

## Context
Cada edició de pàgina desa versions a `VAULT/.history/<page_id>/<timestamp>.md`
(i `<timestamp>.tldraw.json` per a dibuixos). Abans del PR #737, purgar una
pàgina de la paperera NO esborrava el seu directori d'historial, així que
`.history/` acumula directoris de pàgines que ja no existeixen enlloc
(«orfes»). El #737 arregla les purgues noves; els orfes anteriors s'han de
netejar una sola vegada amb `pipeline/sandbox/cleanup_history_orphans.py`.

## Procediment (SOP)
1. **Informe** (`--report`, per defecte): l'script obté els ids vius de
   `GET /api/vault/pages` i els de la paperera de `GET /api/vault/trash`
   (backend natiu `:5002`, paràmetre `?vault=<id>`), llista els directoris de
   `.history/` i calcula els orfes = dirs que no són a cap dels dos conjunts.
   Escriu `history_orphans_report.{json,md}` amb títol (frontmatter de la
   versió més recent), data de l'última versió, nombre de versions i mida.
2. **Revisió humana**: presentar la llista a l'usuari. Els orfes poden ser
   l'ÚNICA còpia de contingut esborrat per error. MAI esborrar sense
   confirmació explícita. Recuperació puntual: copiar el `.md` més recent
   al vault o restaurar via UI si la pàgina encara existís.
3. **Esborrat** (`--delete --yes`): rellegeix el backend (ids frescos),
   torna a verificar que cada id segueix orfe, fa un `tar.gz` de seguretat a
   `~/.gnosi-local/backups/` i només llavors esborra els directoris.
   `--keep <id>` exclou ids que l'usuari vol conservar.

## Restriccions / Edge Cases
- **No declarar orfe un dibuix viu** → els dibuixos tldraw NO surten a
  `/api/vault/pages`: viuen a `VAULT/Drawings/<id>.tldraw.json` (o
  `.excalidraw.json`) → comprovar-ho abans de marcar orfe un dir amb només
  `*.tldraw.json`.
- **Dirs antics amb clau = títol** → abans les versions es desaven a
  `.history/<títol>/` (p. ex. `AGENTS`, `Resum estructurat del DVA`); la
  pàgina pot seguir viva amb un uuid → l'informe té la columna
  `live_page_same_title` per detectar-ho.
- **Fitxers solts sense timestamp** → dins d'un dir pot haver-hi `.md` amb
  nom lliure → la data es calcula amb el timestamp parsejable més recent o,
  si no n'hi ha, amb l'mtime.
- **Molts orfes «amb contingut real» són ids antics** → migracions (clon
  Notion, contenidor de vaults) van re-generar ids → mateixa pàgina viva amb
  títol idèntic → l'historial vell és residu, no contingut perdut.
- **No esborrar amb dades rancies** → entre informe i esborrat poden haver-se
  restaurat pàgines → l'esborrat SEMPRE re-verifica contra el backend viu.
- **No treballar amb rutes sense contenir** → `page_id` ve del nom del dir;
  resoldre amb `.resolve()` i comprovar `parent == .history` abans de tocar
  res (símil injecció de path).
- **No usar `shutil.rmtree` directe sense còpia** → els orfes poden ser
  única còpia → sempre backup tar.gz fora d'OneDrive abans d'esborrar.
- **`.history/` també té dibuixos** → dirs amb `*.tldraw.json` i cap `.md`;
  el títol es deixa com `(dibuix tldraw)`.
- **La paperera compta** → una pàgina a la paperera és restaurable; el seu
  historial NO és orfe.
- **OneDrive** → llegir mides amb `stat` pot materialitzar fitxers online-only;
  acceptable per ~MB, no fer-ho sobre GB.
