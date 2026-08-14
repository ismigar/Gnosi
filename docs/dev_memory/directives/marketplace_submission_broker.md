# Directive: Marketplace submission broker

## Objective

Accept privacy-filtered Vault template and plugin packages from an explicitly
configured Gnosi backend, quarantine them without executing their contents, and
expose a maintainer-only moderation queue. Submission does not make a package
official: only a later reviewed release workflow may sign and publish it.

## Authoritative location

The broker is part of the existing Cloudflare Worker under
`ismigar.github.io/growth-dashboard/`. The existing Free-plan D1 database stores
submission metadata, review state, and private package chunks. The application
repository and public Git history never contain uploaded ZIPs.

## Trust boundaries

The ingestion endpoint uses a dedicated bearer secret that is present only in
the Worker and the Gnosi backend deployment. Dashboard OAuth sessions cannot be
used as submission tokens, and submission tokens cannot access the moderation
queue. Maintainer list and decision endpoints reuse the existing GitHub OAuth
allowlist.

Uploads must declare a bounded `Content-Length`, use multipart form data, and
contain exactly one supported kind, one JSON metadata object, and one ZIP file.
The broker validates field sizes, safe filenames, identifiers, semantic
versions, media type, ZIP magic, and package SHA-256 before writing anything.
It never imports, extracts, evaluates, or executes uploaded content.

## Storage and state

Packages are split into ordered chunks below D1's two-megabyte row limit and
written with their metadata in one transactional batch. D1 records the immutable
hash, size, kind, metadata, timestamps, status, and review notes. Duplicate
kind/hash pairs return the existing submission instead of writing the bytes
again. The active quarantine is capped at 250 MiB so it fails before the Free
database limit; Free-plan query and storage limits fail closed rather than bill.

The queue states are `quarantined`, `approved`, and `rejected`. Approval records
human review but does not sign or publish bytes. This keeps the official signing
key outside the request-facing Worker and preserves a mandatory release gate.

## Restrictions and edge cases

- Do not store ZIP bytes in Git, logs, issue bodies, or list responses. D1 may
  store only bounded private chunks in the dedicated quarantine tables.
- Do not reuse the dashboard session secret, GitHub token, or signing key as the
  submission bearer token.
- Do not accept chunked uploads without a declared size; the Worker must reject
  them before parsing multipart data.
- Do not accept more than 20 MiB for plugins or 50 MiB for Vault templates. The
  app can still export larger Vaults locally, but broker submission must fail
  clearly below Worker memory and request limits.
- Do not unpack ZIPs in the request-facing Worker. Deep archive and malware
  scanning belongs in a secretless isolated CI job before human approval.
- Do not return R2 keys or downloadable package URLs to submitters.
- Do not treat approval as publication. Official packages still require the
  deterministic catalog build, human review, and detached Ed25519 signatures.
- Do not activate R2: account activation requires a usage-billed subscription.
  Keep the existing D1 Free plan, enforce the quarantine cap, and fail closed
  when daily or storage quotas are exhausted.

## Verification

Unit tests cover bearer authentication, malformed metadata, unsupported kinds,
unsafe names, size limits, ZIP magic, deterministic SHA-256, duplicate handling,
transactional storage, queue authorization, and decisions. The Worker TypeScript
build and dry-run deployment must pass. A live smoke test must prove that an
unauthorized request is rejected and an authenticated benign ZIP is quarantined
without becoming publicly downloadable.
