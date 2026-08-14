# Drupal 11 Production Upgrade

## Objective

Upgrade the Temenos production site only when the hosting web runtime, the
command-line runtime, Composer dependencies, database, and custom theme have
all passed the rehearsed Drupal 11 checks.

## Mandatory preflight

- Confirm both command-line PHP and the public webapp PHP-FPM runtime are PHP
  8.3 or newer. A temporary probe must expose only the version and SAPI, live
  outside caches, and be removed immediately after the request.
- Confirm Drupal bootstrap, database connectivity, free disk space, the active
  theme, enabled extensions, pending updates, and Composer manifest hashes.
- Confirm the public hostname and redirects from an external browser.
- Create and verify compressed database and code backups outside the document
  root before maintenance mode.
- Preserve public files separately from code replacement and record SHA-256
  checksums for every rollback artifact.

## Upgrade sequence

1. Enable maintenance mode and retire unused extensions while their code is
   still present.
2. Rename the custom theme and migrate its block configuration before removing
   the old theme directory.
3. Complete the contributed-project update and database updates on Drupal 10.
4. Install the locked Drupal 11 dependency set and run core database updates.
5. Install only the missing AI Agents entity definition when status confirms it
   is absent.
6. Rebuild container, discovery, and configuration caches from the stable code
   tree, then verify plugin counts, entity status, updates, audit, and lock
   reproducibility.
7. Reinstall any package whose Composer patch previously failed and verify the
   patched marker in the installed source.
8. Disable maintenance mode only for browser and log validation.

## Rollback rule

If the public web runtime cannot execute the locked Drupal 11 platform, retain
an additional verified Drupal 11 code and database snapshot, then restore the
pre-upgrade code and database together. Never leave a database upgraded to
Drupal 11 under Drupal 10 code or vice versa.

## Production attempt result (2026-08-13)

- The two-stage upgrade completed successfully on command-line PHP 8.4.24 and
  reached Drupal 11.4.5 with a connected database, successful bootstrap, no
  pending updates, no entity schema changes, and reproducible Composer state.
- Required modules, the Temenos theme, 79 block configurations, and three
  translated menu URLs survived. Retired modules and their code directories
  were absent.
- The MCP patch initially failed because its hunk had been generated from an
  already patched checkout. The corrected hunk applied strictly to the clean
  upstream package and the installed package was explicitly reinstalled.
- External browser validation exposed that the Pangea webapp still used PHP
  8.2.33 through its dedicated `ismigar-web` FPM pool, although shell PHP was
  8.4.24. Composer correctly refused to serve the Drupal 11 application.
- The verified pre-upgrade backup was restored. Production finished on Drupal
  10.6.15 with a connected database, successful bootstrap, no pending updates,
  maintenance disabled, and the public theme rendering normally.
- A verified snapshot of the completed Drupal 11 state remains beside the
  pre-upgrade backup so the attempt can be resumed after Pangea changes the
  webapp pool to PHP 8.4.

## Resolved infrastructure gate

The Pangea control panel exposes the `web` webapp PHP version as read-only.
SSH and Suweb credentials do not authorize regeneration of the
Orchestra-managed FPM pool. Request the version change from Pangea support,
then verify the public SAPI again before entering maintenance mode.

## Production completion result (2026-08-14)

- Pangea moved the dedicated webapp pool to PHP 8.4.24. A fresh temporary public
  probe confirmed the FPM runtime and was removed before maintenance mode.
- A new verified pre-upgrade code and database backup was created so content
  changes made after the previous attempt were preserved.
- The corrected MCP patch applied from the clean package distribution during
  the Drupal 10 contributed-project stage. All contributed database updates
  completed before core was replaced.
- Production reached Drupal 11.4.5 with a connected database, successful
  bootstrap, no pending database or entity-definition changes, no security
  advisories, and an exact no-op Composer dry run.
- The final state retained three translated menu URLs and 79 block
  configurations. Plugin discovery exposed 140 block plugins and 54 field
  formatters. The Temenos theme was active and all retired extensions and code
  directories were absent.
- External checks returned HTTP 200 for the homepage, a translated content
  page, and JSON:API. Browser inspection showed the complete theme with no
  console errors, and the resulting Drupal log contained no new critical
  entries.
- The pre-existing SMTP authentication requirement remains the only severity-2
  requirement finding and is independent of the Drupal 11 upgrade.
