# Drupal Local Staging

## Objective

Maintain a reproducible local clone of the production Drupal site for Drupal
11 upgrade rehearsals without consuming hosting database quota or allowing the
clone to contact production integrations.

## Architecture

- Download an exact production code snapshot through the interactive Suweb
  bridge, excluding public files and server backups.
- Export the production database with Drush into a private temporary path,
  download it, and delete the remote artifacts immediately.
- Run PHP explicitly from the Homebrew PHP 8.4 keg so the runtime matches
  production and satisfies Drupal 11.
- Run a dedicated MariaDB 11.4 instance from the ignored local staging
  directory, bound only to `127.0.0.1:3307`.
- Store the clone, database files, dumps, secrets, PID files, and logs under
  `.local/drupal-staging/`.
- Seed public files from the existing tracked snapshot with an APFS clone so
  local writes cannot mutate the source tree.
- Serve Drupal with PHP's built-in server on `127.0.0.1:8088`.

## Refresh flow

1. Validate PHP extensions, Composer, and MariaDB binaries.
2. Create code and database exports through Suweb.
3. Download and validate both compressed artifacts.
4. Replace only the ignored local site directory.
5. Install the locked Composer dependencies with PHP 8.4.
6. Recreate and import the dedicated local database.
7. Write the ignored settings override before bootstrapping Drupal.
8. Disable automated cron and SMTP in both settings overrides and active
   configuration, and route Drupal HTTP clients through a closed loopback port.
9. Rebuild caches and verify bootstrap, database connectivity, and isolation.

## Isolation requirements

- Never bind the database or web server to all interfaces.
- Never reuse production database credentials locally.
- Never expose a dump through the production document root.
- Block Drupal outbound HTTP by default and disable PHP sendmail.
- Do not start the local web server until database safety updates complete.
- Set PHP's document root explicitly to the cloned `site/web` directory. The
  router returns `FALSE` for static files, so a server rooted at the staging
  metadata directory returns 404 for every theme CSS, JavaScript, and image.
- URL-decode the router path before checking the filesystem so public assets
  with spaces or other encoded characters are served as static files.
- Do not export configuration or write any data back to production.
- Make the clone visible by overriding the site name with a local-stage label.

## Restrictions and edge cases

- Do not use SQLite because MySQL-specific schema and update behavior must be
  exercised.
- Do not rely on the shell `php`; invoke the absolute PHP 8.4 keg path.
- Do not use Drush status JSON because it may expose database secrets.
- SCP can return a non-zero status after a complete transfer on this host;
  validate the artifact itself before deciding the transfer failed.
- The tracked production `settings.php` contains a production connection. The
  ignored local override must replace the complete default connection before
  the first local bootstrap.
- A database refresh does not provide newer media. Public files are a visual
  fixture only and are deliberately not uploaded back to production.
- Production dumps can contain partial plugin-discovery cache entries. Truncate
  only the clone's `cache_discovery` table after hardening so Drupal discovers
  plugins lazily from the installed code.
- Production protects `sites/default` with mode 555. Change only the cloned
  directory to 755 before Composer or the public-file seed writes into it.
- The production archive may contain a read-only `settings.local.php`. Never
  inspect or reuse it; change its cloned mode and overwrite it before bootstrap.
- Production currently stores the Catalan legal menu link as an unencoded
  non-ASCII internal URI. Normalize such links only in the clone before cache
  rebuild; otherwise Drupal 10.6 logs an `InvalidArgumentException`.

## Verification

1. PHP reports 8.4 with PDO MySQL, GD, Intl, Mbstring, XML, and ZIP.
2. MariaDB reports port 3307 and bind address 127.0.0.1.
3. Drush reports the expected Drupal version, a connected database, and a
   successful bootstrap.
4. SMTP and automated cron resolve to disabled values.
5. Homepage and JSON:API return successful responses through loopback.
6. Browser DOM inspection confirms the clone renders with the staging label.
