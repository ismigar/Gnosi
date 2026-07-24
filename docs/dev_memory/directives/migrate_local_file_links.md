# Local File Link Migration

## Objective

Use one stored format for files opened by a native application:

- `file://` for normal links.
- `/api/vault/local-file/<token>` only for inline browser-served blocks and
  frames.

This prevents a normal link from downloading or navigating back to the SPA.

## Migration

Scan vault Markdown for ordinary links to local-file tokens, resolve each token
through `local_file_links.json`, and rewrite it as a CommonMark file URL.

Do not modify:

- Image syntax.
- BlockNote media attributes.
- Frames or inline binary embeds.
- Unresolvable tokens.
- Files outside the selected vault.

Wrap file URLs containing spaces or non-ASCII characters in angle brackets.
Read and write UTF-8.

## Safety

- Dry-run by default.
- Require `--apply` for mutation.
- Back up each changed file once per run.
- Do not write unchanged files.
- Keep token records until a separate reference audit proves they are unused.
- Continue after online-only read failures and report them.
- Rerunning after apply produces zero changes.

Use the writable vault path appropriate to the selected runtime. Native mode is
the default; historical Docker instructions using `/vault` are deployment-only
and must not become hard-coded runtime assumptions.

## Frontend requirements

Markdown URL transformation must preserve `file://` rather than sanitizing it
to an empty link. The capture-phase file-link interceptor then opens it through
the host helper.

Do not use a document-wide `MutationObserver` over the BlockNote subtree.
Large editor render bursts make repeated subtree scans prohibitively expensive.
A window/document capture listener runs before descendant propagation and is
sufficient.

## QA

1. Create a disposable normal local-file link and inline media embed.
2. Dry-run and verify only the normal link is selected.
3. Apply and inspect the file URL plus backup.
4. Click the link and verify the native application opens.
5. Verify inline media still renders through its token.
6. Rerun and expect zero changes.
