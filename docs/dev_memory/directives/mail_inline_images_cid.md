# Directive: Inline mail images with Content-ID

## Problem

Mail editor image paste and drop upload images to Vault assets and insert
local `/api/vault/assets/...` URLs. Those URLs work only inside Gnosi, so a
recipient receives a broken image.

Related failures:

- pasted non-image files became local Vault links instead of attachments;
- Microsoft Graph send paths silently dropped all attachments.

## Design

Keep Vault URLs while editing and saving drafts. Convert them only when
building the outgoing message. The backend replaces local image sources with
`cid:` references and attaches the bytes as MIME inline parts.

Do not use data URIs; major mail clients strip or block them. Backend
conversion covers compose, reply, forward, resumed drafts, and signatures
without duplicating frontend logic.

## Backend

`backend/services/mail_inline_images.py`:

- finds image `src` attributes pointing to Vault assets;
- resolves them under the active Vault `Assets/` directory with containment;
- replaces each unique URL with a stable message-local Content-ID;
- returns filename, content type, bytes, and Content-ID;
- builds shared MIME structure:
  HTML plus inline images under `multipart/related`, then normal attachments
  under `multipart/mixed`.

Mail routes run extraction before dispatch. Gmail, SMTP/IMAP, and Microsoft
services accept both normal and inline attachments. Graph maps inline files
to `fileAttachment` with base64 `contentBytes`, `isInline`, and `contentId`.

## Frontend paste behavior

`MailBlockEditor.jsx` intercepts file paste in capture phase before BlockNote:

- image file → upload and insert an image block;
- non-image file → call `onAttachFile`, show an i18n toast, and do not insert a
  local link.

Keep a secondary guard in BlockNote's upload path for slash-menu file
insertion.

Do not intercept clipboard data that includes `text/html`; rich content from
Word or the web can contain valid remote images and should follow BlockNote's
HTML paste path.

## Restrictions

- Reject asset traversal. On missing, unreadable, online-only, zero-byte, or
  non-image files, preserve the original source, log a warning, and continue
  sending.
- Deduplicate repeated URLs to one MIME part and one Content-ID.
- Force UTF-8 for text MIME parts.
- Drafts intentionally retain Vault URLs. Sending a synchronized draft from
  an external Gmail UI remains outside this conversion path.

## Quoted inline images

Replies and forwards originally preserved `cid:` sources from the source
message without copying their MIME parts. BlockNote also drops
`<img src="cid:...">` and block content inside `<blockquote>`.

`buildQuotedHtml` therefore:

- uses an Outlook-style header and `<hr>` rather than wrapping the complete
  quote in `<blockquote>`;
- rewrites source `cid:` values to self-contained
  `/api/mail/messages/{id}/cid/{cid}?email=...&folder=...` URLs that BlockNote
  preserves and previews.

At send time, the backend detects these CID endpoint URLs, fetches the source
message once per message, extracts requested parts, creates new inline
attachments, and rewrites the body with new Content-IDs.

For raw `cid:` that still reaches a reply body, resolve against the explicit
source message and folder. URL account and folder context takes precedence
because quoted content can originate from another account.

Graph provides bytes only for file attachments; preserve unsupported
reference attachments. Missing source messages, accounts, or parts never
block the remainder of the send.

## Security and performance

- Resolve only mail accounts in the active workspace.
- Group all images from one quoted message into one provider fetch.
- Run conversion before transport account resolution so helper behavior can
  be tested independently.

## QA

- Unit tests cover relative, absolute, encoded, duplicate, missing, traversal,
  online-only, and non-image sources plus MIME structure.
- Reply tests cover raw CID, CID endpoint URLs, partial recovery, grouping,
  transport failures, and Graph mapping.
- Browser tests verify image paste becomes an inline block, non-image paste
  becomes an attachment badge, and quoted images survive BlockNote.
- Frontend build and lint pass.
- Final provider QA sends real compose and reply messages through Gmail,
  SMTP/IMAP, and Microsoft and inspects received MIME.

Use `--form-string` rather than `curl -F` for HTML bodies; `-F` treats a value
starting with `<` as a filename.
