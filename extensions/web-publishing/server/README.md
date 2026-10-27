# Private website service

This service handles contact messages and subscriptions independently from a
static website release. PHP 8.2+, PDO SQLite, DOM, mbstring and OpenSSL are
required. No Composer dependencies or background Gnosi process are required.

Install this complete `server` directory outside the document root. Copy
`public/api/{common,contact,newsletter}.php` into the site's public `api/`.
The optional loopback preview router is maintained by the renderer. Each site
gets its own database, spool directory and configuration; reusing a database
for a different site ID fails closed. Directories should be `0700`, files
`0600`; the PHP/SSH execution account needs access. Public handlers reject
configuration, libraries and persistence inside the document root.

## Configuration

Set `GNOSI_SITES_SERVICE_CONFIG` to an absolute private JSON filename for both
the CLI and the PHP worker. Minimal test configuration:

```json
{
  "site_id": "example",
  "public_base_url": "http://127.0.0.1:4321",
  "library_path": "/PRIVATE/server/library.php",
  "db_path": "/PRIVATE/example/state.sqlite",
  "spool_path": "/PRIVATE/example/captures",
  "test_mode": true,
  "languages": ["ca", "es", "en-gb"],
  "forms": [],
  "form_delivery": {},
  "smtp": {}
}
```

`forms` uses Gnosi's `SiteForm` shape: `id`, `revision`, `enabled`, `fields`,
`confirmation`, `redirect_path`, `require_privacy`, `privacy_text`,
`newsletter_list`, and translated presentation fields. Each contact form has
exactly one email field. Fields have `id`, `type`, translated `label`, `required`,
`max_length` and string `options` for select/radio. Other display properties are
retained but do not change server validation. Forms are seeded only on first
use; `forms_sync` installs a complete validated published configuration.

`form_delivery` is private: `{form_id: {recipients:[email], subject:string,
autoresponse:false, autoresponse_text:{language:text}}}`. Recipients and SMTP
credentials never belong in the public form definitions. No notification is
queued when no recipient is configured; the message is still saved and its
notification state is `not_configured`.

Test mode accepts only `.invalid` addresses, writes private JSON captures, and
does not open SMTP connections. Real delivery requires both `test_mode:false`
and `allow_delivery:true` in private configuration. SMTP takes `host`, `port`,
`security` (`starttls` or `tls`), `username`, `password`, `from`, and optional
`per_minute` (default 20, maximum 100). TLS validates the peer and hostname.
`security:none` exists solely with `allow_insecure_loopback:true` and a literal
loopback host, for disposable fake SMTP tests. There is no `mail()` fallback.

## Public contracts

Contact POST (`api/contact.php`), JSON or form encoded:

```json
{
  "form_id": "contact",
  "revision": 1,
  "language": "ca",
  "_request_id": "random-browser-UUID",
  "values": {"email": "visitor@example.invalid", "message": "Hello"},
  "website": "",
  "privacy": "1",
  "newsletter_opt_in": "1"
}
```

The browser retains `_request_id` while retrying a draft and generates another
after successful submission. Replaying an ID with different validated content
returns `request_conflict`. Without JavaScript, an empty ID uses a private-keyed
hash of body, client address and ten-minute bucket to collapse immediate repeat
submissions. Static pages must not embed a build-time ID shared by visitors.
The raw address is not persisted. Requests are bounded to 1 MiB; five submissions
per address per hour are processed, with generic output for throttled/honeypot
submissions. Origin, or Referer fallback, must match the configured origin.

`Accept: application/json` returns `{received:true,id,message,redirect_path}`.
Validation errors return 422 with `{error:"validation",fields:{id:reason},message}`;
unavailability returns 503. Notification transport runs separately, so receipt
means durable storage, not SMTP delivery. No-JavaScript validation displays an
escaped form retaining entered values. A configured successful redirect must
be a canonical same-site path, prefixed for subdirectory installations.

Newsletter POST (`api/newsletter.php`) takes `action:"subscribe"`, `email`,
`language`, `list_id` (default `main`), `interests:[]`, `consent:"1"`, `website:""`.
An independent contact opt-in requests the same double-opt-in flow. Confirmation
links never modify state on GET; POST submits `action:"confirm"|"unsubscribe"|
"preferences"` and `token`. Preferences additionally accept language/interests.
Confirmation tokens expire after 24 hours; lifecycle links remain valid for 90 days after delivery. Scheduled messages initially bind that period to their scheduled time, and the worker extends unused lifecycle tokens when a delayed message is actually delivered. Tokens
are single-use and stored hashed. Campaigns include list/global unsubscribe and
preferences links. Public lifecycle output does not disclose token validity.

## Authenticated private CLI

`captured_get` takes only a queue `id` and returns a bounded, regular private capture whose identity, kind and synthetic recipient match the captured queue row. It is disabled outside capture-only test mode. `captured_apply` additionally takes a validated `link_index`; preference actions accept `language` and `interests`. URLs/tokens are recovered from that capture and must match the configured public endpoint, subscriber and queue-token binding. The browser cannot submit an arbitrary token or destination. It invokes the same single-use token operation as public POST, without sending email or removing HTTP authentication. These actions are available only through the administrator-authenticated Gnosi service API/CLI, never through public handlers.

Run `php /PRIVATE/server/cli.php` with one JSON object on stdin, at most 1 MiB:
`{"action":"status","request":{}}`. One JSON object is emitted on stdout;
errors exit 1 with a safe code. Invoke only through Gnosi's authenticated scoped
backend or the existing authenticated SSH bridge; never expose CLI administration
as a public HTTP action.

| Action | Request | Result |
| --- | --- | --- |
| `status` | `{}` | `schema_version,site_id,test_mode,subscribers,messages,queue,campaigns` |
| `forms_sync` | `{forms:[SiteForm],form_delivery?:private map}` | `{count}` |
| `messages_list`, `messages_export` | `{q?,form_id?,status?,offset?,limit?}` | `{items,total}` |
| `messages_update` | `{id,status:new/read/resolved/spam}` | `{updated}` |
| `messages_delete` | `{ids:[id]}` | `{deleted}` |
| `subscribers_list`, `subscribers_export` | `{q?,language?,list_id?,status?,offset?,limit?}` | `{items,total}` |
| `subscribers_import` | `{items:[{email,language,list_id,interests,status,consent_at,consent_revision}]}` | `{imported,skipped,rejected}` |
| `subscribers_update` | `{id,language?,interests?,status?,list_id?}` | `{updated}` |
| `campaign_preview` | `{subject,body_html,body_text?,language,list_id?,interests?}` | `{preview_id,subject,body_html,body_text,recipient_count,expires_at,test_mode}` |
| `campaign_queue` | `{preview_id,scheduled_at?:ISO8601}` | `{campaign_id,queued,status,test_mode}` |
| `campaigns_list` | `{}` | `{items}` |
| `campaign_pause` | `{id,paused:true/false}` | `{updated}` |
| `queue_list` | `{}` | `{items}` |
| `worker` | `{limit?:20}` | `{processed,accepted,rejected,uncertain,captured,suppressed,pending}` |
| `reconcile` | `{id,status:accepted/rejected/pending}` | `{updated}` for an uncertain delivery |
| `retention` | `{days:0..3650}` | `{days}`; 0 disables automatic cleanup |
| `maintenance` | `{}` | `{deleted}` up to 1000 expired messages |

List actions default to 100 items, maximum 1000, and support offset pagination.
Exports use the same paginated JSON contract; callers must collect every page.
Message fields preserve their submitted label/value and form revision. Contact
and autoresponse queue records disappear when deleting their message. Imports
never reactivate suppressed/unsubscribed addresses or overwrite existing active
consent; an active *new* import requires historical consent time and revision.
Otherwise imported subscriptions remain pending. Self-requested resubscription
requires a fresh confirmation; admin edits cannot activate inactive subscribers.

Previews last fifteen minutes and bind content plus exact audience and consent
revisions. Queueing the same preview is idempotent. A campaign's HTML is filtered
and wrapped in a separate trusted email theme; no arbitrary web CSS is reused.

## Persistent worker

Deployments may launch `php /PRIVATE/server/daemon.php` with the private config environment. This detached process checks the queue every 30 seconds, re-reads configuration and holds a private single-instance lock. It runs independently of Gnosi. Status exposes a heartbeat and whether the lock is currently held; stale PID files never establish health. Create `SPOOL/.daemon-stop` to stop it, and remove that marker before an intentional restart. `--once` performs one iteration for disposable checks. Site identity, database or spool changes stop the daemon rather than switching its authority.

Run `php /PRIVATE/server/worker.php` periodically using the server's scheduler,
for example every minute with the private environment variable configured. The
worker handles due messages, respects paused campaigns and rate limits, checks
subscription status, then performs retention maintenance. It works without Gnosi.
Only one worker owns the spool lock. A crashed `sending` delivery becomes
`uncertain`; it is never automatically retried. Operators reconcile it explicitly
after investigating SMTP logs. `accepted` means SMTP accepted DATA, not delivery
to an inbox or reading. Pre-DATA transient failures remain pending with a delay;
definitive refusals are rejected. Test captures are atomic and idempotent.

Keep database, WAL/SHM and spool together in private backups. Static release
rollback does not roll back messages, consent, suppressions or campaign history.
Old public form definitions are replaced on `forms_sync`; old received messages
retain their own schema snapshot. Automatic retention is disabled by default.

## Disposable verification

```sh
php extensions/web-publishing/server/test.php
python3 extensions/web-publishing/server/test_http.py
```

The tests use temporary directories and synthetic addresses. They do not contact
Pangea, production services, real subscribers or a live SMTP server.
