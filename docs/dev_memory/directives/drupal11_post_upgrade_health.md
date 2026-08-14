# Drupal 11 Post-upgrade Health Remediation

> Status: ACTIVE
> Last verified: 2026-08-14

## Objective

Resolve the Drupal 11 status-report findings after the production upgrade
without removing active public functionality or introducing unnecessary
provider dependencies.

## Scope

- Replace the deprecated core Contact form with the existing Webform contact
  form before uninstalling Contact and Contact Block.
- Remove unused deprecated AI Content Suggestions and AI Logging modules.
- Remove the unused AI Chatbot module when no assistant entities or chatbot
  blocks exist, which also removes its optional CommonMark warning.
- Remove core History when the site does not depend on per-user content-read
  timestamps.
- Retire the failing SMTP module and restore Drupal's `php_mail` transport on
  the Pangea host, where PHP exposes a local sendmail command.
- Declare the Drupal 12 HTML5-validation behavior explicitly as disabled and
  test server-side form validation.
- Schedule Drupal cron every minute through the web user's crontab. Ultimate
  Cron performs the per-job scheduling; the one-minute dispatcher prevents
  staggered jobs and five-minute schedules from remaining transiently behind.
- Keep AI core and AI Agents because MCP depends on them. Install the official
  Groq provider and link it to the existing `ai_agent` Key entity without
  reading or logging the credential value.

## Contact migration contract

The existing `contact` Webform is the replacement target. It must retain both
enabled email handlers, receive a required terms-of-service element linking to
the translated privacy-policy pages, and be opened before the public Contacta
menu link moves to `/form/contact` in every translation. Contact is uninstalled
only after these invariants pass.

## Execution

Run the idempotent Drupal remediation script through `drush php:script` while
all module code still exists. Remove the contributed SMTP and Contact Block
packages with Composer only after their modules are absent from active
configuration. Apply database updates and rebuild caches.

Install the cron entry with the deterministic helper as the web user. The
helper owns only the line carrying its marker and preserves every unrelated
crontab entry.

## Restrictions and edge cases

- Do not uninstall Contact merely because it is deprecated. The live menu
  points to a customized Contacta form. Migrate and verify the Webform first.
- Do not treat a Webform with raw status `open` as publicly available when its
  archive flag is still set. Clear the archive flag before checking `isOpen()`.
- Do not uninstall AI core or AI Agents while MCP depends on them. Remove only
  unused feature modules and configure a provider separately.
- Do not confuse a locally usable provider plugin with a verified external API
  connection. Groq 1.2.0-rc1 is Drupal 11 compatible and can be configured
  against the existing Key entity without transmitting it, but an external
  model request still requires explicit authorization and separate E2E proof.
- Do not assume enabling an AI provider leaves unrelated language overrides
  untouched. Drupal's provider installation imports interface translations and
  can rewrite translated configuration objects; rerun the idempotent contact
  migration after the provider is enabled, then verify both Webform language
  collections before leaving maintenance mode.
- Do not uninstall AI Logging when log entities exist. Abort and review the
  retained data first.
- Do not keep AI Chatbot solely to silence its CommonMark recommendation. If
  there are no assistants or chatbot blocks, uninstall the unused module
  instead of adding a formatting library.
- Do not retry the current SMTP password. Both production and shared
  credentials return SMTP authentication error 535. Restore the host-local
  mail transport and remove the stale credential-bearing configuration.
- Do not claim mail delivery from a successful sendmail process invocation.
  An explicitly authorized end-to-end test message must be received before
  delivery is considered verified.
- Do not run Ultimate Cron's dispatcher only every fifteen minutes. Its jobs
  use unique minute skews and some run every five minutes, so a quarter-hour
  dispatcher leaves warning windows. Install the marked one-minute crontab
  entry and verify Ultimate Cron immediately after a manual run.
- Do not leave `enable_html5_validation` implicit. Set it to `FALSE` in both
  production settings and generated local staging settings, then verify that
  required fields are still rejected by Drupal server-side validation.
- Do not assume making `sites/default` mode 755 makes `settings.php`
  replaceable. Production also protects the file itself with mode 444; change
  only that file to 644 for the verified replacement and restore 444
  immediately afterwards.
- Do not expose SMTP passwords, provider keys, mail recipients, or authenticated
  URLs in command output, logs, or committed files.
- Do not interpret a sandbox-denied MariaDB socket connection as a stopped
  local database. It can make the helper attempt a second server and hit file
  locks. Confirm the owner with `lsof` and rerun the helper with approved local
  socket access instead of deleting PID, socket, or database files.
- Do not run the combined module uninstall with PHP's 128 MB default. Drupal's
  configuration cleanup can exhaust it after the contact link has already
  migrated. Invoke Drush with a 512 MB limit and keep the remediation script
  reentrant so a partial first run can safely resume.
- Do not assume SMTP's uninstall hook restored the mail interface after a
  fatal partial uninstall. When the module is already absent and the interface
  is exactly the orphaned `SMTPMailSystem`, replace only that known stale value
  with `php_mail`; abort for any other unexpected mail transport.

## Verification

1. The Contacta menu link resolves to the open Webform in every site language.
2. The Webform contains a required translated privacy-policy agreement and its
   two email handlers remain enabled.
3. Contact, Contact Block, History, SMTP, AI Chatbot, AI Content Suggestions,
   and AI Logging are absent from `core.extension`.
4. SMTP and CommonMark no longer appear as status-report errors or warnings.
5. The HTML5 setting is explicitly false and an empty contact submission is
   rejected server-side.
6. The cron marker exists exactly once, a manual cron run succeeds, and no
   Ultimate Cron jobs remain behind schedule immediately afterward.
7. Homepage, translated contact form, JSON:API, database updates, entity
   updates, Composer validation, audit, and dry-run install all pass.
8. The Groq provider module is enabled, references Key entity `ai_agent`, is
   locally usable, and removes the AI-provider status warning without exposing
   or transmitting the credential during configuration.

## Related files

- `.agent/skills/domain/drupal/scripts/remediate_post_upgrade_health.php`
- `.agent/skills/domain/drupal/scripts/ensure_cron_schedule.py`
- `.agent/skills/domain/drupal/scripts/verify_post_upgrade_health.php`
- `.agent/skills/domain/drupal/scripts/local_staging.py`
- `temenos/web/sites/default/settings.php`

## Production result (2026-08-14)

- A verified database and code rollback set was created under the private
  `drupal11-health-20260814` backup directory before maintenance mode.
- Contacta now uses the open translated Webform with two enabled email handlers
  and a required privacy-policy agreement. Contact, Contact Block, History,
  SMTP, AI Chatbot, AI Content Suggestions, and AI Logging are uninstalled.
- Composer removed SMTP, Contact Block, and PHPMailer, then installed
  `drupal/ai_provider_groq` 1.2.0-rc1. Groq is locally usable through Key entity
  `ai_agent`, but an explicitly authorized minimal model request was rejected by
  Groq as an invalid API key. The configured value was never displayed or
  logged; replace the Key entity value before treating AI as operational.
- The one-minute marked cron dispatcher preserved the existing crontab and
  reduced Ultimate Cron's behind count to zero on the next system minute.
- Drupal's status requirements returned no errors or warnings. Composer audit
  found no advisories and the production lockfile install is a no-op.
- The public homepage, three contact-form locales, and JSON:API returned HTTP
  200. Browser QA confirmed the Temenos theme, translated form labels and
  privacy links, explicit `novalidate`, and no console errors.
- Mail transport now uses the Pangea host's `php_mail` path. One explicitly
  authorized test message was accepted by the local transport; end-to-end
  delivery remains unverified until the maintainer confirms receipt.
