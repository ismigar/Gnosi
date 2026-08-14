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
3. Add the matching user-visible release entry and regenerate the changelog.
4. Verify that both package manifests and the monorepo lockfile agree.
5. Run lint, i18n and release-note validation, frontend unit tests, and the production build.
6. Validate the native backend and frontend through the browser.
7. Open and merge a focused pull request containing the version preparation.
8. Create the matching annotated tag on the merged `main` commit and push it
   through the SSH remote.
9. Wait for all release jobs and inspect the generated draft before publishing
   it manually.

## Desktop update delivery

The packaged Electron application checks the public `ismigar/Gnosi` GitHub
repository after its renderer is ready. Update checks are disabled in
development mode. A published release newer than the packaged application is
offered in the global application shell; downloads start only after the user
selects the download action. The interface reports download progress and
offers an explicit restart-and-install action when the package is ready.

The renderer must be able to recover the latest updater state through IPC as
well as subscribe to events. This prevents a fast update check from finishing
before React registers its listener. The main process owns update state and all
updater operations; the renderer receives only the narrow preload API.

Release artifacts must include both the platform installers and the metadata
consumed by `electron-updater`: `latest*.yml`, blockmaps when generated, and the
macOS ZIP update target. Draft releases are intentionally invisible to clients
until a maintainer publishes them.

## Restrictions and edge cases

- Do not create the release tag from a feature branch because the tag must
  identify reviewed code that exists on `main`.
- Add the matching release-note entry and run `npm run changelog:write` before
  running the preparation script. The script builds the frontend immediately
  after changing package versions, and its validator rejects either a missing
  version entry or a stale `CHANGELOG.md`.
- Do not update only Electron because the Control Center reads the frontend
  package version and would display a different release.
- Do not use `npm install` or `npm pkg set` to synchronize release metadata.
  Different npm versions can reorder manifests and refresh unrelated lockfile
  dependencies. Use the deterministic release-version synchronizer, which
  changes only the two manifest versions and the frontend workspace lock entry.
- Do not publish the draft automatically. The workflow deliberately leaves the
  public release in draft state for final artifact inspection.
- Do not point Electron publishing metadata at the private source repository.
  Update clients must query the public `ismigar/Gnosi` release repository.
- Do not upload only DMG, AppImage, DEB, or NSIS installers. Without the
  generated update manifests (and macOS ZIP target), `electron-updater` cannot
  discover or apply the release.
- Do not start downloading an update merely because it exists. Keep
  `autoDownload` disabled and require the user's download action.
- Do not use `gh` in this repository. Use Git over SSH and the GitHub app.
- Restart the native frontend after changing the package version. Vite injects
  the displayed version when the development server starts, so hot reload
  alone continues to show the previous value.
- A local macOS build cannot validate Windows or Linux artifacts. Those are
  mandatory release-workflow gates.
- Do not treat sandbox socket or Chromium launch restrictions as passing tests;
  rerun the affected gates in GitHub Actions before publishing.
- Do not omit explicit Electron desktop icons. Without generated ICNS, ICO, and
  PNG resources, electron-builder falls back to Electron branding. Generate all
  formats from the canonical Gnosi application artwork before packaging.
- Do not distribute an unsealed macOS application bundle. Disabling certificate
  discovery without a replacement signature causes Gatekeeper to report the app
  as damaged. Until Developer ID signing and notarization are configured, apply
  a complete ad-hoc signature and require `codesign --verify --deep --strict` on
  every generated DMG before uploading it.
- Do not sign a framework's `Versions/Current` symlink before its nested Mach-O
  helpers. Sign Mach-O files first, then nested app/XPC bundles and concrete
  framework version directories from deepest to shallowest, and the outer app
  last. Skip symlinks, `Versions/Current`, and root-level framework aliases;
  PyInstaller can materialize those aliases as real paths rather than symlinks.
- Do not reference the sibling frontend build as if it were inside the Electron
  project. electron-builder silently skips the missing path and produces an app
  that cannot load its renderer. Copy the sibling `frontend/dist` directory into
  application resources and load it through `process.resourcesPath`; assert that
  its `index.html` exists inside every inspected macOS package.
- Do not let PyInstaller reuse or silently skip an existing COLLECT directory.
  Clear its generated `build` and `dist` outputs, use non-interactive overwrite,
  and propagate any PyInstaller failure before copying `dist-python`.
- Do not build the clean Python bundle once in `release.sh` and again through
  `npm run build:<platform>`; the platform scripts already own that prerequisite.

## Error protocol and learning

| Date | Error detected | Root cause | Required response |
| --- | --- | --- | --- |
| 2026-08-01 | Frontend and Electron both remained at `0.2.0` after extensive development | The existing release script updated only Electron and the documented shared bump script did not exist | Keep the two manifests and monorepo lockfile synchronized in the release script |
| 2026-08-01 | Local installer validation could not complete | Packaging creates a clean Python environment and requires network downloads | Use the release runner as the authoritative cross-platform packaging gate |
| 2026-08-01 | The Control Center still displayed `v0.2.0` after the manifests changed | Vite had injected the package version at its previous startup | Restart the native frontend and confirm the version visually |
| 2026-08-03 | The RC used Electron branding and macOS reported the app as damaged | Desktop icons were absent and certificate discovery was disabled without sealing the bundle | Generate explicit cross-platform icons, ad-hoc sign the complete macOS bundle, and verify every DMG in CI |
| 2026-08-03 | The packaged app omitted the frontend bundle | The file pattern targeted `electron/frontend/dist`, but the build lives in the sibling `frontend/dist` directory | Package the sibling build as an extra resource, load it through `process.resourcesPath`, and assert the packaged index exists |
| 2026-08-14 | A repeated local release kept a stale Python bundle | PyInstaller prompted before overwriting COLLECT, while `build-python.sh` swallowed the abort and copied the old output | Remove generated PyInstaller outputs first, pass `--noconfirm`, propagate failure, and avoid the duplicate Python build |
| 2026-08-14 | The platform build resolved against the frontend workspace | Removing the duplicate Python phase also removed its incidental `cd` back to Electron | Change to the Electron directory explicitly immediately before `npm run build:<platform>` |
| 2026-08-14 | Ad-hoc signing failed on Electron Framework `Versions/Current` | The framework symlink was signed before its nested crashpad helper, so codesign rejected the unsigned child | Sign nested Mach-O files and bundles bottom-up, skip symlinks and framework roots, then verify the complete app with `--deep --strict` |
| 2026-08-14 | Preparing the release rewrote thousands of lockfile lines | The local npm version refreshed and reformatted the workspace dependency graph during a version-only operation | Synchronize the three release-version fields with the deterministic helper and leave dependency resolution untouched |
| 2026-08-14 | The committed monorepo lockfile could not be parsed as JSON | A previous dependency update lost the boundary between frontend dependencies and dev dependencies, duplicated one key, and left stale workspace constraints | Restore the object boundary, mirror the frontend manifest constraints exactly, and require JSON parsing in release preparation |
| 2026-08-14 | All frontend tests failed after a clean `npm ci` because Vitest could not import jsdom | npm hoisted Vitest to the monorepo root but kept the workspace-only jsdom package nested below the frontend | Declare the shared test runtime at the monorepo root and verify tests after a clean lockfile install |

## Verification checklist

- [ ] Frontend and Electron versions match the intended tag.
- [ ] Monorepo lockfile contains the frontend version.
- [ ] The release catalog contains the intended version in all four locales.
- [ ] The generated changelog and public release notes match the catalog.
- [ ] Frontend lint, unit tests, i18n validation, and build pass.
- [ ] Native browser smoke test passes without blocking dialogs.
- [ ] Backend tests pass in an isolated local-data directory.
- [ ] macOS, Linux, and Windows release jobs pass.
- [ ] Draft artifacts have the expected names and architectures.
- [ ] Installed desktop applications display the canonical Gnosi icon.
- [ ] Every macOS DMG contains a bundle that passes strict deep code-signature verification.
