# Gnosi Release Candidate Process

> ID: GNOSI_RELEASE_CANDIDATE_2026_08
> Associated Script: `monorepo/apps/gnosi/electron/release.sh`
> Last Update: 2026-08-01
> Status: ACTIVE

## Objective and scope

Prepare release candidates with one version across the web interface and the
desktop packages, validate the distributable surfaces, and create tags only
from the reviewed `main` commit.

Success requires matching frontend and Electron versions, a clean frontend
build, passing unit tests, browser verification against the native services,
and successful release jobs for every supported operating system.

## Inputs and outputs

The input is a semantic version accepted by npm, including prerelease forms
such as `0.3.0-rc.1`. The preparation script updates the frontend and Electron
package manifests. The Git tag uses the same value prefixed with `v`.

The release workflow publishes a draft in the public Gnosi repository. A
prerelease suffix makes the GitHub release a prerelease automatically.

## Logical flow

1. Start from an up-to-date, clean branch based on `main`.
2. Run the preparation script with the target version.
3. Verify that both package manifests and the monorepo lockfile agree.
4. Run lint, i18n validation, frontend unit tests, and the production build.
5. Validate the native backend and frontend through the browser.
6. Open and merge a focused pull request containing the version preparation.
7. Create the matching annotated tag on the merged `main` commit and push it
   through the SSH remote.
8. Wait for all release jobs and inspect the generated draft before publishing
   it manually.

## Restrictions and edge cases

- Do not create the release tag from a feature branch because the tag must
  identify reviewed code that exists on `main`.
- Do not update only Electron because the Control Center reads the frontend
  package version and would display a different release.
- Do not publish the draft automatically. The workflow deliberately leaves the
  public release in draft state for final artifact inspection.
- Do not use `gh` in this repository. Use Git over SSH and the GitHub app.
- Restart the native frontend after changing the package version. Vite injects
  the displayed version when the development server starts, so hot reload
  alone continues to show the previous value.
- A local macOS build cannot validate Windows or Linux artifacts. Those are
  mandatory release-workflow gates.
- Do not treat sandbox socket or Chromium launch restrictions as passing tests;
  rerun the affected gates in GitHub Actions before publishing.

## Error protocol and learning

| Date | Error detected | Root cause | Required response |
| --- | --- | --- | --- |
| 2026-08-01 | Frontend and Electron both remained at `0.2.0` after extensive development | The existing release script updated only Electron and the documented shared bump script did not exist | Keep the two manifests and monorepo lockfile synchronized in the release script |
| 2026-08-01 | Local installer validation could not complete | Packaging creates a clean Python environment and requires network downloads | Use the release runner as the authoritative cross-platform packaging gate |
| 2026-08-01 | The Control Center still displayed `v0.2.0` after the manifests changed | Vite had injected the package version at its previous startup | Restart the native frontend and confirm the version visually |

## Verification checklist

- [ ] Frontend and Electron versions match the intended tag.
- [ ] Monorepo lockfile contains the frontend version.
- [ ] Frontend lint, unit tests, i18n validation, and build pass.
- [ ] Native browser smoke test passes without blocking dialogs.
- [ ] Backend tests pass in an isolated local-data directory.
- [ ] macOS, Linux, and Windows release jobs pass.
- [ ] Draft artifacts have the expected names and architectures.
