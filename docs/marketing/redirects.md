# Outbound support redirects

The static pages under `apps/gnosi/frontend/public/go/` provide short, first-party
redirect URLs for outbound support links. The web server records the request before
the browser is redirected to GitHub Sponsors or Ko-fi, so GoAccess and Webalizer can
count outbound clicks without cookies or a hosted analytics service.

Deploy these paths with the public website:

- `/go/github-sponsors`
- `/go/kofi`

The GitHub Sponsors redirect maps the `utm_source` value to a stable
`metadata_campaign` value. The Ko-fi redirect forwards the three standard UTM
parameters. These redirects measure clicks only; they cannot confirm a completed
sponsorship or donation.

If the Pangea website is deployed from a different source tree, copy the two `go/`
directories into that site's public root after each release.
