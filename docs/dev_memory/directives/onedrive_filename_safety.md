# Directiva: Noms de fitxer segurs per OneDrive (i Windows)

**Última actualització:** 2026-07-14

## Problema

OneDrive (i Windows) bloquegen la sincronització de fitxers el nom dels quals
conté caràcters prohibits o un format invàlid:

- Caràcters reservats: `< > : " / \ | ? *`
- Control chars: `\x00–\x1f` (inclou `\r`, `\n`, `\t`)
- Espais inicials/finals al nom
- Acabar en `.` o començar en `:`
- **Noms de dispositiu reservats de Windows**: `CON`, `PRN`, `AUX`, `NUL`,
  `COM0-9`, `LPT0-9` — bloquejats amb QUALSEVOL extensió (`CON.md` també),
  perquè Windows compara el tram fins al PRIMER punt.
- **Cada SEGMENT de carpeta compta**: una carpeta que acaba en `.` o espai és
  igual d'invàlida que un fitxer.

Quan passa, OneDrive mostra un popup com "¿Cambiar el nombre de N elementos?"
i suggereix substituir per `_`.

## Cas observat (2026-05-07)

10 fitxers a `Mail/` amb noms ` <MessageID@host>_assumpte.{md,html}`. La causa
arrel és a `backend/services/imap_mail_sync_service.py:494`:

```python
message_id = msg.get("Message-ID", "").strip("<>")
```

`.strip("<>")` només elimina `<>` als extrems. Si el header IMAP retornat conté
`\r\n` o espais davant del `<` (p. ex. headers folded RFC 5322), el `<` queda
**dins** del valor i es propaga al nom del fitxer i al frontmatter `id:`.

## Política

1. **Mai** generar paths/noms a partir de strings d'entrada externa (mail
   headers, títols Notion, noms de fitxer pujats, valors d'usuari, noms de
   calendaris/contactes de Google) sense passar-los per un dels helpers
   canònics de `backend/utils/safe_io.py`:
   - `sanitize_vault_title(title, fallback, max_len)` — títol humà → base de
     nom de fitxer (SENSE slugificar: preserva accents, majúscules i espais).
   - `sanitize_rel_folder(path, fallback)` — ruta relativa `A/B/C`: saneja
     CADA segment, elimina `..`/buits (traversal) i conserva el `/`.
   - `sanitize_path_segment(value, fallback)` — un segment amb whitelist
     estricta (àlbums de media, noms de fitxer pujats).
   - `sanitize_filename_component(value)` — ids tipus Message-ID (elimina
     TOT el whitespace).
   - `guard_windows_reserved(name)` — l'apliquen tots els anteriors; útil sol
     quan el nom ja està netejat per una altra via (slugs de calendari,
     contactes).
2. **Mai** confiar en `.strip(...)`: si l'input pot dur control chars o
   espais barrejats amb el contingut a netejar, fes el sanejament regex.
3. La regex canònica és `r'[<>:"/\\|?*\x00-\x1f]'` → `''` + strip d'espais
   externs. Per a Message-ID concretament, també `\s+` → `''` perquè
   els headers folded poden dur whitespace al mig.
4. **Truncar ABANS de l'strip final**: `strip()[:N]` pot deixar el tall en un
   espai o exposar un punt com a últim caràcter. L'ordre correcte és
   `[:N].rstrip(" .")` (els helpers ja ho fan).
5. **No duplicar sanejadors inline**: l'auditoria del 2026-07-14 va trobar 6+
   còpies del mateix regex a `vault_routes`, `notion_routes`, `public_routes`
   i `agent/vault_tools`, cadascuna amb un gap diferent. Tots deleguen ara als
   helpers de `safe_io`. Tests de regressió a
   `backend/tests/test_onedrive_filename_safety.py`.

## Cas observat (2026-07-14) — auditoria completa

El clon de Notion posava el TÍTOL CRU de la BD de Notion com a carpeta física
(`notion_clone.py`: `table["folder"] = f"{tf}/{nom}"` → `mkdir`), sense cap
sanejament: un títol amb `:`/`"` trencava la sync i un `/` o `..` era path
traversal real. També: `PUT /tables` acceptava `folder` tal qual del payload,
l'importador Markdown i l'agent IA usaven whitelists que deixaven passar `\n`
interiors (via `\s`), i cap sanejador bloquejava els noms reservats de
Windows. Tot corregit delegant als helpers canònics.

## Migració

`pipeline/sandbox/migrate_mail_filenames_2026_05_05.py` — script idempotent
que recull `Mail/*.md` amb `<` o `>` al nom, llegeix el `id:` del
frontmatter, calcula el `new_id` net amb `sanitize_filename_component`,
renomena `.md` + `.html`, reescriu el frontmatter i actualitza la taula
`mail_message_tags`. Mode dry-run per defecte.

## Migració legacy (2026-07-14)

`pipeline/sandbox/scan_onedrive_invalid_names.py` — script idempotent que
recorre TOT el vault actiu (`DIGITAL_BRAIN_VAULT_PATH` o
`~/Library/CloudStorage/OneDrive-UNED/Gnosi/Principal`) i detecta, a CADA
component de ruta (fitxers I carpetes): caràcters reservats, control chars,
espai inicial, espai/punt final i noms de dispositiu reservats de Windows.
Mode dry-run per defecte; `--apply` renombra (amb `--yes` per saltar la
confirmació). Detalls:

- El nom corregit surt dels helpers canònics de `safe_io`
  (`sanitize_vault_title` amb `max_len=240` + `guard_windows_reserved`),
  importats amb `sys.path` sobre `monorepo/apps/gnosi` — NO duplica la lògica.
  Col·lisions → sufix ` (2)`, ` (3)`… (comparació case-insensitive, APFS).
- Renombra de les fulles cap a l'arrel: primer fitxers, després carpetes de
  més profunda a més soma, perquè cap rename invalidi rutes pendents.
- **Seguretat d'enllaços** (un rename podria trencar-los; el script ho evita):
  - Pàgines AMB `id:` al frontmatter → segures (els enllaços `[[Títol|id]]` i
    les relacions resolen per id, no per nom de fitxer).
  - Pàgines SENSE `id:`/`title:` → el backend usa l'STEM del fitxer com a
    identitat (`metadata.get("id") or file_path.stem`), així que renombrar-les
    canviaria el seu id i trencaria els backlinks entrants. Abans de renombrar
    un `.md` així, el script INJECTA `id:`/`title:` amb l'STEM VELL al
    frontmatter (creant-lo si no n'hi ha): la identitat es preserva literal i
    el nom de fitxer passa a ser només una etiqueta. Si el contingut és
    online-only (EDEADLK) i no es pot llegir, el rename es SALTA i es reporta.
    El dry-run mostra un «Link-safety preview» amb l'estat de cada `.md`.
  - Referències per RUTA (`![](Assets/…)`, valors de camps d'arxiu, icones a
    `.gnosi/page_meta`, dashboards) → després dels renames, el script reescriu
    totes les rutes velles (literal i percent-encoded) a tots els `.md`/`.json`
    del vault (primer les parelles de fitxer, després els prefixos de carpeta:
    l'ordre importa perquè el patró del fitxer duu la ruta ORIGINAL sencera).
- Si es renombra una CARPETA, el script reescriu els camps `folder` afectats
  de `BD/vault_db_registry.json` (entrades `databases` i `tables`, incloent
  folders de taula relatius a la seva BD). Després de QUALSEVOL rename cal
  reiniciar el backend perquè l'índex de pàgines remapi id→ruta
  (`launchctl kickstart -k gui/$UID/com.gnosi.backend`).
- **EDEADLK-safe**: l'escaneig només fa `os.scandir` (mai llegeix contingut);
  qualsevol `OSError errno 11/35` es registra com a "online-only, no
  escaneable" i continua. Si el registry mateix és dataless en `--apply`,
  avisa (materialitzar via daemon :5009) i el rename queda fet — re-executar
  amb `--apply` reintenta només el registry (idempotent).
- `.Trash` queda EXCLÒS del renombrat (es reporta a part).
- Abans d'`--apply`: **pausar OneDrive** (el script ho recorda i demana
  confirmació) per evitar conflictes de sync o que l'altre Mac ressusciti
  còpies velles a mig rename.

Primer dry-run (2026-07-14): vegeu el resultat al final d'aquesta secció un
cop executada la migració; el script es pot re-executar en qualsevol moment
com a auditoria (si el vault és net, ho diu i acaba).

## Restriccions / Edge cases

- **NO renomenar amb `mv` directament** sense passar per la migració: el
  frontmatter `id:` i la DB `mail_message_tags` quedarien desincronitzades
  i el següent `imap_to_md` reimportaria el missatge com a duplicat.
- **NO eliminar el dup** que crea la migració amb sufix `__legacy_dup1`:
  cal revisar manualment quina versió és la canònica.
- **Si OneDrive ja ha bloquejat el fitxer**, executa la migració amb
  l'OneDrive en pause (icona menubar) per evitar conflictes de rename
  durant la sincronització.
- **Reiniciar `gnosi_backend` després de patchar serveis Python**: el
  bind mount actualitza els `.py` al disc, però el procés Python ja té
  el codi vell carregat a memòria. Mentre no es reinicia, el sync IMAP
  segueix produint fitxers amb el bug. Comanda:
  `docker compose restart gnosi_backend` (o `docker restart gnosi_backend`).
  Verificació ràpida que el codi nou està viu:
  `docker exec gnosi_backend grep -n sanitize_filename_component /app/backend/services/imap_mail_sync_service.py`.

## Cas observat (2026-05-08)

2 fitxers `RE ESCRITO REVISTA CONNEXIÓ ASPACE.{md,html}` van aparèixer
de nou perquè el sync IMAP de les 17:59 i 18:32 (després del commit del
fix) va córrer encara amb el codi vell en memòria. Va caldre reiniciar
el container i tornar a executar la migració. Lliçó: el patch al codi
**no és efectiu fins al restart del procés**.
