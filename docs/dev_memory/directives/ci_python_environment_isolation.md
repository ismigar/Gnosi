# Entorn Python aïllat per job de CI

## Objectiu

Evitar que els runners self-hosted reutilitzin un `.venv` del checkout creat per
una altra execució, una altra instal·lació de Python o una biblioteca compartida
que ja no existeix.

## Pla

1. Després d'instal·lar Python i `uv`, preparar una ruta d'entorn exclusiva per
   la combinació d'execució, intent i job.
2. Situar aquesta ruta directament sota `RUNNER_TEMP`, mai dins del checkout.
3. Validar el directori temporal, els identificadors de GitHub i la ruta final
   abans de retirar cap entorn anterior amb el mateix nom.
4. Publicar `UV_PROJECT_ENVIRONMENT` mitjançant `GITHUB_ENV` abans de qualsevol
   `uv sync` o `uv run`.
5. Utilitzar una cache `uv` nova i exclusiva per job sota `RUNNER_TEMP`, amb
   còpia de fitxers a l'entorn; no compartir artefactes extrets ni desar o
   restaurar entorns virtuals complets.
6. Aplicar la preparació a tots els jobs Linux de validació que sincronitzen el
   projecte Python.

## Restriccions i casos límit

- Note: Do not let `uv sync` select the checkout `.venv`, because a self-hosted
  workspace can retain launchers linked to a removed `libpython`. Instead, set a
  fresh per-job `UV_PROJECT_ENVIRONMENT` under `RUNNER_TEMP` before syncing.
- No s'ha d'esborrar recursivament cap ruta proporcionada directament per una
  variable. Primer s'ha de construir i resoldre una ruta amb prefix controlat i
  demostrar que el seu pare és exactament el `RUNNER_TEMP` resolt.
- Els identificadors buits, absoluts, amb separadors o amb components `.`/`..`
  han de fallar sense modificar el sistema de fitxers.
- Un enllaç simbòlic existent al nom controlat s'ha de retirar com a enllaç;
  mai s'ha de seguir cap a la destinació.
- La cache segura és la cache pròpia d'`uv` configurada per `setup-uv`; un
  `.venv` no és una cache portable.
- Note: do not reuse an extracted package cache across self-hosted jobs. A
  partial `trafilatura` cache produced an environment where `baseline.py` was
  absent and mypy failed before checking project code. Export a validated
  job-scoped `UV_CACHE_DIR`, remove only that exact path before sync, and use
  `UV_LINK_MODE=copy` so the environment owns complete package files.
- Note: Do not reuse the machine-wide uv cache while validating from a sandboxed
  worktree, because protected Git metadata inside that cache can fail with
  `Operation not permitted`. Instead, assign a private temporary `UV_CACHE_DIR`
  for the local validation. CI may keep using the cache managed by `setup-uv`.
- Note: Do not interpret the macOS `system-configuration` NULL-object panic from
  sandboxed `uv sync` as an environment-isolation failure. Instead, repeat that
  exact frozen synchronization outside the filesystem sandbox while retaining
  the dedicated temporary environment and cache paths.
- Note: Do not resolve the venv Python symlink when proving interpreter
  ownership, because it legitimately resolves to uv's managed base runtime.
  Instead, verify the un-resolved `sys.executable` path and `sys.prefix` against
  the job environment; subprocesses must report that same scoped executable.
- Note: do not build CI virtual environments from `actions/setup-python` on a
  self-hosted Linux ARM64 runner. That interpreter requires its injected
  `LD_LIBRARY_PATH`, so hermetic subprocess tests fail to resolve
  `libpython3.11.so.1.0`. Keep setup-python only as the bootstrap interpreter
  and set `UV_MANAGED_PYTHON=1` globally so every uv environment uses the
  relocatable managed runtime.
- Note: Docker builds of the full backend can consume all runner storage while
  extracting large ARM64 wheels. On the dedicated Docker runner, check for at
  least 12 GiB before the build, prune only unused Docker resources when below
  that threshold, recheck, and release unused resources in an `always()` step.

## Validació

- Proves unitàries de ruta, reexecució, rebuig d'entrades insegures, enllaços
  simbòlics i escriptura exacta a `GITHUB_ENV`.
- Prova estructural dels workflows: cada `uv sync` ha de tenir la preparació
  aïllada després de `setup-python`/`setup-uv` i abans de la sincronització.
- Càrrega de tots els YAML de workflow.
- Ruff i mypy estricte sobre l'script i les proves; pytest enfocat verd.
