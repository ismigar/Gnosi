# Directiva: Noms de fitxer segurs per OneDrive (i Windows)

**Última actualització:** 2026-05-08

## Problema

OneDrive (i Windows) bloquegen la sincronització de fitxers el nom dels quals
conté caràcters prohibits o un format invàlid:

- Caràcters reservats: `< > : " / \ | ? *`
- Control chars: `\x00–\x1f` (inclou `\r`, `\n`, `\t`)
- Espais inicials/finals al nom
- Acabar en `.` o començar en `:`

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
   headers, títols Notion, valors d'usuari) sense passar-los per
   `sanitize_filename_component()` de `backend/utils/safe_io.py`.
2. **Mai** confiar en `.strip(...)`: si l'input pot dur control chars o
   espais barrejats amb el contingut a netejar, fes el sanejament regex.
3. La regex canònica és `r'[<>:"/\\|?*\x00-\x1f]'` → `''` + strip d'espais
   externs. Per a Message-ID concretament, també `\s+` → `''` perquè
   els headers folded poden dur whitespace al mig.

## Migració

`pipeline/sandbox/migrate_mail_filenames_2026_05_05.py` — script idempotent
que recull `Mail/*.md` amb `<` o `>` al nom, llegeix el `id:` del
frontmatter, calcula el `new_id` net amb `sanitize_filename_component`,
renomena `.md` + `.html`, reescriu el frontmatter i actualitza la taula
`mail_message_tags`. Mode dry-run per defecte.

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
