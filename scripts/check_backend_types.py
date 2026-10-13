"""Check complete strict Python targets using a fresh, serially primed cache."""

from __future__ import annotations

import ast
import hashlib
import importlib.util
from io import StringIO
from typing import TYPE_CHECKING
import os
from pathlib import Path
import subprocess
import sys
import tempfile

if TYPE_CHECKING:
    from mypy.modulefinder import BuildSource
    from mypy.options import Options

ROOT = Path(__file__).resolve().parents[1]
ARGUMENTS = ["--native-parser", "--num-workers", "0", "--strict",
             "--exclude", "^backend/tests/", "backend"]
# This root brings the large typed ML dependency graph into the cache before
# the complete backend is loaded. It is an optimization, never the final target.
WORKER = "import runpy, sys; runpy.run_path(sys.argv[1])['check'](sys.argv[3:], sys.argv[2])"


def single_cpu() -> int:
    """Report the process's intended parser concurrency on Python 3.11."""
    return 1


def check(arguments: list[str], root: str | None = None) -> None:
    # Mypy 2.3's native parser sizes its pool from os.cpu_count(), not OMP or
    # RAYON settings. Python 3.11 has no PYTHON_CPU_COUNT override. Change only
    # this tooling process's report before importing mypy; do not alter the host.
    previous = os.cpu_count
    os.cpu_count = single_cpu
    try:
        from mypy.main import main as mypy_main, process_options
        from mypy.util import get_available_threads

        if get_available_threads() != 1:
            raise RuntimeError("Cannot enforce the single-thread backend parser budget")
        os.chdir(root or ROOT)
        output, errors = StringIO(), StringIO()
        try:
            _, options = process_options(arguments, stdout=output, stderr=errors)
        except SystemExit:
            sys.stdout.write(output.getvalue())
            sys.stderr.write(errors.getvalue())
            raise
        # The native parser's target-version syntax diagnostics differ from the
        # original parser. Preserve that behavior for non-host Python targets;
        # the locked production target matches this Python 3.11 interpreter.
        if options.python_version != sys.version_info[:2]:
            arguments = ["--no-native-parser" if arg == "--native-parser" else arg
                         for arg in arguments]
        mypy_main(args=arguments)
    finally:
        os.cpu_count = previous


def inspect_options(arguments: list[str]) -> tuple[list[BuildSource], Options, bool]:
    """Inspect canonical discovery without duplicating CLI diagnostics."""
    from mypy.main import process_options

    output, errors = StringIO(), StringIO()
    try:
        sources, options = process_options(arguments, stdout=output, stderr=errors)
    except SystemExit:
        sys.stdout.write(output.getvalue())
        sys.stderr.write(errors.getvalue())
        raise
    return sources, options, bool(output.getvalue() or errors.getvalue())


def source_snapshot(options: Options, root: Path) -> dict[str, str]:
    """Hash local and configured imports/plugins, including same-mtime edits."""
    paths: set[Path] = set()
    excluded = {".git", ".venv", ".tmp", "node_modules", "__pycache__",
                ".mypy_cache", ".pytest_cache"}
    for directory, children, filenames in os.walk(root):
        children[:] = [name for name in children if name not in excluded]
        paths.update(Path(directory) / name for name in filenames
                     if name.endswith((".py", ".pyi")))
    search_paths = [*options.mypy_path, *os.environ.get("MYPYPATH", "").split(os.pathsep)]
    for directory in search_paths:
        if directory:
            for suffix in ("*.py", "*.pyi"):
                paths.update(Path(directory).rglob(suffix))
    for name in ("pyproject.toml", "mypy.ini", ".mypy.ini", "setup.cfg", "uv.lock"):
        paths.add(root / name)
    if options.config_file:
        paths.add(Path(options.config_file))
    config_directory = Path(options.config_file).resolve().parent if options.config_file else root
    for plugin in options.plugins:
        filename = plugin.split(":", 1)[0]
        if filename.endswith(".py"):
            paths.add(config_directory / filename)
    return {str(path.resolve()): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(paths) if path.is_file()}


def prime_arguments(sources: list[BuildSource], options: Options,
                    diagnostics: bool, prefix: list[str], seed_module: str) -> list[str] | None:
    """Select a compatible optimization seed through complete discovery."""
    # These modes depend on which modules are roots. A subset could introduce
    # errors absent from the authoritative full target. Use the full CLI only.
    if diagnostics or any(options.clone_for_module(source.module or "").follow_imports
                          in {"skip", "error"} for source in sources):
        return None
    seed = next((source for source in sources
                 if source.module == seed_module), None)
    if seed is None or seed.path is None:
        return None
    from mypy.main import process_options

    arguments = [*prefix, seed.path]
    selected, _ = process_options(arguments, stdout=StringIO(), stderr=StringIO())
    if [(source.path, source.module, source.base_dir) for source in selected] != [
        (seed.path, seed.module, seed.base_dir)
    ]:
        raise RuntimeError("Backend cache seed changes mypy module identity")
    return arguments


def dependency_primes(prime: list[str] | None, options: Options,
                      directory: Path, prefix: list[str], root: Path) -> list[list[str]]:
    """Prepare large installed ML imports separately, without promoting them to roots."""
    if prime is None or options.config_file or options.mypy_path or os.environ.get("MYPYPATH"):
        return []
    try:
        tree = ast.parse((root / prime[-1]).read_bytes())
    except SyntaxError:
        return []  # The mandatory mypy target reports the actual syntax error.
    imports: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imports.add(node.module.split(".")[0])
    arguments: list[list[str]] = []
    for module in ("torch", "transformers"):
        if module not in imports or (root / module).exists() or (root / f"{module}.py").exists():
            continue
        if importlib.util.find_spec(module) is None:
            continue
        source = directory / f"gnosi_cache_{module}.py"
        source.write_text(f"import {module}\n")
        arguments.append([*prefix, str(source)])
    return arguments


def run_complete(prefix: list[str], target_paths: list[str], seed_module: str,
                 root: Path | None = None) -> None:
    # Start empty even when an inherited/shared mypy cache exists. Both child
    # processes use normal mypy cache validation; the final complete target is
    # mandatory and may recheck roots previously analysed as silent imports.
    root = (root or ROOT).resolve()
    os.chdir(root)
    arguments = [*prefix, *target_paths]
    sources, options, diagnostics = inspect_options(arguments)
    before = source_snapshot(options, root)
    prime = prime_arguments(sources, options, diagnostics, prefix, seed_module)
    with tempfile.TemporaryDirectory(prefix="gnosi-backend-types-") as temporary:
        directory = Path(temporary)
        environment = dict(os.environ, MYPY_CACHE_DIR=str(directory / "cache"))
        targets = dependency_primes(prime, options, directory, prefix, root)
        if prime is not None:
            targets.append(prime)
        targets.append(arguments)
        for arguments in targets:
            if source_snapshot(options, root) != before:
                raise RuntimeError("Backend sources/configuration changed during checking")
            result = subprocess.run(
                [sys.executable, "-c", WORKER, str(Path(__file__).resolve()), str(root), *arguments],
                cwd=root, env=environment, check=False,
            )
            if result.returncode:
                raise SystemExit(result.returncode if result.returncode > 0
                                 else 128 - result.returncode)
        if source_snapshot(options, root) != before:
            raise RuntimeError("Backend sources/configuration changed during checking")


def main() -> None:
    run_complete(ARGUMENTS[:-1], ARGUMENTS[-1:], "backend.services.handwriting")


if __name__ == "__main__":
    main()
