"""Owned local preview processes and administrator-bound SSH destinations."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
import shutil
import signal
import socket
import subprocess
import time
from pathlib import Path
from typing import cast
from collections.abc import Callable

import psutil
from fastapi import HTTPException
from pydantic import JsonValue

from .models import ConnectionStatus, LocalServeResponse, SiteConfig, SiteTarget, TargetConnection
from . import local_artifacts
from .private_service import SERVICE_ROOT, configuration
from .ssh_namespace import program as namespace_program, worker_start_program
from .storage import SiteStore, private_json


def connection(store: SiteStore, site_id: str, target_id: str) -> TargetConnection:
    from .private_service import service_root
    path = service_root(store, site_id, target_id) / "connection.json"
    return TargetConnection.model_validate_json(path.read_text()) if path.exists() else TargetConnection()


def save_connection(store: SiteStore, site_id: str, target_id: str, settings: TargetConnection) -> TargetConnection:
    from .private_service import service_root
    if settings.host and not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.:-]{0,249}", settings.host):
        raise HTTPException(422, "Invalid SSH hostname")
    if settings.username and not re.fullmatch(r"[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,99}", settings.username):
        raise HTTPException(422, "Invalid SSH account")
    # Remote profiles select an owned dedicated namespace, never a Drupal root.
    if settings.remote_root and (not settings.remote_root.startswith("/") or ".." in settings.remote_root.split("/") or not re.fullmatch(r"/[a-zA-Z0-9_./-]+", settings.remote_root) or "/_gnosi-" not in settings.remote_root):
        raise HTTPException(422, "Use an isolated /_gnosi- destination directory")
    for configured in (settings.document_root, settings.remote_private_root):
        if configured and (not configured.startswith("/") or ".." in configured.split("/") or not re.fullmatch(r"/[a-zA-Z0-9_./-]+", configured)):
            raise HTTPException(422, "Use absolute server directory paths")
    if settings.document_root and settings.remote_root and not Path(settings.remote_root).is_relative_to(Path(settings.document_root)):
        raise HTTPException(422, "The website destination must be inside the declared document root")
    if settings.remote_private_root and settings.document_root and Path(settings.remote_private_root).is_relative_to(Path(settings.document_root)):
        raise HTTPException(422, "The service directory must be outside the public document root")
    if settings.ssh_key_reference and not re.fullmatch(r"[a-zA-Z0-9_-]+", settings.ssh_key_reference):
        raise HTTPException(422, "Invalid SSH key reference")
    private_json(service_root(store, site_id, target_id) / "connection.json", settings.model_dump(mode="json"))
    return settings


def _ssh_argv(settings: TargetConnection) -> list[str]:
    if not settings.host or not settings.username or not settings.remote_root:
        raise HTTPException(409, "Configure the SSH destination first")
    ssh = shutil.which("ssh")
    if not ssh:
        raise HTTPException(503, "SSH is unavailable")
    if settings.ssh_key_reference:
        raise HTTPException(409, "Use an SSH-agent identity for this destination")
    return [ssh, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10", "-p", str(settings.port), settings.username + "@" + settings.host]


def _ssh(settings: TargetConnection, command: str, payload: bytes | None = None, timeout: int = 45) -> bytes:
    try:
        result = subprocess.run(_ssh_argv(settings) + [command], input=payload, capture_output=True, timeout=timeout, check=False)
        if result.returncode:
            raise ValueError("SSH command failed")
        return result.stdout
    except (OSError, ValueError, subprocess.TimeoutExpired):
        raise HTTPException(503, "The SSH operation could not complete; refresh status before retrying") from None


def probe(store: SiteStore, site: SiteConfig, target_id: str) -> ConnectionStatus:
    target = next((t for t in site.targets if t.id == target_id), None)
    if not target:
        raise HTTPException(404, "Destination not found")
    if target.adapter == "legacy-pangea":
        from backend.domains.vault.publishing.web import _driver
        response = _driver("status", store.context, {})
        return ConnectionStatus(configured=bool(response.get("configured")), reachable=True, detail="staging")
    if target.adapter == "local":
        return ConnectionStatus(configured=True, reachable=bool(shutil.which("php")), detail="php" if shutil.which("php") else "php_unavailable")
    settings = connection(store, site.id, target_id)
    try:
        output = _ssh(settings, "php -r " + shlex.quote('echo json_encode(["php"=>PHP_VERSION_ID,"sqlite"=>extension_loaded("pdo_sqlite")]);'))
        details: object = json.loads(output)
        ready = isinstance(details, dict) and isinstance(details.get("php"), int) and details["php"] >= 80000 and details.get("sqlite") is True
        return ConnectionStatus(configured=True, reachable=ready, detail="ready" if ready else "php_sqlite_unavailable")
    except (HTTPException, ValueError):
        return ConnectionStatus(configured=bool(settings.host), reachable=False, detail="connection_failed")


def render_bundle(bundle: dict[str, JsonValue], output: Path) -> None:
    from .renderer import render_bundle as renderer
    renderer(bundle, output)


def _owned_process(state: object, expected_output: Path) -> psutil.Process | None:
    """Use PID creation identity and exact argv, never port ownership as authority."""
    if not isinstance(state, dict) or not isinstance(state.get("pid"), int) or not isinstance(state.get("started_at"), (int, float)):
        return None
    argv = state.get("argv")
    if not isinstance(argv, list) or not argv or not all(isinstance(value, str) for value in argv):
        return None
    port = state.get("port")
    php = shutil.which("php")
    if not isinstance(port, int) or not 1024 <= port <= 65535 or not php or state.get("output") != str(expected_output):
        return None
    expected_argv = [php, "-S", "127.0.0.1:" + str(port), "-t", str(expected_output), str(SERVICE_ROOT.parent / "public/router.php")]
    if argv != expected_argv:
        return None
    try:
        process = psutil.Process(state["pid"])
        if abs(process.create_time() - float(state["started_at"])) > 0.01 or process.cmdline() != argv:
            return None
        if process.status() == psutil.STATUS_ZOMBIE:
            return None
        return process
    except (psutil.Error, OSError, ValueError):
        return None


def server_status(store: SiteStore, site: SiteConfig, target_id: str) -> LocalServeResponse:
    target = next((target for target in site.targets if target.id == target_id), None)
    if not target or target.adapter != "local" or target.environment != "local":
        raise HTTPException(409, "Select a local website destination")
    path = store.site_dir(site.id) / "servers" / target_id / "server.json"
    state: object = json.loads(path.read_text()) if path.is_file() else {}
    port = state.get("port") if isinstance(state, dict) else None
    if not isinstance(port, int) or not 1024 <= port <= 65535:
        port = connection(store, site.id, target_id).local_port
    output = store.site_dir(site.id) / "active" / target_id
    return LocalServeResponse(url="http://127.0.0.1:" + str(port), running=_owned_process(state, output) is not None)


def stop_server(store: SiteStore, site: SiteConfig, target_id: str) -> LocalServeResponse:
    status = server_status(store, site, target_id)
    path = store.site_dir(site.id) / "servers" / target_id / "server.json"
    if not path.is_file():
        return status
    state: object = json.loads(path.read_text())
    output = store.site_dir(site.id) / "active" / target_id
    process = _owned_process(state, output)
    if process is not None:
        try:
            process.terminate()
            process.wait(timeout=5)
        except psutil.TimeoutExpired:
            # Revalidate after waiting; a reused PID cannot inherit termination authority.
            still_owned = _owned_process(state, output)
            if still_owned is not None:
                still_owned.kill()
                still_owned.wait(timeout=5)
        except psutil.NoSuchProcess:
            pass
        except psutil.Error:
            raise HTTPException(503, "The owned local website process could not be stopped") from None
    path.unlink(missing_ok=True)
    return LocalServeResponse(url=status.url, running=False)


def _server_environment(config: Path, output: Path, releases_root: Path | None) -> dict[str, str]:
    env = {key: value for key, value in os.environ.items() if key in {"PATH", "HOME", "TMPDIR", "LANG"}}
    env["GNOSI_SITES_SERVICE_CONFIG"] = str(config)
    # PHP canonicalizes -t at process startup. The router must resolve the owned
    # active pointer again for each request so atomic publication/restore is live.
    env["GNOSI_SITES_PUBLIC_ROOT"] = str(output)
    if releases_root is not None:
        env["GNOSI_SITES_RELEASE_ROOT"] = str(releases_root)
    return env


def start_server(store: SiteStore, site: SiteConfig, target_id: str, output: Path, *, preview_id: str | None = None) -> str:
    php = shutil.which("php")
    router = SERVICE_ROOT.parent / "public" / "router.php"
    if not php or not router.is_file():
        raise HTTPException(503, "The local website PHP runtime is unavailable")
    root = store.site_dir(site.id) / ("previews/" + preview_id if preview_id else "servers/" + target_id)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    pid_file = root / "server.json"
    if pid_file.exists():
        state: object = json.loads(pid_file.read_text())
        if isinstance(state, dict) and state.get("output") == str(output) and isinstance(state.get("port"), int) and _owned_process(state, output) is not None:
            port = int(state["port"])
            if not preview_id and port != connection(store, site.id, target_id).local_port:
                stop_server(store, site, target_id)
            else:
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                        return "http://127.0.0.1:" + str(port)
                except OSError:
                    raise HTTPException(503, "The owned local website server is not responding") from None
    port = 0 if preview_id else connection(store, site.id, target_id).local_port
    with socket.socket() as listener:
        try:
            listener.bind(("127.0.0.1", port))
        except OSError:
            raise HTTPException(409, "The configured local website port is already in use") from None
        port = listener.getsockname()[1]
    base_url = "http://127.0.0.1:" + str(port)
    active_bundle = store.active_bundle(site.id, target_id) if not preview_id else None
    forms_site = SiteConfig.model_validate(active_bundle["site"]) if active_bundle else site
    config = configuration(store, site, target_id, forms_site=forms_site)
    config_data = json.loads(config.read_text())
    config_data["public_base_url"] = base_url
    if preview_id:
        config_data["db_path"] = str(root / "state.sqlite")
        config_data["spool_path"] = str(root / "captures")
    if preview_id:
        config = root / "service.json"
    private_json(config, config_data)
    output.mkdir(parents=True, exist_ok=True)
    env = _server_environment(config, output, None if preview_id else store.site_dir(site.id) / "releases")
    argv = [php, "-S", "127.0.0.1:" + str(port), "-t", str(output), str(router)]
    with (root / "server.log").open("ab") as log:
        process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=log, env=env, start_new_session=True)
    try:
        started_at = psutil.Process(process.pid).create_time()
    except psutil.Error:
        raise HTTPException(503, "The local website server exited before startup") from None
    private_json(pid_file, {"pid": process.pid, "port": port, "output": str(output), "argv": argv, "started_at": started_at})
    if not preview_id:
        daemon = SERVICE_ROOT / "daemon.php"
        if daemon.is_file():
            with (config.parent / "worker.log").open("ab") as worker_log:
                subprocess.Popen([php, str(daemon)], stdin=subprocess.DEVNULL, stdout=worker_log, stderr=worker_log, env=env, start_new_session=True)
    for _ in range(30):
        if process.poll() is not None:
            raise HTTPException(503, "The local website server could not start")
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                return base_url
        except OSError:
            time.sleep(0.05)
    process.terminate()
    raise HTTPException(503, "The local website server did not become available")


def upload_release(store: SiteStore, site: SiteConfig, target: SiteTarget, release_id: str, output: Path, parent_id: str | None, activation_guard: Callable[[], None] | None = None) -> str:
    if target.adapter == "legacy-pangea":
        from .pangea import upload_release as upload_pangea
        return upload_pangea(store, site, target, release_id, output, parent_id, activation_guard=activation_guard)
    settings = connection(store, site.id, target.id)
    root = settings.remote_root
    if not settings.document_root:
        raise HTTPException(409, "Configure the server document root before deploying")
    private_root = remote_private_root(store, site.id, settings)
    ownership = json.dumps({"site_id": site.id, "scope": store.private_root.name}, sort_keys=True)
    namespace = namespace_program(root, private_root, ownership, settings.document_root)
    identity = '$id=' + json.dumps(release_id) + ';gnosi_id($id);'
    setup = namespace + identity + 'gnosi_namespace(true);gnosi_current();$destination=$r."/releases/".$id;if(gnosi_exists($destination)){throw new Exception("Immutable release exists");}gnosi_directory($destination,true);gnosi_write($p,".htaccess","Require all denied\\n");'
    _ssh(settings, "php -r " + shlex.quote(setup))
    def write_file(relative: str, data: bytes, *, private: bool = False) -> None:
        base = "$p" if private else "gnosi_release($id)"
        code = namespace + identity + 'gnosi_namespace();gnosi_write(' + base + ',' + json.dumps(relative) + ',file_get_contents("php://stdin"),' + ("0600" if private else "0644") + ');'
        _ssh(settings, "php -r " + shlex.quote(code), data)
    manifest: dict[str, str] = {}
    for path in sorted(output.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        relative = str(path.relative_to(output))
        data = path.read_bytes()
        manifest[relative] = hashlib.sha256(data).hexdigest()
        write_file(relative, data)
    # Ship the private service independently of static releases and never overwrite its database.
    for path in SERVICE_ROOT.glob("*.php"):
        write_file(path.name, path.read_bytes(), private=True)
    local_config = json.loads(configuration(store, site, target.id).read_text())
    local_config.update({"db_path": private_root + "/state.sqlite", "spool_path": private_root + "/captures", "library_path": private_root + "/library.php"})
    config_code = namespace + 'gnosi_namespace();gnosi_install_config(file_get_contents("php://stdin"));'
    _ssh(settings, "php -r " + shlex.quote(config_code), json.dumps(local_config).encode())
    htaccess = output / ".htaccess"
    rules = htaccess.read_text() if htaccess.is_file() else "Options -Indexes +FollowSymLinks\nRewriteEngine On\nRewriteCond %{REQUEST_FILENAME} !-f\nRewriteCond %{REQUEST_FILENAME}.html -f\nRewriteRule ^(.+?)/?$ $1.html [L]\n"
    rules += "\nHeader always set X-Robots-Tag \"noindex, nofollow\"\nSetEnv GNOSI_SITES_SERVICE_CONFIG " + private_root + "/config.json\n"
    write_file(".htaccess", rules.encode())
    manifest[".htaccess"] = hashlib.sha256(rules.encode()).hexdigest()
    verify = namespace + identity + 'gnosi_namespace();gnosi_verify($id,json_decode(file_get_contents("php://stdin"),true,64,JSON_THROW_ON_ERROR));'
    _ssh(settings, "php -r " + shlex.quote(verify), json.dumps(manifest).encode())
    write_file("manifests/" + release_id + ".json", json.dumps(manifest).encode(), private=True)
    activate = activation_program(root, private_root, release_id, parent_id, verify_manifest=True, ownership=ownership, document_root=settings.document_root)
    if activation_guard is not None:
        activation_guard()
    _ssh(settings, "php -r " + shlex.quote(activate))
    if (SERVICE_ROOT / "daemon.php").is_file():
        try:
            start_remote_worker(store, site, target)
        except HTTPException:
            from .private_service import service_root
            private_json(service_root(store, site.id, target.id) / "worker-start.json", {"error": "worker_start_pending"})
    return target.base_url


def start_remote_worker(store: SiteStore, site: SiteConfig, target: SiteTarget) -> None:
    """Open a verified log handle and detach the fixed worker without shell redirection."""
    settings = connection(store, site.id, target.id)
    private_root = remote_private_root(store, site.id, settings)
    ownership = json.dumps({"site_id": site.id, "scope": store.private_root.name}, sort_keys=True)
    code = namespace_program(settings.remote_root, private_root, ownership, settings.document_root) + 'gnosi_namespace();' + worker_start_program()
    try:
        response = json.loads(_ssh(settings, "php -r " + shlex.quote(code)))
        if not isinstance(response, dict) or response.get("started") is not True:
            raise ValueError("Worker launch was not acknowledged")
    except ValueError:
        raise HTTPException(503, "The private service worker could not start") from None
    from .private_service import service_root
    private_json(service_root(store, site.id, target.id) / "worker-start.json", {"error": None})


def activation_program(root: str, private_root: str, release_id: str, parent_id: str | None, *, verify_manifest: bool = False, ownership: str | None = None, document_root: str = "") -> str:
    code = namespace_program(root, private_root, ownership, document_root) + '$id=' + json.dumps(release_id) + ';gnosi_namespace();gnosi_release($id);$l=gnosi_lock();$current=gnosi_current();if($current!==' + json.dumps(parent_id) + '){throw new Exception("Parent changed");}'
    if verify_manifest:
        code += 'gnosi_manifest($id);'
    code += '$expected="releases/".$id;$n=$r."/.current-pending-".$id;if(gnosi_exists($n)){if(!is_link($n)||readlink($n)!==$expected){throw new Exception("An unrelated activation pointer is pending");}}elseif(!symlink($expected,$n)){throw new Exception("Could not create the pending activation pointer");}if(!is_link($n)||readlink($n)!==$expected||realpath($n)!==gnosi_release($id)){throw new Exception("Could not verify the pending activation pointer");}gnosi_namespace();if(gnosi_current()!==$current){throw new Exception("Parent changed during activation");}'
    if verify_manifest:
        code += 'gnosi_manifest($id);'
    code += 'if(!rename($n,$r."/current")){throw new Exception("Could not replace the activation pointer");}clearstatcache(true,$r."/current");if(gnosi_current()!==$id){throw new Exception("The activated pointer could not be verified");}echo json_encode(["release_id"=>$id]);'
    return code


def restore_remote_release(store: SiteStore, site: SiteConfig, target: SiteTarget, release_id: str, parent_id: str | None, activation_guard: Callable[[], None] | None = None) -> None:
    if target.adapter == "legacy-pangea":
        from .pangea import revert
        revert(store, site, target, release_id, parent_id, activation_guard=activation_guard)
        return
    settings = connection(store, site.id, target.id)
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", release_id):
        raise HTTPException(422, "Invalid retained release identity")
    private_root = remote_private_root(store, site.id, settings)
    ownership = json.dumps({"site_id": site.id, "scope": store.private_root.name}, sort_keys=True)
    code = activation_program(settings.remote_root, private_root, release_id, parent_id, verify_manifest=True, ownership=ownership, document_root=settings.document_root)
    if activation_guard is not None:
        activation_guard()
    _ssh(settings, "php -r " + shlex.quote(code))


def remote_private_root(store: SiteStore, site_id: str, settings: TargetConnection) -> str:
    path = Path(settings.remote_private_root) if settings.remote_private_root else Path(settings.remote_root).parent.parent / ".gnosi-sites-private" / store.private_root.name / site_id
    if settings.document_root and path.is_relative_to(Path(settings.document_root)):
        raise HTTPException(409, "The service directory must be outside the public document root")
    return str(path)


def sync_service_settings(store: SiteStore, site: SiteConfig, target: SiteTarget, forms_site: SiteConfig) -> None:
    if target.environment == "production":
        raise HTTPException(409, "Production service changes require pilot validation")
    if target.adapter == "legacy-pangea":
        from .pangea import sync_settings
        sync_settings(store, site, target, forms_site)
        return
    settings = connection(store, site.id, target.id)
    root = remote_private_root(store, site.id, settings)
    data = json.loads(configuration(store, site, target.id, forms_site=forms_site).read_text())
    data.update({"db_path": root + "/state.sqlite", "spool_path": root + "/captures", "library_path": root + "/library.php"})
    ownership = json.dumps({"site_id": site.id, "scope": store.private_root.name}, sort_keys=True)
    code = namespace_program(settings.remote_root, root, ownership, settings.document_root) + 'gnosi_namespace();gnosi_install_config(file_get_contents("php://stdin"));'
    _ssh(settings, "php -r " + shlex.quote(code), json.dumps(data).encode())


def active_release(store: SiteStore, site: SiteConfig, target: SiteTarget) -> str | None:
    """Verify the retained active artifact before reconciling an uncertain activation."""
    if target.adapter == "legacy-pangea":
        from .pangea import current_release
        return current_release(store, site, target)
    if target.adapter == "ssh":
        settings = connection(store, site.id, target.id)
        private_root = remote_private_root(store, site.id, settings)
        ownership = json.dumps({"site_id": site.id, "scope": store.private_root.name}, sort_keys=True)
        code = namespace_program(settings.remote_root, private_root, ownership, settings.document_root) + 'gnosi_namespace();$l=gnosi_lock();$id=gnosi_current();if($id!==null){gnosi_manifest($id);}echo json_encode($id);'
        result: object = json.loads(_ssh(settings, "php -r " + shlex.quote(code)))
        return str(result) if isinstance(result, str) else None
    return local_artifacts.current(store, site.id, target.id)


def remote_service(store: SiteStore, site: SiteConfig, target_id: str, action: str, request: dict[str, JsonValue]) -> dict[str, JsonValue]:
    target = next(t for t in site.targets if t.id == target_id)
    if target.environment == "production":
        raise HTTPException(409, "This destination service requires separate validation")
    if target.adapter == "legacy-pangea":
        from .pangea import service
        return service(store, site, target_id, action, request)
    settings = connection(store, site.id, target_id)
    root = remote_private_root(store, site.id, settings)
    payload = json.dumps({"action": action, "request": request}).encode()
    if len(payload) > 1_000_000:
        raise HTTPException(413, "The website service request is too large")
    ownership = json.dumps({"site_id": site.id, "scope": store.private_root.name}, sort_keys=True)
    code = namespace_program(settings.remote_root, root, ownership, settings.document_root) + 'gnosi_namespace();$config=gnosi_service_config();$cli=gnosi_service_script("cli.php");if(!putenv("GNOSI_SITES_SERVICE_CONFIG=".$config)){throw new Exception("Service configuration unavailable");}require $cli;'
    response = _ssh(settings, "php -r " + shlex.quote(code), payload)
    try:
        if len(response) > 4_000_000:
            raise ValueError("Service response too large")
        data: object = json.loads(response)
        if not isinstance(data, dict) or data.get("error") or data.get("test_mode", True) is not True:
            raise ValueError("Invalid service response")
        return cast(dict[str, JsonValue], data)
    except ValueError:
        raise HTTPException(503, "The private remote service is unavailable") from None
