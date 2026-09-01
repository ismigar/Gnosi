# Gnosi marketplace distribution

Gnosi fetches marketplace indexes at runtime. Template and plugin ZIP files are
GitHub Release assets and are not tracked Git objects, so cloning the application
does not download marketplace packages.

The current candidate workflow assembles the official plugin index, the generated
Starter Vault package, the Vault template index, and detached index signatures
as a short-lived review artifact. It does not publish or modify an
`ismigar/Gnosi` release. The long-term catalog can move to a separate
`ismigar/Gnosi-Marketplace` repository without changing the package or API
contracts; deployments can override the two index URLs with
`GNOSI_PLUGIN_REGISTRY_URL` and `GNOSI_VAULT_TEMPLATES_INDEX_URL`.

Official indexes and packages use detached Ed25519 signatures over their exact
bytes. The private signing key is supplied to CI as
`GNOSI_PLUGIN_SIGNING_KEY`; it must never be committed. Candidate creation
fails if the key is absent or does not match the bundled official public key.
An independent pre-upload verifier checks both indexes, all package bytes,
signatures, hashes and announced filenames; Gnosi verifies them again before
installation.

Vault template submissions are privacy-filtered locally and can be sent only to
an explicitly configured moderation broker. Set
`GNOSI_MARKETPLACE_SUBMISSION_URL` to enable the submit buttons. A broker may
use its own bearer credential through `GNOSI_MARKETPLACE_SUBMISSION_TOKEN`, but
it must not accept or expose a maintainer GitHub PAT in the desktop application.

The broker is responsible for quarantining uploads, opening or updating a pull
request in the marketplace repository, running automated validation without
secrets, and requiring human review before the release workflow signs an
artifact.

## Package boundaries

- Vault packages contain `template.json` and a `vault/` payload.
- Vault exports exclude `.gnosi`, plugins, mail, trash, history, executables,
  links, oversized files, and environment files.
- Plugins continue to use a root `manifest.json` and run disabled with no grants
  after installation.
- Direct plugin networking is always blocked. The network capability exposes
  only the bounded host RPC.

The implementation directive is
`docs/dev_memory/directives/marketplace_vault_templates.md` in the private
engineering repository.
