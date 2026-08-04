# Publishing Gnosi Cite to extensions.libreoffice.org

This guide prepares the `.oxt` for distribution beyond manual GitHub release
downloads. **A person must create the account and accept the terms.** The
remaining technical preparation is ready.

The process was verified on 2026-07-21 against the
[official maintainer guide](https://extensions.libreoffice.org/en/home/using-this-site-as-an-extension-maintainer).

## Account

Use a free **The Document Foundation account**, which is the single sign-on
account for LibreOffice infrastructure:

1. Create it at <https://user.documentfoundation.org>.
2. Sign in at <https://extensions.libreoffice.org/admin>.

The maintainer documentation does not mention a publication fee.

## Moderation

Publication requests are handled by a human moderator before becoming
visible. Review criteria and timelines are not documented publicly, so do not
assume immediate publication.

Unlike Chrome Web Store, this channel has no fee and no requirement to justify
browser permissions individually, but it still has human moderation.

## Process

1. Create the listing with a title, description, **logo**, and tags.
2. Save the English listing first. English is required as the base language;
   other languages are optional translations.
3. Choose **Add Extension Release** and upload the `.oxt`.
4. Optionally add Catalan and Spanish listing translations.
5. Publish the listing to enter the moderation queue.

Use the
[community extensions forum](https://community.documentfoundation.org/c/extensions/36)
for process questions.

## Remaining work

- [ ] **Logo.** The listing requires one, and the `.oxt` does not declare one.
      Select the artwork and add it to the listing and preferably to the
      extension's `description.xml`.
- [x] **English description.** The extension README and this publication
      guide now use English as their base language. Prepare a shorter,
      user-oriented version for the listing rather than copying installation
      documentation verbatim.
- [ ] **Set expectations.** The current version refreshes citations in the
      body and tables but not headers or footers. State this in the listing so
      users discover it before working on a large document.

## Ready components

- `./build.sh` builds the `.oxt`; its version comes from `description.xml`.
- Document traversal has tests under `tests/`, executed by
  `backend-tests.yml`.
- The README documents installation, Extension Manager pitfalls, and known
  compatibility.
- GitHub `plugins-v0.1.x` releases provide package and changelog history.

## Versioning

The listing version and `description.xml` version must match. LibreOffice
indexes the extension cache by version, so **increase the version whenever the
payload changes**. Otherwise users can unknowingly keep running old code. See
`libreoffice_cite_extension.md`.

## Other distribution channel

The Web Clipper has a separate guide with additional cost and permission
review:
[`web-clipper/STORE_SUBMISSION.md`](../../web-clipper/STORE_SUBMISSION.md).
