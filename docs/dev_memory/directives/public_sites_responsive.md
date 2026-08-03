# Directive: Responsive Public Sites

## Objective

Keep the Gnosi landing site and engineering documentation fully usable at
mobile, tablet, and desktop widths while preserving one shared visual system.

## Scope

- Public landing pages in `ismigar.github.io` for English, Catalan, and Spanish.
- The shared landing stylesheet and navigation behavior.
- The engineering portal shell under
  `monorepo/apps/gnosi/docs/engineering-overrides/`.
- Documentation content including tables, code blocks, diagrams, navigation,
  and the localized footer.

## Responsive contract

- At 390 by 844 pixels, primary navigation remains reachable, interactive
  targets are at least 44 pixels high, and the page has no horizontal overflow.
- At 768 by 1024 pixels, grids collapse without clipped copy or controls and
  navigation remains explicit.
- At 1280 by 720 pixels, the existing desktop hierarchy and content density are
  preserved.
- Long code, tables, and diagrams scroll inside their own content region rather
  than widening the page.
- English, Catalan, and Spanish landing pages share identical structural
  behavior and localized accessible names.

## Implementation rules

- Treat `shell.css` and `navigation.js` at the public-site root as the canonical
  product shell. The landing pages load them locally and the MkDocs override
  loads the same published root files through `/shell.css` and
  `/navigation.js`.
- Keep the header and footer markup contract identical in both surfaces:
  `navbar`, `nav-container`, `brand`, `brand-logo`, `nav-links`, `lang-switch`,
  and `gnosi-shell-footer`.
- Keep the language order fixed as EN, CA, ES. Mark the current language with
  `active` and `aria-current="true"`; preserve the current documentation route
  when switching languages.
- Use the shared 1100 pixel width token for the product shell and the MkDocs
  grid. Mark the active product section with the shared `active` and
  `aria-current="page"` contract.
- Use a real navigation button with `aria-expanded` and `aria-controls` on the
  landing site. Close the menu after navigation, on Escape, and after returning
  to a desktop viewport.
- Keep the documentation product navigation horizontally reachable on compact
  widths and make every language, navigation, and footer link a touch target.
- Prefer fluid grid minimums such as `min(100%, ...)` over fixed minimum widths.
- Preserve the warm Gnosi theme, typography, sticky header stack, MkDocs search,
  and documentation drawer behavior.
- Respect reduced-motion preferences.

## Verification

- Static contract tests cover the three localized landing pages and the shared
  documentation override.
- Strict English, Catalan, and Spanish MkDocs builds pass.
- Browser checks run at 390 by 844, 768 by 1024, and 1280 by 720 for the landing
  page and documentation portal.
- Browser checks confirm navigation operation, visible focus/touch targets,
  Mermaid rendering, and absence of page-level horizontal overflow.

## Restrictions and edge cases

- Do not hide mobile navigation without providing an explicit replacement.
- Do not solve overflow by clipping the entire page; constrain the component
  that owns wide content.
- Do not shrink controls below 44 pixels to make a header fit.
- Do not duplicate locale-specific responsive CSS.
- Do not recreate the product header, logo, language selector, active-state
  rules, width, or global footer inside the MkDocs override. That causes the
  public site and documentation to drift; extend the shared shell instead.
- Do not leave generated AST expressions dependent on Python's formatter.
  Python versions vary around `lambda :`; normalize that output before checking
  generated-page freshness.
