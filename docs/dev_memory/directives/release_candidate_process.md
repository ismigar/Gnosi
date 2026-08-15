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
8. Create the matching annotated tag on the merged private `main` commit and
   push it through the SSH remote.
9. Let the private source workflow build every platform and create the draft in
   the public Gnosi repository. The synchronized public workflow is a manual
   packaging check and must not react to release tags.
10. Wait for all official release jobs and inspect the generated draft before
    publishing it manually.

## Desktop update delivery

The packaged Electron application checks the public `ismigar/Gnosi` GitHub
repository after its renderer is ready. Update checks are disabled in
development mode. A published release newer than the packaged application is
offered through a compact notice in the global application shell. The notice
must not open or embed the release history. Delivery starts only after the user
selects the download action. Windows and Linux report download progress and
offer an explicit restart-and-install action when the package is ready.

macOS releases use a direct architecture-specific DMG download while the app
is ad-hoc signed. Squirrel.Mac validates the new bundle against the installed
bundle's designated requirement; an ad-hoc requirement contains a per-build
code-directory hash, so a separately valid new build still fails replacement.
Automatic restart-and-install on macOS may be enabled only after every release
uses the same Apple Developer ID identity and passes notarization.

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
- Do not treat a release-only manifest version change as exempt from the
  engineering documentation gate. The frontend package version is classified
  as a high-impact desktop boundary, so refresh the reviewed desktop-client
  contract and its Catalan and Spanish mirrors in every release-preparation PR.
- Do not publish the draft automatically. The workflow deliberately leaves the
  public release in draft state for final artifact inspection.
- Do not point Electron publishing metadata at the private source repository.
  Update clients must query the public `ismigar/Gnosi` release repository.
- Do not upload only DMG, AppImage, DEB, or NSIS installers. Without the
  generated update manifests (and macOS ZIP target), `electron-updater` cannot
  discover or apply the release.
- Do not start downloading an update merely because it exists. Keep
  `autoDownload` disabled and require the user's download action.
- Do not offer automatic restart-and-install on macOS for ad-hoc signed
  releases. The per-build designated requirement causes Squirrel.Mac signature
  validation to reject the replacement. Open the official architecture-specific
  DMG directly until stable Developer ID signing and notarization are configured.
- Do not open the release history as part of the update prompt or automatically
  when the application starts after a version change. Keep the notice compact,
  retain the explicit Control Center entry point, and let the update download
  action perform only installer delivery.
- Do not swallow user-initiated updater failures in the renderer. Publish a
  visible error state so a failed download or installation action is not inert.
- Do not use `gh` in this repository. Use Git over SSH and the GitHub app.
- Do not enable a public tag trigger or a public release job in the synchronized
  `monorepo/.github/workflows/build-release.yml`. The private source workflow
  owns official tags, cross-platform artifacts, signed catalogs, release notes,
  and the public draft. A second tag-triggered public workflow races that owner,
  duplicates work, and can fail against an older synchronized snapshot.
- Keep the public manual packaging workflow buildable: use the exported
  workspace layout, provision Python through `actions/setup-python`, install the
  frontend from its workspace with `npm install`, and retain updater metadata
  alongside installers.
- Restart the native frontend after changing the package version. Vite injects
  the displayed version when the development server starts, so hot reload
  alone continues to show the previous value.
- A local macOS build cannot validate Windows or Linux artifacts. Those are
  mandatory release-workflow gates.
- Do not package macOS Intel and Apple Silicon installers from one runner. The
  frozen Python backend is native to the runner architecture, so a shared
  bundle can silently put an ARM64 backend inside the Intel application (or the
  inverse). Use separate matrix jobs, match the runner architecture to the
  requested Electron architecture, and upload architecture-specific artifacts.
- Do not use the moving `macos-latest` label for release installers. Its 2026
  migration to macOS 26 ARM64 made electron-builder fall back to APFS and the
  DMG customization phase failed with `hdiutil: no mountable file systems`.
  Pin Apple Silicon packaging to `macos-15` and Intel packaging to
  `macos-15-intel` while those images are supported.
- Do not build the frozen Python backend in a standalone workflow step before
  `npm run build:mac`; the platform script already owns the clean Python build.
  Duplicate builds add several minutes and can obscure which architecture was
  actually copied into the application.
- Do not let `build-python.sh` auto-select a runner-level Python after CI has
  provisioned a release interpreter. Runner images may expose a newer command
  first, and binary wheels can then bind against incompatible OpenSSL dylibs.
  Set `GNOSI_PYTHON_CMD=python` in every release job so the bundle uses the
  Python 3.11 supplied by `actions/setup-python`.
- Do not treat sandbox socket or Chromium launch restrictions as passing tests;
  rerun the affected gates in GitHub Actions before publishing.
- Do not omit explicit Electron desktop icons. Without generated ICNS, ICO, and
  PNG resources, electron-builder falls back to Electron branding. Generate all
  formats from the canonical Gnosi application artwork before packaging.
- Keep the desktop glyph scale aligned with the canonical application mark. Do
  not enlarge the glyph until it nearly touches the icon edges: the approved
  Gnosi mark is a centered white G with clear blue margin on every side.
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
- Do not assume that a local Electron module is packaged merely because source
  tests pass. Keep every main-process runtime module in the explicit builder
  file list and fail `afterPack` on every platform unless the final `app.asar`
  contains the complete runtime contract.
- Do not let PyInstaller reuse or silently skip an existing COLLECT directory.
  Clear its generated `build` and `dist` outputs, use non-interactive overwrite,
  and propagate any PyInstaller failure before copying `dist-python`.
- Do not build the clean Python bundle once in `release.sh` and again through
  `npm run build:<platform>`; the platform scripts already own that prerequisite.
- Do not maintain a partial, hand-written dependency list for the frozen
  backend or install LangChain with `--no-deps`. It omits transitive and API
  dependencies such as `langchain_core` and `email_validator`. Install the
  canonical E2E runtime requirements and smoke-test the frozen executable after
  every build.
- Do not exclude `unittest` or `PIL` from the frozen backend. Transitive runtime
  modules load `unittest`, and Gnosi's media features require Pillow even when
  the top-level imports are guarded.
- Do not let an installed native backend inherit Docker's `/app/data` fallback.
  Electron must provide a writable per-user `GNOSI_LOCAL_DATA` path, and the
  frozen-backend smoke test must run with an isolated writable data directory.
- Do not poll an authenticated application endpoint for desktop readiness. Use
  `/api/health`; a protected response otherwise delays the first window until
  the retry budget expires even when the backend is healthy.
- Do not enable Uvicorn filesystem reload inside a frozen backend. PyInstaller
  bundles are installed, read-only runtime artifacts; retain reload only for
  source-based native development.

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
| 2026-08-15 | Every public tag started a second stale release workflow and the RC3 public build failed on all platforms | The synchronized public workflow still owned a tag trigger and release job even though the private source workflow already publishes the official public draft; it also used missing frontend lockfiles and an unavailable Ubuntu Python package | Keep the public workflow manual-only, use the exported workspace install model and `actions/setup-python`, and leave official release publication to the private workflow |
| 2026-08-15 | The public Windows packaging check rejected a current changelog while macOS and Linux accepted it | The release-note validator compared the LF rendering byte-for-byte with a CRLF checkout on Windows | Normalize line endings only for changelog comparison and cover LF, CRLF, and legacy CR with unit tests |
| 2026-08-15 | The macOS updater downloaded `1.0.1`, but “Restart and install” did nothing | Both bundles were validly ad-hoc signed, but their designated requirements contained different per-build code-directory hashes, so Squirrel.Mac rejected the replacement | Use a compact direct-DMG flow on macOS and reserve automatic replacement for stable Developer ID signing and notarization |
| 2026-08-15 | The installed `1.0.3` application failed at startup with `Cannot find module './application-menu'` | The new main-process module was required by source code but omitted from electron-builder's explicit `files` list | Package every local runtime module and inspect the final `app.asar` from `afterPack` on every platform |
| 2026-08-15 | A packaged macOS application logged `spawn ENOTDIR` while starting its bundled backend | The packaged executable was already a file, but the main process appended a second `cervell_backend` path component | Resolve the platform-specific executable once, spawn that exact file, and unit-test every platform path |
| 2026-08-15 | The frozen backend exited successively with missing `langchain_core` and `email_validator` imports | The packaging script maintained a partial dependency list and installed LangChain with `--no-deps`, while PyInstaller did not reject missing runtime imports | Install the canonical E2E runtime requirements and run the frozen executable through the complete startup import window |
| 2026-08-15 | The installed native backend exited while creating `/app/data/secrets`, then the first window waited two minutes | The desktop process supplied no native local-data path and polled a protected statistics endpoint for readiness | Set `GNOSI_LOCAL_DATA` under Electron's per-user data directory, isolate the frozen smoke test, and poll `/api/health` |
| 2026-08-15 | The isolated frozen-backend smoke test failed in `pyparsing.testing` with `No module named 'unittest'` | The PyInstaller spec excluded a standard-library module used by an included Google API dependency | Keep `unittest` and the feature-required `PIL` package in the frozen runtime and lock the exclusion policy with a source test |
| 2026-08-15 | The frozen backend imported successfully but exited with `Operation not permitted` while starting Uvicorn | The installed PyInstaller process enabled `reload=True` and attempted to watch its read-only application bundle | Detect `sys.frozen`, disable Uvicorn reload only in packaged runtimes, and keep it enabled for native source development |
| 2026-08-15 | The v1.0.4 macOS release job failed with `hdiutil: no mountable file systems` | `macos-latest` had migrated to macOS 26 ARM64, electron-builder switched to APFS, and one host-native Python bundle was reused for both Electron architectures | Pin architecture-matched macOS 15 runners, build one architecture per matrix job, and let the platform script build Python exactly once |
| 2026-08-16 | The split v1.0.4 Intel job failed loading `cryptography` with missing `_SSL_get0_group_name` | CI installed Python 3.11, but the build script preferred a runner-level Python 3.13 whose cryptography wheel and collected `libssl.3.dylib` were incompatible | Allow an explicit Python command, set it to the setup-python interpreter on every platform, and fail early when the requested command is unavailable |

## Verification checklist

- [ ] Frontend and Electron versions match the intended tag.
- [ ] Monorepo lockfile contains the frontend version.
- [ ] The release catalog contains the intended version in all four locales.
- [ ] The generated changelog and public release notes match the catalog.
- [ ] Frontend lint, unit tests, i18n validation, and build pass.
- [ ] Every platform package contains the complete Electron runtime contract in `app.asar`.
- [ ] The frozen backend executable survives its startup smoke test on every platform.
- [ ] Native browser smoke test passes without blocking dialogs.
- [ ] Backend tests pass in an isolated local-data directory.
- [ ] The reviewed commit has synchronized to public `main`, and the public
      desktop build workflow remains manual-only.
- [ ] macOS, Linux, and Windows release jobs pass.
- [ ] Draft artifacts have the expected names and architectures.
- [ ] Installed desktop applications display the canonical Gnosi icon.
- [ ] Every macOS DMG contains a bundle that passes strict deep code-signature verification.
