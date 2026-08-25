# SKILL: Native Auto Improver

Runs the guarded autonomous quality loop described in
`docs/dev_memory/directives/autonomous_quality_loop.md`.

The runner operates on `Proves`, never `Principal`. Discovery executes the
real Playwright application scout and collects its failure artifacts. It does
not make code changes unless a configured external coding command returns a
validated task result. Critical bugs can be published as draft PRs; all other
findings remain proposals for maintainer review.

Run manually:

```sh
python3 pipeline/skills/auto_improver/scripts/auto_improver.py --dry-run
```

Install the twice-daily macOS schedule:

```sh
sh pipeline/skills/auto_improver/scripts/install_launchagent.sh
```
