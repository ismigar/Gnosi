# Directiva: Migració d'enllaços locals (/api/vault/local-file/<token> → file://)

## Motivació

Quan un usuari insereix un fitxer del disc local al Vault des d'`InsertContentModal`, el modal sempre crida `POST /api/vault/local-file/register`, que retorna una URL servida pel backend (`/api/vault/local-file/<token>`). El frontend desa aquesta URL al markdown del document. Resultat:

- En mode `block`/`frame` (imatge, vídeo, PDF en `<iframe>`): correcte — el navegador ha de poder llegir el binari per renderitzar inline.
- En mode `link`: **incorrecte** — l'usuari espera obrir el fitxer amb l'aplicació nativa (Preview, Word…). El navegador, però, segueix la URL i o bé descarrega el fitxer o bé navega a la SPA (que sense match per `/api/vault/local-file/...` retorna a la pàgina actual → efecte "nova finestra amb el mateix dashboard").

L'opció de coexistir dos formats (`file://` per a links nous + `/api/vault/local-file/` per als antics) tractats per `useFileLinkInterceptor` perpetuaria un disseny dual al disc. Optem per **un sol format al disc**:

- `file://` per a enllaços que l'usuari vol obrir amb l'app nativa (mode `link`).
- `/api/vault/local-file/<token>` només per a `block`/`frame` (incrustació del binari pel navegador).

Així `useFileLinkInterceptor` queda focal i `local_file_links.json` només recull tokens que realment es serveixen com a binari.

## Abast de la migració

Recórrer tots els fitxers `.md` del Vault i, per cada enllaç markdown amb forma `[text](/api/vault/local-file/<token>)` o `[text](<...local-file...>)` que **NO** sigui dins un `![image]` ni dins un bloc de tipus media (frame/block), resoldre el token al path original via `local_file_links.json` i reescriure-ho com `[text](<file:///path>)`.

## Restriccions i Edge Cases

- **No tocar embeds:** els enllaços de tipus `![nom](/api/vault/local-file/<token>)` (imatges/vídeos) s'han de conservar tal qual. La migració només toca enllaços `[text](...)` sense `!` davant.
- **No tocar blocs media de BlockNote:** si el BlockNote serialitza certs media com a blocs `image`/`video`/`pdf` amb una URL `/api/vault/local-file/...` dins un atribut, també s'han de conservar. La migració només actua sobre la sintaxi markdown plana `[text](url)`.
- **Token no resoluble** → log warning i deixar el link intacte. No destruir mai el text de l'usuari.
- **Path original ja no existeix** → log warning però *sí* reescriure el link (el `file://` és vàlid encara que el fitxer s'hagi mogut; serà l'usuari qui corregeixi).
- **Backup per fitxer abans d'escriure**: el script desa una còpia `<file>.bak-<timestamp>` només la primera vegada que toca el fitxer en una execució (idempotent: si el fitxer no canvia, no es genera backup nou).
- **Sense canvis = sense escriptura**: si la migració no troba cap match al fitxer, no es toca (preserva mtime per a Spotlight/OneDrive).
- **Dry-run per defecte**: el script no escriu sense el flag `--apply`. El dry-run imprimeix tots els canvis previstos amb el path origen i el path destí per a revisió manual.
- **CommonMark angle brackets**: si el path té espais o non-ASCII, embolicar amb `<...>` (`[text](<file:///path with spaces.docx>)`). Si no, deixar nu. Vegeu `markdown-mapper.js:516-532`.
- **Execució dins el contenidor backend**: el script accedeix a `/app/data/local_file_links.json` i al Vault muntat dins el contenidor. Cal executar-lo via `docker exec gnosi_backend python /app/...`. Així evitem problemes de permisos al volum Docker i resolució de paths.
- **Idempotent**: una segona execució no fa res perquè ja no quedaran tokens `/api/vault/local-file/` al markdown.

## Decisions concretes

- **Eliminació de tokens migrats de `local_file_links.json`**: NO de moment. La taula la podrà netejar una segona passada quan validem que cap markdown referencia el token. Si l'eliminem ara i un .md amb referència residual es perd a la migració, trenquem el link.
- **Locale/encoding**: els paths poden tenir UTF-8 i accents. Tot el procés s'ha de fer en UTF-8 nadiu (Python `open(..., encoding='utf-8')`).
- **No tocar fitxers fora del Vault**: limitar la cerca a `get_p("VAULT")`. Mai recórrer fora.

## Test plan

1. **Pre-condició**: identificar 1–2 markdowns amb el patró `/api/vault/local-file/<token>`. Si no n'hi ha cap a producció (només els 9 tokens existeixen però potser sense referenciats vius), inserir manualment 1 link en mode `link` abans del fix per generar un cas de prova.
2. **Dry-run**: executar el script amb la sortida esperada (llistar candidats).
3. **Apply**: executar `--apply`, comprovar que els .md tenen `<file:///...>` i que el backup `.bak-<ts>` existeix.
4. **Smoke test al frontend**: obrir el dashboard, clicar l'enllaç migrat → ha d'obrir amb Preview/Word (no download ni nova finestra del dashboard).
5. **Idempotència**: tornar a executar `--apply` → 0 canvis.

## Històric de Lliçons Apreses

- **2026-05-17 — Mount HOME ro al backend**: `gnosi_backend` munta `/host_mnt/Users/ismaelgarciafernandez` en mode `ro`. Si el script usa la env `VAULT_PATH` (que apunta al path del host dins HOME), `read_text` funciona però `write_text` falla amb `Errno 30 Read-only file system`. Solució: cridar amb `--vault /vault` (el mount específic del Vault sí és `rw`). El default del script (`os.environ.get("VAULT_PATH", "/vault")`) ha de tenir prioritat invertida — millor `/vault` per defecte i `VAULT_PATH` només com a override explícit. *Pendent d'aplicar al script.*
- **2026-05-17 — Errno 35 a fitxers online-only**: alguns `.md` (Contacts/*, agent/instructions/*) no es poden llegir per "Resource deadlock avoided" perquè OneDrive no els ha materialitzat. El script els log com a warning i continua. Si calgués una passada exhaustiva, caldria warmup proactiu via `files_provider.materialize()` abans del `read_text`. Acceptable per a aquest one-off: els fitxers que tenien matches eren tots a `BD/Cervell Digital/Bitacora/`, ja materialitzats.
- **2026-05-17 — Execució**: 8 substitucions a 3 fitxers, 0 tokens orfes, 9 tokens al `local_file_links.json` (1 token sense referències al markdown — orfe). Idempotència confirmada a la segona passada (0 canvis).
- **2026-05-17 — ReactMarkdown sanititza file://**: Al `FeedItem` del `DbViewEmbed.jsx` el body del registre es renderitza amb `<ReactMarkdown urlTransform={wikilinkUrlTransform} />`. La funció `wikilinkUrlTransform` només preservava el sentinel de wikilinks (`gnosi-wikilink:`) i delegava la resta al `defaultUrlTransform` de react-markdown, que **buida els hrefs `file://` a `""`**. Resultat: l'`<a href="">` clicat al feed navegava a la URL de la pàgina actual → s'obria una "nova pestanya amb el mateix dashboard Bitàcora". El `useFileLinkInterceptor` no podia agafar-ho perquè l'href arribava al DOM ja sanititzat. Fix: ampliar `wikilinkUrlTransform` per preservar també `^file:\/\/` (DbViewEmbed.jsx:41-52). Sense aquest fix, la migració del .md a `file://` no era suficient.
- **2026-05-17 — MutationObserver subtree saturava el thread principal**: `useFileLinkInterceptor` tenia una segona capa (CAPA 2) que normalitzava cada `<a href="file://…">` aparegut al DOM (afegia `target="_self"`, treia `rel`, posava listeners directes) via `MutationObserver` amb `childList: true, subtree: true, attributeFilter: ['href']` sobre `document.body`. En obrir una pàgina amb molts blocs (60+) i 4 enllaços file://, BlockNote/ProseMirror emetia una allau de mutacions al render inicial; el batching amb `queueMicrotask` no compensava el cost de `scanRoot(node)` (O(M*N) per subarbre) i Chrome marcava la pestanya com "Pàgina que no respon" abans que el contingut fos visible. Eliminada la CAPA 2 sencera: la CAPA 1 (listener a `window`/`document` en capture phase) és per si sola suficient — en capture phase els handlers de `window` són els primers a executar-se, immunes a `stopPropagation` de tercers. La justificació original de la CAPA 2 ("resistent a stopPropagation tercer") era incorrecta perquè `stopImmediatePropagation` no afecta handlers que ja s'han disparat abans en la cadena. Regla a recordar: evitar `MutationObserver` amb `subtree:true` sobre tot el body si BlockNote o un altre editor ric està dins; el cost es paga a cada render.
