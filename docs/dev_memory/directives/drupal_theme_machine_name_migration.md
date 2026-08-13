# Drupal Theme Machine-Name Migration

## Objective

Rename the custom Drupal theme machine name from `elraco` to `temenos`
without losing active theme settings, block placements, responsive-image
breakpoint mappings, or the current default-theme selection.

## Scope

- Rename the tracked theme directory and machine-named files.
- Rename PHP hooks, library references, breakpoint identifiers, JavaScript
  selectors, CSS block selectors, and internal template path comments.
- Declare Drupal 11 compatibility while retaining Drupal 10 compatibility for
  the rehearsal.
- Provide an idempotent Drush PHP script that migrates active configuration.
- Apply and verify the migration on the isolated local staging clone before any
  production deployment.

## Migration order

1. Make the `temenos` theme code available beside the existing `elraco` code.
2. Install `temenos` through Drupal's theme installer.
3. Copy `elraco.settings` values into `temenos.settings`.
4. Clone every block assigned to `elraco`, replacing the configuration ID
   prefix and theme property with `temenos`.
5. Replace `elraco` theme dependencies, breakpoint groups, and breakpoint IDs
   in responsive-image configuration.
6. Set `temenos` as the default theme.
7. Uninstall `elraco` only after the replacement configuration is complete.
8. Rebuild caches and verify the rendered site.

## Restrictions and edge cases

- Do not rename only the directory. Drupal stores the machine name in active
  configuration and would fall back to an unavailable default theme.
- Do not uninstall `elraco` before cloning its blocks because theme uninstall
  removes block configuration assigned to that theme.
- Preserve block UUIDs only on the old configuration. New block entities need
  new UUIDs so both themes can coexist during the migration transaction.
- Do not rewrite arbitrary configuration strings. Limit replacements to theme
  dependencies, responsive-image breakpoint fields, block theme properties,
  and known configuration object names.
- Keep the migration idempotent: an already migrated site must exit cleanly
  without duplicating blocks or changing unrelated configuration.
- Never apply the migration directly to production before the local clone has
  passed bootstrap, HTTP, asset, and browser validation.

## Verification

1. Drupal reports `temenos` as the default theme and no installed `elraco`
   theme.
2. All former `elraco_*` blocks exist as `temenos_*` blocks in the same
   regions with the same plugins and settings.
3. Responsive-image configurations depend on `temenos` and reference
   `temenos.mobile`, `temenos.tablet`, and `temenos.desktop`.
4. The homepage, theme CSS, theme JavaScript, and logo return HTTP 200.
5. Browser inspection confirms the expected layout, typography, navigation,
   responsive images, and no missing theme assets.
