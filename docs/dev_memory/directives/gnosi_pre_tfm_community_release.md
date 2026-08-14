# Directive: Gnosi pre-TFM community release sprint

> ID: GNOSI-PRE-TFM-COMMUNITY-RELEASE-20260814
> Last updated: 2026-08-14
> Status: ACTIVE

## 1. Objective and scope

Prepare Gnosi for a low-maintenance community release before the maintainer
focuses on the TFM. This is a product-clarity and distribution sprint, not the
creation of a startup or a new feature roadmap.

The public story must describe Gnosi as a sovereign research workspace for
people who turn sources into long-form writing. The primary path is source,
evidence, connected knowledge, and verifiable citation. Secondary capabilities
remain available but must not dominate the first screen.

Success requires complete, equivalent public communication in Catalan,
Spanish, and English, plus validated installation and measurement surfaces.

## 2. Authoritative inputs and outputs

### Inputs

- Product behavior under `monorepo/apps/gnosi/`.
- Public landing source under `ismigar.github.io/`.
- Growth dashboard source under `ismigar.github.io/growth-dashboard/`.
- Distribution, local-first, reference-manager, and evidence-note directives.
- Current GitHub release assets and the existing unsigned-desktop limitation.

### Outputs

- Three semantically equivalent landing pages: English, Catalan, and Spanish.
- A concise English repository README with equivalent Catalan and Spanish
  variants linked from every variant.
- A demonstrable first-use research path, using a deterministic starter
  workspace or guided empty state rather than requiring AI credentials.
- Dashboard labels and calculations that distinguish human-facing installer
  downloads from extensions, metadata, and updater artifacts.
- Community announcement and feedback material in all three public languages.
- Automated, build, browser, responsive, and end-to-end validation evidence.

## 3. Product and content decisions

1. Use “From source to manuscript, with your knowledge always yours” as the
   English positioning line, with natural Catalan and Spanish equivalents.
2. Address researchers, postgraduate students, analysts, and long-form writers
   without claiming that Gnosi is exclusively academic.
3. Lead with the desktop download. Present native self-hosting and Docker as
   secondary technical options.
4. Explain the golden path as capture or import, read and preserve evidence,
   connect and synthesize, then cite in Word or LibreOffice.
5. Treat Markdown portability, local-first operation, provenance, and open
   source licensing as trust evidence, not as abstract slogans.
6. Keep mail, social, photos, Drupal, and generic project-management features
   out of the primary landing hierarchy.
7. Do not imply that unsigned desktop builds are signed or frictionless.

## 4. Localization contract

- The public site has three active locales: `en`, `ca`, and `es`.
- All three pages must have matching semantic structure, CTA destinations,
  language navigation, accessibility labels, analytics attributes, and
  metadata intent.
- Public Catalan and Spanish translations should be idiomatic, not literal.
- The React application still supports `ca`, `en`, `es`, and `fr`; any new
  in-app string must be added to all four catalogs even though the public
  campaign has three languages.
- English remains the code, comment, log, directive, and fallback language.

## 5. Measurement contract

- Never present GitHub asset totals as people, installations, or a sequential
  conversion funnel.
- Classify signed or unsigned desktop installers separately from extensions,
  update metadata, and other assets.
- Display observations from incompatible sources or time windows as a journey
  overview without calculating a conversion percentage between them.
- Preserve cumulative totals and period deltas as separate concepts.
- Do not add content telemetry or collect vault names, paths, titles, sources,
  or notes.
- Public download and feedback links must carry stable, non-personal campaign
  parameters when useful for aggregate attribution.

## 6. Installation and first-use contract

- The public CTA reaches the latest desktop release in no more than two clicks.
- Unsigned-build instructions are visible before or next to the download.
- A useful demonstration must work without an AI provider, mail account,
  calendar account, Docker, or a hosted Gnosi server.
- The sample path must show at least a source, verifiable evidence, a connected
  synthesis note, and a citation handoff.
- Self-host instructions must remain valid in native and Docker deployment
  modes and must not contain local machine paths.

## 7. Restrictions and edge cases

- Do not add new product integrations during this sprint.
- Do not market beta collaboration as complete collaborative editing.
- Do not add invasive first-run analytics to improve the dashboard.
- Do not count `latest*.yml`, block maps, manifests, extension archives, or
  auto-update metadata as desktop installer downloads.
- Do not hard-code a release candidate tag in the primary desktop CTA; use the
  latest release URL unless an asset-specific link is verified stable.
- Do not use Jest-only `--runInBand` with Vitest; it is an unknown option. Run
  the dashboard’s declared `npm test` command instead.
- Do not change only one localized landing page. The parity gate intentionally
  rejects partial locale edits.

## 8. Validation gates

1. Run public-site locale parity and responsive contract tests.
2. Run dashboard unit tests and its production build.
3. Run the Gnosi frontend locale registry tests and production build when the
   application or its locale catalogs change.
4. Run the relevant E2E path against the real local native runtime.
5. Inspect English, Catalan, and Spanish landing pages at desktop and mobile
   widths in the in-app browser and capture visual evidence.
6. Inspect the dashboard in the browser and verify that no invalid sequential
   conversion claim remains.
7. Run the engineering documentation pre-PR gate for covered repository paths,
   then run it again after staging and require a deterministic clean result.
8. Review the final diff against this directive before commit and publication.

## 9. Stopping rule after release

After publication, freeze feature work until the TFM is complete. Accept only
security fixes, data-loss fixes, blocked installation fixes, and severe
regressions. Review aggregate release and feedback signals monthly; absence of
growth is not an instruction to resume broad feature development.

## 10. Learning log

| Date | Finding | Rule |
| --- | --- | --- |
| 2026-08-14 | The dashboard test invocation failed before collection. | Use the repository’s Vitest command without Jest-specific flags. |
| 2026-08-14 | Vault-template route tests tried to create `/app/data` during native collection. | Set `GNOSI_LOCAL_DATA` and `DIGITAL_BRAIN_VAULT_PATH` to isolated writable test directories; `/app` is a Docker path, not a native test default. |
| 2026-08-14 | The “submission broker not configured” test inherited the maintainer's private broker URL. | Delete `GNOSI_MARKETPLACE_SUBMISSION_URL` inside that test so the asserted state is deterministic. |
| 2026-08-14 | Dashboard E2E language buttons matched substrings in unrelated controls. | Use exact accessible-name matching for the two-letter locale controls and assert the current localized heading text. |
| 2026-08-14 | A raw demo-source message appeared as a Catalan tooltip in the English dashboard. | Do not expose backend or fixture status messages directly; map user-visible source health to locale keys. |
| 2026-08-14 | The mocked mobile sync confirmation exceeded Playwright's default assertion timeout only under the full parallel suite. | Keep the stable status assertion, but allow ten seconds for the two-step sync-and-refresh path under concurrent browser load. |
| 2026-08-14 | Starting uvicorn directly inherited Docker-oriented `/app/data` defaults and failed on the native host. | Start local runtime validation through `sh/run_native_dev.sh`, which supplies the native data, vault, and provider contract. |
