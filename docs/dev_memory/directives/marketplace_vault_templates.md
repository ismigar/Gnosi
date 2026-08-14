# Directive: Gnosi marketplace and Vault templates

**Status:** Implemented and verified on 2026-08-14.

## Objective

Add an official, remotely fetched marketplace for Vault templates and reuse the
existing third-party plugin catalog as the plugin side of the same product
surface. Users can create a new Vault from a verified template, export an
existing Vault as a privacy-filtered template package, and prepare a moderated
submission without embedding GitHub write credentials in Gnosi.

## Distribution boundary

Marketplace metadata is fetched at runtime. Package bytes belong in GitHub
Release assets or equivalent object storage, never in the application Git tree.
The preferred long-term location is a separate public repository under the same
GitHub account. The existing Gnosi release assets remain a compatible default
source and development fixture.

The official index and official packages fail closed when integrity metadata is
missing or invalid. Custom registries are an explicit administrative feature
and remain visibly distinct from the official source.

## Vault template package

A template is a ZIP with a validated `template.json` manifest and a single
`vault/` payload root. The manifest declares stable identity, semantic version,
schema version, minimum Gnosi version, author, license, categories, languages,
description, preview metadata, and optional recommended plugin identifiers.

Creation from a template always downloads to bounded memory, verifies the
expected SHA-256 and trusted Ed25519 signature, validates the complete archive,
extracts to a staging directory under the Vaults root, scaffolds missing
standard directories, and atomically publishes the final directory before
registering it. A failed validation must not leave a registered or partially
created Vault.

## Export and submission

Export is allowlist-based and produces a deterministic ZIP. It excludes local
application state, plugins, trust stores, integrations, secrets, caches,
indexes, histories, trash, mail, and executable content. Symlinks are never
followed. A preview endpoint returns included files, excluded files with
reasons, total size, and secret-like findings before package generation.

Publishing from the app creates a portable submission bundle. It does not push
directly to GitHub and never stores a maintainer PAT. An optional deployment
submission broker can accept the bundle for quarantine and moderation; without
that explicit configuration, the app only downloads the validated bundle.

## Plugin hardening prerequisite

Remote index and package fetches must use public-network validation and bounded
redirect handling. The official catalog requires checksums and trusted
signatures. Installed provenance is persisted rather than inferred from the
mere presence of a signature string.

Plugin processes receive a minimal environment. Direct network primitives stay
blocked even when the network capability is granted; permitted network access
must traverse the host RPC guard. UI plugin frames likewise keep direct network
connectivity disabled and use the permission-gated host bridge.

## Authorization

Browsing is available to authenticated Vault users. Creating from a template
requires editor access. Export preview and local package generation require an
editor. Preparing a public submission requires administrator access because it
can disclose Vault content.

## Restrictions and edge cases

- Do not store marketplace packages under `monorepo/` because normal clones
  fetch tracked repository objects; use Release assets or a separate repository.
- Do not bundle executable plugins in Vault templates; use recommended plugin
  identifiers instead.
- Do not accept unsigned or checksum-free official packages; a mutable index
  must not be able to downgrade installation to an unverified package.
- Do not write directly into the final Vault directory during extraction;
  partial cloud or archive failures would expose a corrupt Vault.
- Do not copy the host environment into a plugin process; variable-name
  filtering misses credentials with unexpected names.
- Do not allow direct browser or Node networking for plugins; it bypasses SSRF,
  response-size, redirect, and host permission controls.
- Do not run untrusted submission build scripts with repository secrets.
- Do not follow symlinks during export or accept archive links during import.

## Verification

Backend tests cover manifests, index and package integrity, SSRF rejection,
archive limits, traversal and link rejection, deterministic export filtering,
atomic creation, provenance, minimal plugin environment, and host-only network
access. Frontend tests cover the creation mode, gallery, preview, export, error
states, and permission changes. Static builds, browser interaction, and a real
API create-from-template round trip are mandatory. The verified baseline is 76
targeted backend tests, all 294 frontend tests, the production frontend build,
and live browser inspection of repository and publishing states.
