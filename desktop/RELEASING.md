# Resumable local releases

`desktop/release.sh session` coordinates the existing artifact collector,
Sparkle verifier and official marketplace builders. It does not rebuild a
verified architecture on retry. A session owns a new directory containing
`session.json`, disposable `scratch/` and retained `evidence/`. Keep it outside
the source checkout, on a local disk. Never upload the complete session:
installation evidence can contain private test or operational material.

## Before building

Prepare the frozen toolchain, then check capacity, GitHub authentication,
the three online CI runner configurations and the existing official catalog key:

```bash
./desktop/release.sh session doctor --signing
```

The default minimum is 24 GiB free; reserve additional space when VM disks can
grow. `--min-free-gib N` is an explicit capacity choice, not automatic cleanup
of somebody else's files. The command never starts VMs, installs Rosetta,
accepts licenses or retrieves secrets. Provision `GNOSI_PLUGIN_SIGNING_KEY`
securely in the process environment using the existing `gnosi-official` key;
the official policy verifies its public identity. Do not recover secrets from
historical repositories as part of routine releases. For macOS builds, prepare
the existing Sparkle Keychain account or `GNOSI_SPARKLE_PRIVATE_KEY` on the
signing host; the preflight does not certify that separate host's Keychain.
Every imported macOS feed is verified against the pinned key during assembly.

Use `release.sh prepare VERSION`, review and commit the version/notes changes,
and create the reviewed immutable tag as before. Keep a clean checkout at that
tag for the session. Initialization checks the existing tag/source/version
contract and records the commit, complete tree and both frozen-lock digests:

```bash
./desktop/release.sh session init 3.3.0 /local/releases/gnosi-3.3.0
```

The example version is illustrative. Initialization refuses an existing
directory; subsequent commands resume that directory. Commands lock the session
to prevent concurrent imports, publication and cleanup. Source, locks and
ownership are checked again whenever it is opened.

## Import, assemble and retain acceptance

Build each platform with the existing packaging procedures or download its
verified architecture artifact. Import the directory containing only that
group's uploadable files, including its update metadata:

```bash
./desktop/release.sh session import /local/releases/gnosi-3.3.0 macos-arm64 /builds/macos-arm64
./desktop/release.sh session import /local/releases/gnosi-3.3.0 macos-x64 /builds/macos-x64
./desktop/release.sh session import /local/releases/gnosi-3.3.0 linux-arm64 /builds/linux-arm64
./desktop/release.sh session import /local/releases/gnosi-3.3.0 windows-x64 /builds/windows-x64
./desktop/release.sh session assemble /local/releases/gnosi-3.3.0
```

Imports validate the existing artifact contract and copy isolated bytes, keeping
the original build directory intact. An identical repeated import reuses the
copy; changed artifacts require a new session. Assembly requires all four groups,
checks the official signer before expensive copies, collects matching versions,
verifies Sparkle feeds, signs both catalogs, renders the notes and verifies every
announced marketplace package. Its manifest seals every file by size and SHA-256.
Repeating successful assembly verifies the sealed output and returns immediately.

Run actual fresh installation and upgrade acceptance on all four platforms,
including creating, saving and reopening a synthetic note, and database integrity
checks after closing the application. Builds or CI cannot stand in for these
eight acceptance gates. Generate an identity-bound receipt template for each:

```bash
./desktop/release.sh session receipt-template /local/releases/gnosi-3.3.0 macos-arm64 fresh /local/acceptance/mac-fresh.json
# After actual acceptance: set status to "passed" and evidence to a nonempty
# array of paths relative to the receipt (logs, integrity results, screenshots).
./desktop/release.sh session accept /local/releases/gnosi-3.3.0 macos-arm64 fresh /local/acceptance/mac-fresh.json
```

Repeat for `upgrade` and the other groups. Evidence is copied into `evidence/`
before it is registered. The original receipt and identity fields are retained;
recording is operator attestation, not an automated GUI test. Never mark an
unperformed check passed. `session status DIRECTORY` shows the recorded state.

## Publish, promote and automatically clean

Supply the successful complete `ci.yml` run at the **exact tagged commit**:

```bash
./desktop/release.sh session publish /local/releases/gnosi-3.3.0 --ci-run 123456789
```

This explicit command publishes a stable release. It requires all eight current
acceptance receipts, unchanged artifacts, the remote tag identity and the five
successful CI jobs. It creates a verified-tag draft, uploads the sealed files,
checks GitHub's size/SHA-256 digests and only then publishes. A retry resumes
missing draft uploads; conflicting assets or notes stop without overwriting.
An already published identical release is verified without changing it.
There is no tag-push trigger, hosted-runner fallback or automatic secret access.

While the session's tagged checkout stays clean, prepare promotion in a separate
checkout at the same tag using the existing command and the session's groups:

```bash
./desktop/release.sh promote 3.3.0 /local/releases/gnosi-3.3.0/scratch/groups https://github.com/ismigar/Gnosi/releases/tag/v3.3.0
```

Review the metadata diff, open its PR, wait for all five required checks and
merge normally. Then run the single finishing command from the tagged checkout:

```bash
./desktop/release.sh session finalize /local/releases/gnosi-3.3.0 --promotion-pr 200
```

Finalization queries GitHub again. It requires the complete public asset set and
digests, unchanged tag, a merged promotion descended from the tested source with
only the catalog/changelog changed, the correct stable catalog entry and five
successful GitHub Actions checks at the PR head. Only then does it automatically
remove its entire owned `scratch/`. It retains manifests, all eight acceptance
receipts and proofs, publication/CI responses and the cleanup receipt. Repeating
finalization rechecks GitHub without deleting anything else.

Cleanup never traverses the imported build directories, VMs, profiles, shared
package stores or runner checkouts. Build outside the session remains the
operator's responsibility. Unexpected scratch content, symlinks, altered bytes,
missing evidence or unavailable verification stop cleanup. A partial copy,
assembly or interrupted cleanup remains for inspection; there is no blind
retry, force deletion or conversion of failure into success. After a crash,
inspect the process and `.session-lock` before removing a stale lock. Preserve
the session and evidence when diagnosing any stopped operation.
