# Directiu: Mode del camp `files` (Enllaç / Pujar)

> ID: FILES-FIELD-MODE-20260521
> Estat: implementat — pendent de merge.
> Relacionat: `gnosi_publisher.md`? no. Veure #155 (patró de nom), #167 (modal genèric).

---

## 1. Objectiu

El camp de tipus `files` declara **a l'esquema** com s'hi adjunten fitxers, i el
formulari d'inserció és **específic d'aquest mode** (a diferència del modal
genèric "/+" `InsertContentModal`, que té Vault/Disc local/Puja/URL).

## 2. Model de dades (config del camp)

- **`file_mode`**: `'link'` (Enllaç) | `'upload'` (Pujar). Default `'upload'`.
- **`storage_folder`** (només si `upload`): `assets` | `biblioteca` | `free`.
- **`name_pattern`** (només si `upload`): patró de reanomenat (`{Authors} - {Any}`),
  el del #155.

Persistit al config de la property (`SchemaConfigModal` → serialització
`if (f.file_mode) config.file_mode = f.file_mode`).

## 3. UI de configuració (`SchemaConfigModal`, type `files`)

- Select **Mode** (Enllaç / Pujar) a dalt del bloc de config del camp.
- Si **Pujar** → es mostren `storage_folder` + `name_pattern` (existien ja);
  si **Enllaç** → s'amaguen (l'enllaç referencia el fitxer tal qual).

## 4. Editor (`FileAttachmentField`)

Un sol botó **"+"** que fa l'acció del mode:
- **Enllaç** → obre `FilesystemPickerModal` (file) → `POST /api/vault/link-existing-file`.
- **Pujar** → input de fitxer → `POST /api/vault/upload-property-file` amb
  `storage_folder` + `target_name` (del `name_pattern`); si `free`, primer tria
  carpeta destí amb el picker.

El valor del camp segueix sent un string (URL `/api/...` o ruta). Es manté el
xip del fitxer actual amb la X (tooltip `common.delete`).

## 5. Relació amb #167

El #167 havia fet que el camp `files` usés el modal genèric `InsertContentModal`
(perdent `storageFolder`/`namePattern`). Aquesta directiva **re-especialitza** el
camp `files` (mode declaratiu) i recupera aquelles funcions. `InsertContentModal`
es manté per al **/+ de l'editor** i les **cel·les d'imatge de taula** (#161) —
no es toca.

## 6. Migració / defaults

Camps `files` existents sense `file_mode` → es tracten com `'upload'`
(comportament històric). Cap migració de dades necessària (només config).

## 7. Aprenentatges

- Bug preexistent (#155) corregit de passada: el bloc del `name_pattern` usava
  `fields` (no definit dins `SortableField`, que rep `allFields`) → `fields` →
  `allFields`.

## 8. Fitxers crítics

| Path | Rol |
|---|---|
| `frontend/src/components/Vault/SchemaConfigModal.jsx` | Config del camp (Mode + carpeta + patró). |
| `frontend/src/components/Vault/FileAttachmentField.jsx` | Editor del camp segons mode. |
| `frontend/src/components/Vault/BlockEditor.jsx` | Caller (passa `fileMode={prop.file_mode}`). |
| backend `POST /api/vault/upload-property-file`, `/api/vault/link-existing-file` | Endpoints d'upload/enllaç (sense canvis). |
