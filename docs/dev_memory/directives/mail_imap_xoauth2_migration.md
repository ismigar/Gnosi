# Gmail API to IMAP and XOAUTH2 Migration

> ID: `MAIL-IMAP-XOAUTH2-20260507`
> Status: active and implemented

## Objective

Unify Google, Microsoft, iCloud, and manual mail accounts under IMAP/SMTP while
retaining OAuth where supported. This enables shared mail logic and IMAP IDLE.

Moving from Gmail API does not change Google's testing-mode refresh-token
expiry. A Google OAuth application must be published to avoid the seven-day
testing limitation.

## XOAUTH2

SASL payload:

```text
user={email}\x01auth=Bearer {access_token}\x01\x01
```

IMAP uses `authenticate("XOAUTH2", ...)`; SMTP uses an explicit
`AUTH XOAUTH2` command. Never call password login for OAuth accounts.

Access tokens expire in about one hour. Refresh before connection and recreate
pooled sessions at or before token expiry. `invalid_grant` requires user
reauthorization.

## Provider defaults

| Provider | IMAP | SMTP | Encryption |
|---|---|---|---|
| Google | `imap.gmail.com:993` | `smtp.gmail.com:465` | SSL |
| Microsoft 365 | `outlook.office365.com:993` | `smtp.office365.com:587` | SSL / STARTTLS |
| iCloud | `imap.mail.me.com:993` | `smtp.mail.me.com:587` | SSL / STARTTLS |

Google IMAP/SMTP OAuth requires the full-mail scope.

## Architecture

- `oauth2_helpers.py`: refresh and XOAUTH2 formatting.
- `hybrid_mail_service.py`: on-demand IMAP reads.
- `imap_mail_sync_service.py`: synchronization and actions.
- `imap_idle_service.py`: per-account push workers.
- Google OAuth service: initial consent and token lifecycle only.

Mail routes prefer the IMAP path for every IMAP-eligible account, including
Google OAuth accounts.

## Implemented phases

1. IMAP reading through XOAUTH2.
2. SMTP send and IMAP draft append.
3. Trash, move, archive, star, and read actions through IMAP.
4. IMAP IDLE workers with SSE refresh events.

`pipeline/sandbox/migrate_google_to_imap.py` adds missing Gmail defaults
idempotently and leaves already configured accounts unchanged.

## Gmail specifics

- Discover special folders through RFC 6154 flags rather than translated names.
- Gmail All Mail is the archive folder.
- Draft append uses the discovered Drafts folder and may briefly lag in Gmail's
  web UI.
- Fetch and use `X-GM-THRID` for thread grouping, with Message-ID fallback for
  non-Gmail servers.

## FETCH parsing restriction

Servers may return FLAGS after the header literal in a separate bytes element.
Concatenate the tuple prefix with its following bytes element before parsing
UID, FLAGS, and `X-GM-THRID`. Parsing only the tuple prefix can mark every
message unread even when mailbox counts are correct.

## Credential-change invalidation

After an integration update, compare sensitive mail connection fields before
and after the write. For accounts with real changes:

- Invalidate the IMAP pool.
- Clear the last authentication error.
- Clear counts and message caches.
- Restart the IDLE worker.

Masked password placeholders are not new credentials and must not trigger an
update or invalidation.

## Health display

Do not use a persistent browser error set as the sole source of truth. When the
mail settings tab opens, perform a passive counts health check per account and
update the displayed state.

## Secret persistence

Integration secrets live under local data, as defined by
`environment_integrity.md`. They do not belong in the Git tree or vault.
Legacy Docker migrations must copy the newest runtime secrets to durable local
data before introducing a mount; never overwrite newer runtime tokens with an
old host file.

## IMAP IDLE

- One worker per eligible account.
- Renew IDLE before common server limits.
- Reconnect with exponential backoff.
- Publish EXISTS, EXPUNGE, and FETCH events to internal subscribers.
- Fall back to polling when a server lacks IDLE.
- Refresh XOAUTH2 during reconnection.

## QA

1. Load Inbox and confirm the IMAP/XOAUTH2 path.
2. Read, move, archive, star, and trash a message; verify in provider webmail.
3. Send mail and save/replace a draft.
4. Verify thread grouping across Inbox and Sent.
5. Confirm IDLE produces SSE refresh without manual polling.
6. Change credentials and prove pools and workers restart immediately.
7. Confirm the Google OAuth health endpoint reports token failures without
   exposing secrets.
