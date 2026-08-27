# Publishing the Web Clipper to Chrome Web Store

This is the publication preparation guide. **A person must complete the
account, payment, and terms-acceptance steps**; they cannot be automated or
delegated.

## Why publication matters

The clipper is currently installed in **developer mode** through **Load
unpacked**. Every user must enable developer mode, Chrome displays a permanent
warning, and updates are not automatic. This prevents the connector from
being presented as a stable installation.

## Prerequisites that require the maintainer

1. A developer account in the
   [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. The one-time USD 5 registration fee.
3. Acceptance of the developer program terms.

The rest of this guide cannot be used until all three steps are complete.

## Package

```bash
./build.sh
```

The script generates two ZIP files with different structures:

| File | Structure | Use |
|---|---|---|
| `gnosi-web-clipper.zip` | everything under `web-clipper/` | Load unpacked and GitHub releases |
| `gnosi-web-clipper-store.zip` | `manifest.json` at the root | **Store upload**; the store rejects a ZIP with the manifest inside a directory |

## Permission review

`manifest.json` declares:

```json
"permissions": ["activeTab", "scripting", "storage"],
"host_permissions": ["http://localhost/*", "https://localhost/*",
                     "http://127.0.0.1/*", "<all_urls>"]
```

**`<all_urls>` triggers additional review.** It requests access to every site,
so the store requires a justification for each permission:

- **`activeTab`** — reads the title and URL of the active tab only after the
  user clicks the extension button.
- **`scripting`** — runs a function that returns selected text. It does not
  inject persistent content or modify the page.
- **`storage`** — stores the user's backend URL and API token locally. This
  data does not leave the device except when sent to that backend.
- **localhost and `127.0.0.1` host permissions** — support the common case in
  which Gnosi runs on the user's own computer.
- **`<all_urls>`** — supports self-hosting Gnosi on **any** user-controlled
  domain. This is the weakest part of the submission.

### Recommended alternative

Replace `<all_urls>` with **`optional_host_permissions`**. The extension would
request no broad access up front. When the user saves a backend URL, Chrome
would ask for access only to that specific domain through
`chrome.permissions.request()`.

This requires additional implementation, but turns a high-risk permission
request into a routine one and provides better privacy. Make this change
**before** submission rather than after a rejection.

## Privacy declaration

- The extension collects no analytics, telemetry, or identifiers.
- The only data leaving the browser goes to the server configured by the
  user, which defaults to their own computer.
- The API token is stored in `chrome.storage.local` and is transmitted only to
  that server in the `Authorization` header.
- Gnosi-operated intermediary servers are not involved. State this clearly in
  the store privacy form.

## Pre-submission checklist

- [ ] Increase `version` in `manifest.json`; the store rejects a version it
      has already seen. The current `1.1.0` differs from the `0.1.x` release
      train and should be aligned before publication.
- [ ] Decide whether to replace `<all_urls>` with the recommended optional
      permission.
- [x] Provide 16/32/48/128/512 icons in `icons/`, derived from the app icon,
      and reference them from `icons` and `action.default_icon`. `build.sh`
      fails if the manifest references a missing icon.
- [ ] Capture popup screenshots at 1280×800 or 640×400.
- [ ] Prepare a short description of at most 132 characters and a longer
      description.
- [ ] Publish a privacy policy at a public URL.
- [ ] Ensure `pnpm test:frontend` passes; it covers popup logic.

## Other distribution channel: LibreOffice

Publish the `.oxt` package at
[extensions.libreoffice.org](https://extensions.libreoffice.org/). The
verified steps are documented in
[`extensions/office/libreoffice-cite/PUBLISHING.md`](../office/libreoffice-cite/PUBLISHING.md).

| | Chrome Web Store | extensions.libreoffice.org |
|---|---|---|
| Fee | USD 5 once | none |
| Account | Google developer program | [TDF account](https://user.documentfoundation.org) through LibreOffice SSO |
| Review | automated and human, with permission justifications | human moderation |
| Permission justifications | required individually | not applicable |

Correction verified on 2026-07-21: LibreOffice publication **does have human
moderation**. Official documentation says that publication requests are
handled by a moderator. It has no fee or permission-justification form, but
the moderation criteria and timelines are not public.
