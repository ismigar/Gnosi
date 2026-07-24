# Image-Like Text Field Thumbnails

## Objective

Render a text field as an image thumbnail when both its name suggests an image
and its value resolves to a supported image. Keep table and page-property
behavior identical.

## Detection

Use the shared `isImageFieldName()` helper in `fileResource.js`.

The helper recognizes image, cover, thumbnail, and photo terms across supported
legacy labels, while excluding alt text, captions, legends, and descriptions.
These literals are compatibility detection data, not UI text.

Apply inference only to text or untyped fields.

## Value gate

Name detection alone is insufficient. The value must resolve through
`toAssetPreviewUrl` to a supported served image.

- Valid path: thumbnail with hover preview.
- Empty image-like field in edit mode: localized add-image action.
- Prose or unsupported value: normal text behavior.
- URL, date, number, select, and relation fields keep their declared behavior.

## Editing

Both table and page properties use `InsertContentModal`. Store the resulting
vault-relative path through `servedUrlToVaultPath`, never the API serving URL.

## Restrictions

- Never duplicate the detection regex in another view.
- Never infer an image without the value gate.
- A field used for social image URL remains a URL field, not inferred image
  text.
- All thumbnail alt text, empty states, and picker labels use i18n with English
  defaults.

## QA

Verify a real image path renders and loads in table and detail views, alt-text
fields remain text, empty fields open the picker, Escape makes no change, the
stored value is vault-relative, and declared non-text field types do not
regress.
