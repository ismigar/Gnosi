# Sidecar Internal Metadata Directive

## Objectiu

Mantenir el frontmatter dels fitxers `.md` del vault **net** d'estats interns
del sistema (flags `_manual` del rule_engine, `is_template`, etc.), persistint
aquests valors en un fitxer sidecar JSON a `<vault>/.gnosi/page_meta/<id>.json`.

L'usuari ha de poder obrir el `.md` en qualsevol editor extern i veure només
les seves dades semàntiques (title, tags, schema fields…), no la maquinària
del rule_engine.

## Claus que viuen al sidecar (NO al frontmatter)

- `is_template` — marca de plantilla.
- `is_default_template` — plantilla per defecte de la taula.
- `*_manual` — flags posades pel rule_engine per indicar que un camp ha estat
  editat manualment per l'usuari i no s'ha de sobreescriure automàticament.

Qualsevol altra clau es queda al frontmatter (és contingut semàntic de la
pàgina, no estat intern).

## Estructura del fitxer sidecar

```
<vault>/.gnosi/page_meta/<page_id>.json
```

Contingut (només els camps presents):

```json
{
  "is_template": true,
  "title_manual": true,
  "tags_manual": true
}
```

Si no hi ha cap clau interna, **no es crea sidecar**. Si totes desapareixen,
es **suprimeix** el sidecar.

## Contracte de lectura

`parse_frontmatter(content, file_path)` retorna metadata fusionada:
1. Parse YAML frontmatter del `.md`.
2. Si `metadata.id` està disponible i `file_path` permet derivar el vault root
   (ancestor amb `.gnosi/`), llegir sidecar JSON.
3. Fusionar el sidecar dins de `metadata` (sidecar guanya per a les seves claus).
4. Retornar `(metadata, body)`.

Si no es pot derivar el vault root o no existeix sidecar, no es modifica res
i la pàgina manté el comportament previ (compatibilitat amb pàgines antigues
no migrades).

## Contracte d'escriptura

Tota escriptura de pàgina passa per `save_page_md(file_path, metadata, body)`:
1. Split: separa claus sidecar de claus frontmatter via `split_metadata`.
2. Generar frontmatter YAML sense les claus sidecar.
3. `safe_write_text(file_path, frontmatter + body)`.
4. Si el sidecar dict no és buit: `safe_write_json(sidecar_path)`.
5. Si el sidecar dict és buit: eliminar el sidecar (cleanup).

Atomicitat: ambdues escriptures usen `safe_write_*`. Si la 2a falla, el `.md`
queda escrit però el sidecar pot quedar desactualitzat. La pèrdua és
acotada (un parell de bools); millor que corrupció.

## Migració de pàgines existents

Script idempotent: `pipeline/sandbox/migrate_sidecar_metadata.py`.

Funcionament:
1. Recorre `<vault>/**/*.md` (exclou `.gnosi/`, `local_data/`, `Trash/`).
2. Per cada fitxer: parse → split → si hi ha claus sidecar al frontmatter,
   escriu el sidecar i reescriu el `.md` net.
3. Idempotent: si el `.md` ja és net, no fa res.
4. Reporta: fitxers escanejats / migrats / sense canvis / errors.

## Restriccions / Edge cases

- **Pàgina sense `id` al frontmatter**: no es pot crear sidecar (no hi ha clau
  estable). El sistema deixa les flags al frontmatter com a fallback i loggea
  un warning. Aquest cas indica un .md corrupte/llegacy; l'usuari ho ha de
  resoldre afegint id.
- **Vault root no determinable** (file_path None o sense `.gnosi/` ancestor):
  retornar metadata tal qual del frontmatter; cap merge ni write de sidecar.
- **Sidecar orfe** (pàgina esborrada manualment al filesystem): el sidecar
  queda residual. No és destructiu, però una eina de neteja seria útil
  com a millora futura.
- **Dashboards** (`.json`): el seu writer (`_write_dashboard_file`) també
  fa el split: les claus sidecar s'extreuen del `metadata` del payload i van
  al mateix sidecar JSON per `page_id`.
- **Concurrència**: dos processos escrivint el mateix sidecar simultàniament
  → últim guanya. Acceptable per a flags que normalment només toca el
  rule_engine sequencialment per page_id.
- **OneDrive**: els sidecar viuen dins `.gnosi/` que ja es sincronitza. No cal
  configuració addicional.
- **graph_service / mail_routes**: tenen còpies locals de `parse_frontmatter`.
  De moment NO fan merge sidecar perquè processen entitats que no usen
  aquestes flags (graf, mail). Si en un futur necessiten `is_template` etc.,
  s'haurà d'estendre.

## Eines necessàries

- Codi: `backend/services/page_sidecar.py` (helper I/O).
- Modificacions: `backend/api/vault_routes.py` (`parse_frontmatter`,
  `generate_frontmatter`, nou `save_page_md`, replace de 6 call sites de
  write).
- Frontend: `BlockEditor.jsx` ja filtra les claus internes del panell
  de propietats (commit anterior).
- Migració: `pipeline/sandbox/migrate_sidecar_metadata.py`.

## Test

```bash
cd ~/Projectes/monorepo/apps/gnosi
# dry-run primer per veure què es migrarà
DIGITAL_BRAIN_VAULT_PATH=/path/al/vault \
    python -m pipeline.sandbox.migrate_sidecar_metadata --dry-run
# després executar de veritat
DIGITAL_BRAIN_VAULT_PATH=/path/al/vault \
    python -m pipeline.sandbox.migrate_sidecar_metadata
```

Verificar:
1. Cap `.md` migrat conté `is_template:` o `*_manual:` al frontmatter.
2. `<vault>/.gnosi/page_meta/` conté els JSON.
3. Obrir una pàgina al frontend: el panell de propietats no mostra les flags
   internes (ja fet al frontend).
4. Editar manualment un camp: el rule_engine segueix respectant el flag
   `_manual` quan corre (el sidecar es regenera).
