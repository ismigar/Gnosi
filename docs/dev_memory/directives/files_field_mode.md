# Directive: `files` field mode

> ID: FILES-FIELD-MODE-20260521
> Status: Implemented

## Objective

A `files` field declares its attachment behavior in the schema. Its insertion
control is specific to that mode, unlike the editor's general
`InsertContentModal`.

## Field configuration

- `file_mode`: `link` or `upload`; default `upload`.
- `storage_folder`, for upload only: `assets`, `biblioteca`, or `free`.
- `name_pattern`, for upload only: rename pattern such as
  `{Authors} - {Year}`.

`SchemaConfigModal` serializes these values into property configuration.

## Configuration UI

Show a Mode selector at the top of `files` settings. Upload mode reveals
storage folder and naming pattern controls. Link mode hides them because it
references an existing file unchanged. All labels are i18n-backed.

## Field editor

One plus button performs the configured action:

- Link opens `FilesystemPickerModal` and calls
  `POST /api/vault/link-existing-file`.
- Upload opens a file input and calls
  `POST /api/vault/upload-property-file` with storage and target name. Free
  storage asks for a destination directory first.

The field value remains a URL or path string. Keep the current file chip and
its i18n-backed remove action.

## Relationship to the generic insertion modal

The generic modal previously caused `files` fields to lose their storage and
naming configuration. This directive restores their specialized behavior.
Keep `InsertContentModal` for the editor slash/plus action and table image
cells.

## Compatibility

Treat existing fields without `file_mode` as `upload`. No data migration is
required; only schema configuration changes.

## Learned constraint

Inside `SortableField`, use its `allFields` prop when resolving naming-pattern
tokens. Do not reference an undefined outer `fields` variable.

## Critical files

| Path | Role |
|---|---|
| `frontend/src/components/Vault/SchemaConfigModal.jsx` | Field mode, folder, and naming pattern |
| `frontend/src/components/Vault/FileAttachmentField.jsx` | Mode-specific field editor |
| `frontend/src/components/Vault/BlockEditor.jsx` | Passes `fileMode={prop.file_mode}` |
| `/api/vault/upload-property-file` | Upload endpoint |
| `/api/vault/link-existing-file` | Existing-file link endpoint |
