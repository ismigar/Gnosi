# Directiva: Wikilinks de relació al frontmatter (cos net)

## Objectiu
Els camps de tipus **relation** (noms canònics amb prefix `📀`) guarden al `.md` cada ítem com a **wikilink amb l'id a l'àlies**: `"[[Títol|<uuid>]]"`. El cos de la fila deixa de portar les seccions llegades `# Camp` + `- [[Títol]]` (fòssils de l'import de Notion que ningú mantenia i quedaven desfasades en silenci). Resultat: cos net, fitxer llegible i **portabilitat Obsidian real**.

## Per què aquest format (decisió verificada 2026-06-11)
- Obsidian només reconeix un enllaç en una propietat (Text/List) quan el valor és **exactament** el wikilink entre cometes; un wikilink barrejat amb text (`uuid [[Títol]]`) NO s'indexa (ni graf, ni backlinks) — per això existeixen plugins com frontmatter-links. Font: help oficial de Properties + fòrum.
- La forma amb àlies `"[[Títol|àlies]]"` sí que és reconeguda nativament. Posant-hi l'**uuid a l'àlies**, el mateix string conté el títol navegable (Obsidian) i l'id estable (Gnosi).
- Si Obsidian renombra la nota, reescriu el target i **preserva l'àlies** → l'uuid sobreviu. El reescriptor propi (`rewrite_wikilinks_on_title_change`) també preserva àlies i opera sobre el text sencer del fitxer (frontmatter inclòs).
- Atenció cosmètica: al panell de Propietats d'Obsidian el xip mostra l'àlies (l'uuid). Al fitxer cru i a Gnosi es veu bé. És el preu de mantenir id+títol en un sol valor reconegut.

## Fluxos (fronteres úniques)
- **Llegir** (`parse_frontmatter`, vault_routes.py): per a claus `📀`, redueix `[[Títol|id]]` → `id`. Tota la resta de l'app (taula, filtres, graf, automatitzacions, syncs, registre, global-index) segueix veient **uuids nets**: cap altre consumidor s'ha de tocar.
- **Escriure** (`save_page_md`, ÚNIC camí canònic d'escriptura): després de `to_storage_names`, decora els camps relació (per esquema `type == "relation"` si hi ha taula; fallback prefix `📀`): `id` → `[[Títol|id]]` amb el títol de `_page_meta_by_id` (índex d'enllaços, amb lock). Cada desada **refresca** els títols (autocurativa contra drift).
- **Renoms**: candidats trobats per `_backlinks_by_target` (les relacions ja s'indexen perquè `_extract_outlinks_from_doc` recorre els valors del metadata); la reescriptura per regex actualitza també el frontmatter.
- **Edicions manuals a Obsidian**: si l'usuari deixa `[[Títol]]` sense àlies en un camp `📀`, en llegir es conserva tal qual; en **desar** des de Gnosi es resol per títol (si és únic a l'índex) i es canonicalitza a `[[Títol|id]]`.

## Restriccions / Edge-cases (memoritzar)
- **No exigir forma d'uuid** a l'àlies en llegir: hi ha ids llegats que no són uuid (p. ex. stems de fitxer). La clau `📀` és la porta; l'àlies és l'id, sigui quin sigui el format.
- **Títols conflictius**: si el títol conté `| [ ] # ^` o salt de línia, NO es construeix wikilink (es deixa l'id nu) — un títol alterat no resoldria a Obsidian i un de cru trencaria el YAML/parseig.
- **Índex fred**: si `_page_meta_by_id` encara no està construït (arrencada freda sense cache), la decoració degrada a id nu; la següent desada amb índex calent ho repara. Mai bloquejar una desada per construir l'índex.
- **PyYAML ja fa l'encomillat**: un valor que comença per `[` surt quotejat automàticament amb `yaml.dump`; no fer post-processat manual.
- **El parser de rescat** (`_parse_frontmatter_fallback`) ignora llistes per disseny → en mode rescat les relacions no hi són, com sempre.
- **Consumidors de YAML cru** (scripts de pipeline que no passen per `parse_frontmatter`): han d'extreure l'id de l'àlies amb el mateix patró (`[[...|id]]` exacte) abans d'usar-lo.
- **Neteja del cos**: només s'eliminen seccions el títol de les quals coincideix amb un camp relació de l'esquema (sense `📀`) i el contingut és exclusivament bullets-wikilink o línies buides; si hi ha res més, es deixa i es reporta. El bloc es captura fins al **següent heading (o EOF)**: si conté qualsevol altra cosa, la secció es conserva SENCERA (heading inclòs) — mai deixar text orfe sense el seu heading (lliçó: la primera versió capturava només bullets consecutius i hauria orfanat el text posterior).
- **`--limit` del script de migració**: limita només les files processades; el mapa id→títol es construeix SEMPRE sencer (les relacions creuen taules i fitxers).
- L'únic generador històric de les seccions del cos era `pipeline/legacy/import/notion/notion_to_gnosi_full_import.py` (línia ~952); si es reactiva mai, ha d'escriure el format nou i NO seccions al cos.

## Migració
Script idempotent `pipeline/sandbox/migrate_relation_wikilinks.py`: (1) primera passada construeix id→títol de totes les files de BD; (2) decora els camps `📀` de cada fila; (3) elimina les seccions llegades del cos segons la regla d'exactitud; `--dry-run` per defecte, còpia de seguretat dels fitxers canviats abans d'aplicar, informe final de comptes. OneDrive: la lectura des del host hidrata fitxers online-only (lent però segur).

**Estat: APLICADA el 2026-06-11 22:46** — 942 fitxers reescrits (decoració del frontmatter + neteja de seccions). Backup a `pipeline/sandbox/backups/relation_migration_20260611_224609/`; com que `sandbox/` és gitignored, el backup i el script només viuen al Mac on es va executar. Re-executar és segur: el dry-run del 2026-06-12 va donar 0 canvis pendents, 0 seccions llegades restants sota `BD/`, i l'API serveix ids nets (strip viu verificat).

**Romanent conegut (NO és cap error)**: 1.297 ítems de relació (487 ids distints) queden com a id nu perquè són **relacions penjades de l'import de Notion**: ids mai remapejats (patró `…268e5-2714-80…`), sense fila destí ni sota `BD/` ni a l'app (API 404). Camps més afectats: `📀 Tasca` (215), `📀 Recursos` (189), `📀 Tasques` (188), `📀 Font` (185), `📀 Projecte` (133), `📀 Enllaçat per` (123). No hi ha títol possible a decorar. Purgar aquests ids de les llistes és una decisió INDEPENDENT (esborra referències, encara que penjades) i demana revisió explícita de l'usuari.

## QA
- pytest del round-trip (strip/decorate, fallbacks, camps no-relació intactes).
- Navegador: la taula mostra títols a les columnes de relació; editar una relació desa `[[Títol|id]]` al `.md` i el cos no canvia.
- Verificar el fitxer d'exemple `BD/Cervell Digital/Recursos/A vueltas con la religión.md` després de migrar.
