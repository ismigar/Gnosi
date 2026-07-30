# SKILL: Representative Proves Dataset

Build a deterministic, reduced copy of the registered `Principal` vault in the
registered `Proves` vault. The source is always read-only.

## Run

Resolve the registered paths first from
`local_data/system/management.sqlite`, then execute:

```sh
python3 pipeline/skills/proves_dataset/scripts/build_proves_dataset.py \
  "/path/to/Principal" \
  "/path/to/Proves"
```

An existing generated dataset can be refreshed idempotently with
`--allow-existing`. This option does not delete destination files.

## Dataset

The tool copies lightweight functional directories completely and selects
stable, format-diverse samples from `Mail`, `Assets`, `Images`, `Library`, and
`Biblioteca`. It rejects unrelated paths, does not follow symlinks, limits
large-file hydration, and records all results in
`.gnosi/test_dataset_manifest.json` inside `Proves`.

See `docs/dev_memory/directives/proves_representative_vault.md` for the exact
sampling policy, guards, and verification requirements.
