# Gnosi marketing analytics

## Plausible setup

Create the site `gnosi.temenosismael.org` in Plausible and keep the script in
`apps/gnosi/frontend/index.html`. The application sends optional custom events
when Plausible is available:

- `outbound_click` with `destination=github_repository`
- `outbound_click` with `destination=github_sponsors`
- `outbound_click` with `destination=ko_fi`
- `outbound_click` with `destination=support_page`

Configure goals for the `outbound_click` event and segment by `destination`.
UTM parameters are already included on the public marketing links. Keep the
campaign names stable so monthly comparisons remain meaningful.

## Monthly report

Record these values on the first day of each month:

1. Visitors and pageviews.
2. Top sources and `alternativeto` campaign visitors.
3. Demo, GitHub, Sponsor and Ko-fi outbound clicks.
4. GitHub stars, forks, visitors and clones.
5. New sponsors, cancellations and recurring monthly value.

The key funnel is:

`AlternativeTo visitors → website visitors → GitHub/demo clicks → Sponsor clicks → sponsors`

GitHub repository traffic should be exported or recorded weekly because GitHub
only exposes detailed repository traffic for a rolling 14-day window.
