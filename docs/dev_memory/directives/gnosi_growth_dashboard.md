# Gnosi Growth Dashboard

## Objective

Provide a private, zero-cost growth dashboard that preserves daily acquisition,
community, download, AlternativeTo, and GitHub Sponsors history.

## Authoritative location

The dashboard source is an independent application under
`ismigar.github.io/growth-dashboard/`. GitHub Pages publishes its static shell
at `gnosi.temenosismael.org/dashboard/`, while the Cloudflare Worker publishes
the protected API, OAuth flow, redirects, webhooks, and scheduled collectors.
The existing landing pages remain static and do not link to the dashboard.

## Architecture

- GitHub Pages serves the static dashboard shell from `/dashboard/` with
  `noindex`, without a visible landing-page link.
- Cloudflare Workers serves the API, tracked redirects, webhooks, OAuth, and its
  own authenticated dashboard copy.
- D1 stores redirects, daily metric snapshots, release asset counters, sponsor
  events, and synchronization health.
- The Worker implements GitHub OAuth directly and protects the dashboard and
  administrative APIs with short-lived HMAC-signed sessions. Same-origin access
  uses an HttpOnly cookie. The GitHub Pages shell receives a signed bearer
  session in the OAuth redirect fragment, stores it in `sessionStorage`, and
  removes the fragment immediately. CORS permits only the configured dashboard
  origin. Tracked redirects and the signed Sponsors webhook remain public.
- Scheduled jobs collect GitHub and AlternativeTo data every six hours and GA4
  and Sponsors data daily.
- Runtime secrets are Worker secrets. They must never be committed or returned
  to the browser.

## Data semantics

- A tracked redirect records download or repository intent, not a confirmed
  GitHub download.
- Landing CTA clicks and platform-specific installer-link clicks are separate
  GA4 intent signals. Neither may be presented as a confirmed download.
- Confirmed downloads are calculated from release asset counter deltas.
- GitHub traffic is retained as daily snapshots because the upstream API only
  exposes the last fourteen days.
- Issues, pull requests, ratings, and sponsors are outcome branches, not linear
  acquisition funnel stages.
- No visitor IP address, full user agent, or cross-site personal identifier is
  stored.

## Restrictions and edge cases

- Do not subtract a missing release snapshot from a current counter because that
  would classify the lifetime count as a daily download. Use the first snapshot
  as a baseline.
- Do not expose the Sponsors import endpoint based only on client-side UI.
  Require a valid signed session bound to an explicit GitHub login allowlist.
- Do not treat an unlinked or unindexed URL as authentication. Keep all
  dashboard data behind GitHub OAuth and the explicit GitHub login allowlist.
- Do not persist the cross-origin bearer session in `localStorage`, a cookie
  readable by JavaScript, a query parameter, or page markup. Pass it in a URL
  fragment, remove that fragment immediately, and retain it only for the browser
  tab in `sessionStorage`.
- Do not allow wildcard dashboard CORS. Match the exact origin derived from the
  configured HTTPS dashboard URL.
- Do not trust AlternativeTo markup permanently. Version the parser, retain the
  last valid snapshot, and record a degraded synchronization state when expected
  markers disappear.
- Do not discard or hide an authenticated manual AlternativeTo snapshot when
  automated collection returns 403. Retain the snapshot, preserve its manual
  provenance, and expose that provenance in source health.
- Do not count GitHub pull requests as issues. GitHub's issue API includes pull
  requests and they must be filtered or queried separately.
- Do not sum GitHub popular-path snapshots across days. The endpoint returns a
  rolling fourteen-day aggregate, so store total and unique values separately
  and use only the latest snapshot for release-page funnel metrics.
- Do not present daily unique GitHub visitors as total repository visits. Store
  `count` and `uniques` as separate metrics and use the total count for visits.
- Do not use all GitHub repository traffic as the AlternativeTo funnel stage.
  Use GitHub's AlternativeTo referrer aggregate and suppress conversions when
  the rolling upstream window includes visits from before redirect tracking.
- Do not make public GitHub metrics depend on a traffic-enabled token. Repository,
  release, issue, pull request, and download counters work anonymously; isolate
  traffic endpoints so missing credentials degrade only views and referrers.
- Do not present the first release snapshot as zero lifetime downloads. Preserve
  zero as the new-download delta baseline while displaying the latest cumulative
  counters separately.
- Do not deploy paid Cloudflare resources or enable automatic paid upgrades.
- Do not activate Cloudflare Zero Trust Free when checkout requires permission
  to bill usage beyond included allowances. Use Worker-native GitHub OAuth so
  the Workers Free and D1 Free hard limits fail closed without overage billing.
- Do not declare `limits.cpu_ms` on a Free-plan Worker. Cloudflare applies the
  free CPU ceiling automatically and rejects deployments that set this paid-only
  configuration field.
- Do not pass an unchecked Worker response directly into React state. Pages and
  Worker deployments can be temporarily out of step, which can make a missing
  array crash rendering into a blank screen. Normalize optional fields, preserve
  honest unavailable values, and reject unrelated error payloads explicitly.

## Validation

- Unit-test parsing, deltas, funnel calculations, webhook verification, and
  sponsor import normalization.
- Integration-test API behavior with mocked upstream responses and a local D1
  database.
- Build the frontend and Worker with zero TypeScript errors.
- Verify desktop and mobile layouts, empty states, degraded sources, date
  filters, and the public redirect in a real browser.
