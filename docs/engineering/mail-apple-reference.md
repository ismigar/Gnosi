---
status: partial
last_verified: 2026-10-17
source_paths:
  - backend/domains/mail
  - frontend/src/features/mail
  - backend/services/microsoft_mail_service.py
tests:
  - backend/tests/test_mail_move_identity.py
  - backend/tests/test_mail_cache_scope.py
  - backend/tests/test_mail_archive_listing.py
  - backend/tests/test_mail_archive_identity.py
  - backend/tests/test_mail_connection_lifecycle.py
  - backend/tests/test_mail_conversation_truthfulness.py
  - backend/tests/test_mail_ordered_header_listing.py
  - backend/tests/test_mail_detail_responsiveness.py
  - backend/tests/test_mail_read_negative_contract.py
  - frontend/src/features/mail/components/MailViewer.loading.test.tsx
  - tests/e2e/tests/disposable/mail-archive-pagination.spec.ts
  - tests/e2e/tests/disposable/mail-reader-responsiveness.spec.ts
---

# Apple Mail reference and Gnosi coverage

This investigation uses the installed Apple Mail 16.0, build 3901.100.1.1.12,
as a behavioral reference for improving Gnosi's mail module. The executable's
SHA-256 is `9e1d4526c45462d3facdfe47e133c42d97ead0fd97229dfc6ef5a0eab2e44aec`.
Apple implementation code and assets are not incorporated into Gnosi.

## Evidence and its limits

REA decoded all 107 compiled interface documents with an exact path/hash union:
2,057 labeled/action controls, 595 authored action connections, 359 distinct
selectors and 112 shortcut declarations. Seventy English localization tables
and the scripting definition provide additional declarations. These are static
observations of shipped interfaces, not execution or performance measurements.

The original-bundle UI record is
`ev_2d60c93b3784f4bfb6d28a5cc15692cd0fb15675c27a1cfc6668e48f34bd6941`.
The decoder's 64-document limit required a second pass over 43 byte-identical
resources in a distinct, non-executable analysis carrier, recorded as
`ev_fd593629b7968addfc22971fb12419e41ea7d64c12a65cff3ecea039ee8b0a05`.
The two passes have no overlapping or missing original document paths. The
temporary carrier was removed after exporting evidence.

`PreferencesWindow.loctable` declares a dedicated Archive Mailbox mapping, and
the compiled preferences connect its selector. `ViewerPreferences.loctable`
declares related messages, newest-first ordering and read behavior. `Mail.sdef`
declares caching all IMAP messages with or without attachments. These declarations
alone do not establish runtime behavior. The native observations below give a
more specific, still static reference. Private provider services and system
framework behavior require separate evidence. Interface coverage does not mean
complete functional reproduction or compatibility.

## Native conversation loading

REA/Ghidra inspected the shipped executable without launching Mail or reading
personal messages. The complete native evidence export contains 17 records;
its SHA-256 is
`129707b63e9075725b31b680fb955e2ebbc60ea8a7c0c2ee9442932ca07ff412`.
Canonical addresses and evidence IDs identify the observed procedures:

| Procedure | Static observation | REA evidence |
| --- | --- | --- |
| `ConversationPrefetcher::initWithMessageListContentController:messagesTableView:` (`0x10008214c`) | Creates an `NSCache` named `ConversationPre-FetchCache` with a count limit of 50 and observes scrolling. | `ev_fa7824691df165d433ae2ae6f0a8122afb53b8f7fd241172423490e3715cab0b` |
| `_prefetchVisibleConversations:` (`0x100082520`) | Resolves visible table rows, uses conversation IDs as cache keys, and starts asynchronous member loading for missing conversations. | `ev_2cc61803626bfcdcef5c971285210d249c1017f7d628b444ef26cdd9e268f011` |
| `_armTimerWithDelay:` (`0x1000823a8`) | Resets a pending timer; the configured delay is 0.5 seconds and tolerance is half the delay. | `ev_70f9eed5ec18bb84493c275d867d41892580cf18d0baa9dffb452e9fc5d48de7` |
| Prefetch completion block (`0x1000828f8`) | Checks that the cache entry still exists and prepares at most seven ordered members around the initial reading position. | `ev_8f1d539fba64e142c477c3d076f362edef762d0484d118dbeaeb04ec15116773` |
| Member preparation block (`0x1000829d0`) | Calls `asyncLoadAllowingRemoteFetch:reloadBanners:completionHandler:` with arguments `false, true, nil`. | `ev_f24b1a6a24c5954202253a8128275fe78b4c58ad551bb642c4a7f461bdb7dbfd` |
| Cache eviction block (`0x100082ad4`) | Runs on the main thread and calls `cancelLoad` for the conversation's members. | `ev_a40b73b4d199efd1d2fcef64f7149bb5b6a1c4e1ebf7866712f832ba26e378fe` |
| `Conversation::asyncLoadConversationMembers` (`0x100077afc`) | Reuses loaded members, tracks completion callbacks and initial messages, and schedules a quick-fetch timeout of 0.25 seconds. | `ev_26327235dd05d4b42ab1697e8632e1bc9b26a71d35ce36c90857b5522506a57a` |
| `Conversation::_quickFetchTimeout` (`0x100077fbc`) | Publishes available initial messages and invokes waiting callbacks. | `ev_b89bc7b39845cf75858696637d657cd325dd9e8d08f1de0103ac8784e47e545c` |
| `ConversationMember::cancelLoad` (`0x10007c8c8`) | Cancels the document generator and clears loading state. | `ev_73a8b31cd6c3cbb7ba0b6b9e78e715eee9630c23af9bb03d7964716191b09ccd` |

These observations support asynchronous preparation, bounded reuse, partial
conversation availability and cancellation as design references. They do not
measure actual latency. In particular, the observed prefetch call disables
`allowingRemoteFetch`; claiming that it eagerly downloads remote message bodies
would go beyond the evidence. The called MailUI implementation, durable message
storage, provider connection scheduling and complete offline semantics were not
traced. Gnosi's separate IMAP body connection and its 16-entry/4-MiB/five-minute
reader cache are independent implementation choices, not recovered Apple values.

## Functional coverage

“Existing” describes inspected Gnosi source, not equivalence to every Apple
operation. “Partial” identifies a concrete remaining product gap. Planned work
does not acquire acceptance from passing the archive/reader regressions.

| Apple Mail surface | Gnosi implementation and remaining work |
| --- | --- |
| Mailboxes, favorites, quick open and tabs | Existing unified/account navigation; custom-folder discovery is preserved. A complete account-specific folder tree, favorites and mailbox quick-open remain partial. |
| Archive, move, copy and delete | Archive/All Mail listing and archive-label handling corrected; existing move/trash actions. Copy and complete custom-mailbox lifecycle remain partial. |
| Conversations and related messages | Existing expandable Gmail conversations; body reuse and cancellation corrected. Generic IMAP References/In-Reply-To reconstruction remains partial. |
| Reader, headers, source and appearance | Existing sanitized HTML/text reader, preview and themes. Complete raw source/header tools and per-message appearance remain partial. |
| Read state, flags and priority | Existing read/star actions; background operations leave the event loop available. Colored flags, complete priorities and all-message state controls remain partial. |
| Search, sorting and filters | Full provider text search and pagination corrected; existing sort/filter UI. Advanced server query composition and all attachment metadata remain partial. |
| Smart mailboxes and saved searches | Existing persisted saved views with AND/OR filters. Criteria still operate on loaded rows and are not a complete server query engine. |
| Categories and priority inbox | Existing categories. Persistent sender categorization and time-sensitive priorities remain partial. |
| Composer, recipients, aliases and groups | Existing editor, To/Cc/Bcc, identities, completion and aliases. Full group/address-header controls remain partial. |
| Drafts, delivery, scheduled send and undo | Existing drafts and immediate delivery. Durable offline outbox, scheduling and undo-send remain to implement. |
| Replies, forwarding and redirect | Existing reply/reply-all/forward with preserved quoted CID images. Redirect and forwarding as an attached message remain partial. |
| Attachments and previews | Existing downloads, PDF preview, CID and constrained remote images. Complete attachment actions, image-sizing workflow and Mail Drop equivalent remain partial. |
| Rich text, fonts and spelling | Existing rich editor. All message-specific plain/rich-text conversion and spelling/typography controls remain partial. |
| Signatures | Existing identity signatures. Signature management parity remains to verify. |
| Mailbox synchronization, rebuild and quota | Existing IMAP sync/IDLE and explicit refresh. Full reconciliation/rebuild, quota and account maintenance UI remain partial. |
| Import, export and printing | Local Markdown/HTML copies exist. Mailbox import/export, EML/mbox interchange, mail printing and PDF export remain partial. |
| Incoming rules and their actions | Saved views configure display controls. A persistent incoming-rule evaluator and rule actions remain to implement. |
| Accounts, SMTP, TLS and authentication | Existing Google IMAP OAuth, manual IMAP/SMTP and Microsoft Graph. POP and full Exchange-specific account behavior are not reproduced. |
| Offline storage and diagnostics | Existing local copies and bounded list/body caches. A complete durable offline mailbox and Connection Doctor-style diagnostics remain partial. |
| Remote-content privacy | Existing sandbox, URL/IP/type/size/deadline restrictions and explicit image recovery. This is not an anonymizing privacy relay. |
| Signing and encryption | TLS/credential protection exist. S/MIME signing/encryption and certificate lifecycle are not reproduced. |
| Junk, blocking, mute and unsubscribe | Existing spam actions. Persistent block/mute/unsubscribe workflows remain partial. |
| Reminders, follow-up and notifications | Existing snooze and Gnosi calendar/contacts extraction. Full follow-up and mail-specific notification/focus controls remain partial. |
| Extensions and system integration | Existing Gnosi integrations and agent tools. Apple MailKit extensions and native service contracts are not reproduced. |
| Smart reply, link previews and private addresses | Existing optional AI draft/analysis assistance. Provider-backed private-address and link-preview behavior remain partial. |
| Out-of-office scheduling | Not yet reproduced in the inspected mail module. |
| Accessibility and scripting | Existing shared keyboard/accessibility infrastructure and agent APIs. All Mail shortcuts, scripting objects and macOS service behavior remain partial. |

## Reproduction and validation boundary

The archive defect was reproduced without credentials: a fake IMAP server with
Inbox and archived messages returned only Inbox when `folder=all`. A separate
fixture reproduced archived local notes classified as deleted. The reader
fixtures reproduced a duplicate body request for a Gmail All Mail copy and
request restarts after harmless summary/callback replacement.

Regression coverage checks independent body connections, event-loop availability,
recoverable read deadlines and provider errors, full multi-folder paging,
quoted/literal mailbox discovery, search escaping and UTF-8, account-scoped
archive metadata, original RFC identifiers, label preservation, body identity,
stale results and retry.
Additional regression fixtures cover credential invalidation during login,
separate transport failure handling, all archive folders, imported-date ordering,
incomplete native header reads and 2,001-message batch-cache reuse/reset. A separate
conversation fault fixture verifies HTTP 503 for transport/partial-member errors
and local reading of saved RFC identifiers without remote UID commands. A cold
aggregate listing still needs every matching small header before global sorting;
this is not a complete durable offline metadata index.
Disposable browser tests exercise 121-message All Mail and 61-message Archive
pagination with real scroll geometry and provider-side body search. These results
validate those scenarios, not the remaining functional surfaces in the table.
An additional two-account regression reproduces one unavailable account blocking
pagination of the healthy account and an explicit retry discarding healthy pages.
Account-isolated pagination and retry are required for the unified mailbox.

## Integration sequence

The reference describes a substantial product program. Keep each functional
group's acceptance separate so reader regressions cannot stand in for complete
Mail compatibility:

1. Establish responsive reads, truthful retry, complete Archive/All Mail and
   provider search. The current candidate addresses this foundation.
2. Add the account-specific mailbox tree and lifecycle, generic IMAP conversation
   reconstruction, raw message tools and durable offline reconciliation. Verify
   cross-account and cross-folder identity with synthetic server fixtures.
3. Add durable delivery queues, scheduled/undo send, incoming rules and advanced
   saved searches. Verify restart recovery and failed-provider behavior before
   exposing those controls.
4. Close individual compatibility groups, including import/export/printing,
   richer flags, sender controls, account protocols, encryption and system
   integration, with dedicated acceptance for each supported provider/platform.

Changing the installed application additionally requires a reconciled source
containing every commit recorded in its component manifest, the new mail work
and other accepted concurrent changes. A passing source-worktree check alone
does not establish installed or released acceptance.
