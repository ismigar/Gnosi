# Technical documentation localization

## Purpose

Publish the engineering portal in English, Catalan, and Spanish so engineers
can use the same traceable source reference in their preferred language.

## Source and output contract

English under `monorepo/apps/gnosi/docs/engineering/` is the source language.
Catalan and Spanish mirrors live respectively under
`monorepo/apps/gnosi/docs/engineering-ca/` and
`monorepo/apps/gnosi/docs/engineering-es/`. Their paths match the English
tree, allowing internal links and source references to remain valid.

The localization script translates Markdown prose while preserving YAML front
matter, fenced code, inline code, URLs, source paths, API names, and generated
notice markers. It also copies portal assets. Translation outputs are reviewed
and committed so Pages never relies on external translation services during a
deployment.

## Navigation and publication

Each locale has its own MkDocs configuration and all three builds publish into
the same Pages artifact: English at `engineering/`, Catalan at
`engineering/ca/`, and Spanish at `engineering/es/`. A language selector
preserves the current documentation path when that page exists in the selected
locale.

## Verification

Run the localization consistency check, validate every localized portal tree,
and build all locale configurations with strict MkDocs warnings. Confirm in a
browser that the header, language selector, internal links, and Mermaid
diagrams render in each locale.

For a focused generated-reference change, refresh only the affected mirror with
`localize.py --path generated/<page>.md`. This keeps deterministic localized
artifacts current without retranslating unrelated catalogs.

## Restrictions and edge cases

- Do not translate source paths, endpoints, identifiers, code, URLs, or API
  names: these are the evidence trail, not prose.
- Do not regenerate translations during GitHub Pages deployment; public
  translation providers are network dependencies and outputs require review.
- Do not edit generated catalogs manually in a locale. Regenerate the English
  catalog first, then refresh its locale copies through the localization tool.
- Do not add locale directories inside `docs/engineering/`; MkDocs would
  include them in the English navigation and artifact. Keep each locale in its
  sibling root.
- Do not send Markdown placeholders through a machine-translation model. The
  model can mutate the placeholder and corrupt links, code, and line structure.
  Extract plain-language fragments first, translate only those fragments, and
  reinsert them into an untouched structural skeleton.
- Machine-generated prose requires linguistic review before publication. The
  structure validator proves Markdown integrity and completeness, not idiomatic
  translation quality.
