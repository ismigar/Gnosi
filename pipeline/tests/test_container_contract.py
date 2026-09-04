"""Static deployment invariants; real image/Compose acceptance is separate."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]


def mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    result: dict[str, object] = {}
    for key, item in value.items():
        assert isinstance(key, str)
        result[key] = item
    return result


def load(name: str) -> dict[str, object]:
    value: object = yaml.safe_load((ROOT / name).read_text(encoding="utf-8"))
    return mapping(value)


def services() -> dict[str, object]:
    return mapping(load("docker-compose.yml")["services"])


def test_default_bundle_has_no_host_bind_or_dependency_mounts() -> None:
    definitions = services()
    assert set(definitions) == {"backend", "frontend", "translation-server"}
    assert mapping(definitions["backend"])["volumes"] == [
        "gnosi_local_data:/data",
        "gnosi_vaults:/vaults",
    ]
    for raw in definitions.values():
        service = mapping(raw)
        assert not service.get("privileged")
        assert "container_name" not in service
        assert "network_mode" not in service
    assert not mapping(definitions["frontend"]).get("volumes")
    assert not mapping(definitions["translation-server"]).get("volumes")
    assert set(mapping(load("docker-compose.yml")["volumes"])) == {
        "gnosi_local_data",
        "gnosi_vaults",
    }


def test_backend_preserves_data_identity_and_requires_authenticated_deployment() -> None:
    backend = mapping(services()["backend"])
    env = mapping(backend["environment"])
    assert env["GNOSI_DATA_DIR"] == "/data"
    assert env["GNOSI_VAULTS_ROOT"] == "/vaults"
    assert env["DIGITAL_BRAIN_VAULT_PATH"] == "/vaults/default"
    assert env["GNOSI_REQUIRE_AUTH"] == "1"
    secret = env["GNOSI_JWT_SECRET"]
    assert isinstance(secret, str) and secret.startswith("${GNOSI_JWT_SECRET:?")
    assert not {"HOME_HOST_PATH", "REPO_ROOT", "TZ", "AI_MODEL_URL"} & set(env)
    assert "--reload" not in str(backend.get("command", ""))


def test_shared_input_precedes_local_input_and_is_not_mounted() -> None:
    backend = mapping(services()["backend"])
    files = backend["env_file"]
    assert isinstance(files, list) and len(files) == 2
    shared, local = (mapping(value) for value in files)
    assert shared == {"path": "${GNOSI_SHARED_ENV_FILE:-.env.shared.disabled}", "required": False}
    assert local == {"path": ".env", "required": False}
    assert mapping(backend["environment"])["GNOSI_SHARED_ENV_FILE"] == ""


@pytest.mark.parametrize("service,port", [("backend", "5002"), ("frontend", "5173")])
def test_ports_are_loopback_by_default_and_do_not_block_parallel_projects(
    service: str,
    port: str,
) -> None:
    config = mapping(services()[service])
    variable = f"GNOSI_{service.upper()}_PORT"
    assert config["ports"] == [f"${{GNOSI_BIND_ADDRESS:-127.0.0.1}}:${{{variable}:-{port}}}:{port}"]
    assert not mapping(services()["translation-server"]).get("ports")


def test_host_vault_override_keeps_data_volume_and_requires_existing_explicit_paths() -> None:
    override = mapping(mapping(load("compose.vaults.yml")["services"])["backend"])
    mounts = override["volumes"]
    assert isinstance(mounts, list) and len(mounts) == 2
    for raw, variable, target in zip(
        mounts,
        ("VAULT_HOST_PATH", "VAULTS_ROOT_HOST_PATH"),
        ("/vault", "/vaults"),
        strict=True,
    ):
        volume = mapping(raw)
        assert volume["type"] == "bind" and volume["target"] == target
        source = volume["source"]
        assert isinstance(source, str) and source.startswith(f"${{{variable}:?")
        assert mapping(volume["bind"])["create_host_path"] is False
    assert mapping(override["environment"])["DIGITAL_BRAIN_VAULT_PATH"] == "/vault"
    assert "GNOSI_DATA_DIR" not in mapping(override["environment"])
    assert all(mapping(raw)["target"] != "/data" for raw in mounts)


def test_images_use_frozen_root_locks_without_copying_arbitrary_checkout_state() -> None:
    backend = (ROOT / "Dockerfile.backend").read_text(encoding="utf-8")
    frontend = (ROOT / "Dockerfile.frontend").read_text(encoding="utf-8")
    assert "uv sync --frozen --no-cache --no-default-groups --no-install-workspace" in backend
    assert "uv export" not in backend
    assert "requirements.txt" not in backend
    assert 'PATH="/app/.venv/bin:$PATH"' in backend
    assert "pnpm install --frozen-lockfile" in frontend
    workspace = load("pnpm-workspace.yaml")
    assert workspace["fetchRetries"] == 5
    assert workspace["fetchRetryMintimeout"] == 20_000
    assert workspace["fetchRetryMaxtimeout"] == 120_000
    assert workspace["fetchTimeout"] == 300_000
    assert workspace["networkConcurrency"] == 8
    assert "node:22.22.2-alpine" in frontend
    assert "pnpm@11.19.0" in frontend
    assert '"--port", "5173", "--strictPort"' in frontend
    assert "COPY . ." not in backend and "COPY . ." not in frontend
    assert "COPY frontend/public/csl/ frontend/public/csl/" in backend
    assert "ENV GNOSI_DATA_DIR=/data" in backend


@pytest.mark.parametrize(
    "pattern",
    [
        "**/.env",
        "**/.env.*",
        "**/.env_shared",
        "**/.auth",
        "**/certs",
        "**/secrets",
        "**/*.sqlite",
        "**/*.sqlite-*",
        "**/*.sqlite3",
        "**/*.sqlite3-*",
        "**/*.db",
        "**/*.db-*",
        "**/.tmp",
        "**/node_modules",
        "**/.venv",
        "pipeline/sandbox",
        "pipeline/private_skills",
        ".antigravity",
        ".agents",
        ".codex",
    ],
)
def test_sensitive_and_generated_context_exclusions_cannot_disappear(pattern: str) -> None:
    exclusions = (ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines()
    assert pattern in exclusions


def test_default_configuration_contains_no_maintainer_layout_or_old_source_paths() -> None:
    for name in (
        "docker-compose.yml",
        "compose.vaults.yml",
        "Dockerfile.backend",
        "Dockerfile.frontend",
    ):
        source = (ROOT / name).read_text(encoding="utf-8")
        for forbidden in ("OneDrive-UNED", "$HOME", "/Users/", "monorepo/", "docker.sock"):
            assert forbidden not in source, (name, forbidden)


def test_ci_smoke_starts_built_images_without_env_files_or_external_services() -> None:
    smoke = load(".github/docker-compose.smoke.yml")
    definitions = mapping(smoke["services"])
    assert set(definitions) == {"backend", "frontend"}
    backend = mapping(definitions["backend"])
    frontend = mapping(definitions["frontend"])
    assert backend["image"] == "gnosi-backend:ci"
    assert frontend["image"] == "gnosi-frontend:ci"
    assert "build" not in backend and "build" not in frontend
    assert "env_file" not in backend and "env_file" not in frontend
    assert mapping(backend["environment"])["GNOSI_DATA_DIR"] == "/data"
    assert backend["volumes"] == [
        "gnosi_smoke_data:/data",
        "gnosi_smoke_vaults:/vaults",
    ]
    assert mapping(frontend["depends_on"])["backend"] == {
        "condition": "service_healthy",
    }


def test_ci_runs_docker_http_and_volume_persistence_smoke_after_both_builds() -> None:
    workflow = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    docker_job = workflow.split("\n  docker:\n", 1)[1]
    frontend_build = docker_job.index(
        "scripts/ci/build_container_image.py --dockerfile Dockerfile.frontend "
        "--tag gnosi-frontend:ci --context ."
    )
    backend_build = docker_job.index(
        "scripts/ci/build_container_image.py --dockerfile Dockerfile.backend "
        "--tag gnosi-backend:ci --context ."
    )
    smoke = docker_job.index("scripts/smoke_docker.sh")
    assert frontend_build < smoke and backend_build < smoke
    script = (ROOT / "scripts/smoke_docker.sh").read_text(encoding="utf-8")
    for required in (
        "compose up --detach --no-build backend frontend",
        "/api/health",
        "/vault",
        "/data/.gnosi-smoke-persistence",
        "compose down --remove-orphans",
        "compose down --volumes --remove-orphans",
    ):
        assert required in script
    assert script.count("compose up --detach --no-build backend frontend") == 2
