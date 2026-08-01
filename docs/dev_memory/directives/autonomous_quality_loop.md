# Directive: Autonomous Quality Loop

## Objective

Run a native macOS quality loop twice a day. It inspects Gnosi through the
real frontend while selecting the `Proves` vault, collects failures from the
browser, tests, logs and GitHub issues, and prepares reviewable outcomes.

## Safety boundary

- `Principal` is never selected for a mutating request. The runner resolves a
  vault whose name is exactly `Proves`; absence of that vault is a hard stop.
- Browser exploration uses a dedicated authenticated Playwright state with
  `gnosi_active_vault` set to the resolved vault id. Tests that mutate data
  must send `X-Vault-Id` and clean their own fixtures.
- A finding becomes a candidate fix only when it has a reproducible failing
  test, request failure, browser exception, or GitHub issue with reproduction.
- The coding command receives a task file, works on an isolated branch and is
  forbidden from changing secrets, launch agents, production configuration,
  dependency lockfiles, migrations, or vault data.
- A candidate may be published only if its regression test, relevant backend
  tests, frontend build (when applicable), and required Playwright checks pass.
- Only `critical` bugs may create a draft PR automatically. Large, security,
  data-migration, dependency, or behaviour-changing work is recorded as a
  proposal, never implemented automatically.

## Configuration

Keep machine-only credentials and command configuration in
`local_data/secrets/auto_improver.env`, never in Git. It must provide:

- `GNOSI_AUTOMATION_AGENT_COMMAND`: an explicit command template containing
  `{task_file}`. The command must edit only its assigned isolated worktree.
- `GITHUB_TOKEN`: a token allowed to read issues and create draft PRs.

The runner is deliberately inert if either value is absent. This prevents a
background process from silently invoking an interactive coding account.

## Schedule and operations

Install the LaunchAgent via `pipeline/skills/auto_improver/scripts/install_launchagent.sh`.
It runs at 06:00 and 18:00 local time, writes state and reports under
`local_data/auto_improver/`, and writes logs under `~/Library/Logs/Gnosi/`.
Use `--dry-run` for a complete discovery pass without agent execution, Git
writes, pushes, PRs, or proposals.

## Restrictions and edge cases

- Do not use a cached `Proves` id: resolve it on every run because vault rows
  can be replaced.
- Do not run two instances concurrently; an exclusive state lock means the
  later invocation exits cleanly.
- Do not treat a test failure as a bug without recording its exact command and
  artifact path.
- Do not open duplicate PRs/proposals for a finding fingerprint already in the
  state ledger.
