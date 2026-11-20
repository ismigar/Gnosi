"""Native website releases through the existing administrator-bound Suweb bridge."""
from __future__ import annotations

import contextlib
import hashlib
import json
import logging
import re
import shlex
import tarfile
import tempfile
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import ContextManager, Protocol, cast

from fastapi import HTTPException
from pydantic import JsonValue

from .models import SiteConfig, SiteTarget
from .private_service import SERVICE_ROOT, configuration
from .storage import SiteStore, private_json
from .ssh_namespace import program as namespace_program, worker_start_program
from .release_retention import begin_upload_program, retention_program, record_result
from .incremental_upload import output_manifest, reuse_program


_BOUNDED_CONNECTION_LOCK = threading.Lock()
_READ_ACTIONS = frozenset({"status", "messages_list", "messages_export", "subscribers_list", "subscribers_export", "campaigns_list", "queue_list", "captured_get"})
log = logging.getLogger(__name__)


class Bridge(Protocol):
    def run(self, command: str) -> str: ...


class Driver(Protocol):
    REMOTE_ROOT: str
    CONFIG: Path
    def bridge(self) -> ContextManager[Bridge]: ...
    def php(self, bridge: Bridge, code: str) -> str: ...
    def put(self, bridge: Bridge, source: Path, destination: str) -> None: ...


def driver(store: SiteStore) -> Driver:
    from .pangea_driver import load_driver
    return load_driver(store)


def paths(transport: Driver, site: SiteConfig, target: SiteTarget | None = None, *, bridge: Bridge | None = None) -> tuple[str, str]:
    from .pangea_driver import PangeaDriver
    if isinstance(transport, PangeaDriver) and not transport.REMOTE_ROOT:
        if bridge is None:
            raise HTTPException(409, "Connect to resolve the registered Pangea web root")
        transport.resolve_legacy_root(bridge)
    if target is not None and target.environment == "production":
        return (transport.REMOTE_ROOT + "/web/_gnosi-live/webs/" + site.id,
                transport.REMOTE_ROOT + "/.gnosi-sites-production/" + site.id)
    return (transport.REMOTE_ROOT + "/web/_gnosi-proves/webs/" + site.id,
            transport.REMOTE_ROOT + "/.gnosi-sites/" + site.id)


def validate_target(site: SiteConfig, target: SiteTarget) -> None:
    if target.environment == "production":
        if target.id != "pangea-production" or target.base_url.rstrip("/") != "https://temenosismael.org":
            raise HTTPException(409, "Invalid registered Pangea production destination")
        return
    expected = "https://temenosismael.org/_gnosi-proves/webs/" + site.id + "/current"
    if target.environment != "staging" or target.base_url != expected:
        raise HTTPException(409, "The Pangea destination must use its isolated protected test URL")


def _owner(store: SiteStore, site: SiteConfig, target: SiteTarget) -> str:
    value = store.private_root.name + ":" + site.id
    return value + ":production" if target.environment == "production" else value


def _registration(store: SiteStore, site: SiteConfig, target: SiteTarget) -> None:
    if target.environment != "production":
        return
    path = store.site_dir(site.id) / "services" / target.id / "production-registration.json"
    expected = {"site_id": site.id, "scope": store.private_root.name, "target_id": target.id, "base_url": target.base_url}
    if path.is_symlink() or not path.is_file() or json.loads(path.read_text()) != expected:
        raise HTTPException(409, "Register the production migration separately from the staging bridge")


def _start_worker(transport: Driver, bridge: Bridge, public: str, private: str, owner: str) -> None:
    code = _policy(public, private, owner) + '$p=$private."/service";' + worker_start_program()
    response: object = json.loads(transport.php(bridge, code))
    if not isinstance(response, dict) or response.get("started") is not True:
        raise HTTPException(503, "The private website worker could not start")


def _policy(public: str, private: str, owner: str) -> str:
    return namespace_program(private, private, None, production=owner.endswith(":production")) + '$public=' + json.dumps(public) + ';$private=' + json.dumps(private) + ';$expectedOwner=' + json.dumps(owner) + ';' + r'''
function gnosi_pangea_namespace(){
 global $public,$private,$expectedOwner;
 foreach([$public,$private] as $directory){
  if(gnosi_directory($directory)!==$directory){throw new Exception("Noncanonical test namespace");}
  $marker=gnosi_file($directory,".gnosi-owner");
  if(!is_file($marker)||file_get_contents($marker)!==$expectedOwner){throw new Exception("Test namespace ownership mismatch");}
 }
 foreach(["releases","service"] as $name){if(gnosi_directory($private."/".$name)!==$private."/".$name){throw new Exception("Test service escaped namespace");}}
}
function gnosi_pangea_verify($id){
 global $private;
 $release=gnosi_release($id);$target=$release."/public";
 if(gnosi_directory($target)!==$target){throw new Exception("Unowned retained test version");}
 $manifestFile=gnosi_file($release,"checksums.json");
 $manifest=json_decode(file_get_contents($manifestFile),true,512,JSON_THROW_ON_ERROR);
 if(!is_array($manifest)||!$manifest){throw new Exception("Missing test manifest");}
 foreach($manifest as $path=>$hash){
  if(!is_string($hash)||!preg_match("~^[a-f0-9]{64}$~D",$hash)){throw new Exception("Invalid test digest");}
  $file=gnosi_file($target,$path);
  if(!is_file($file)||hash_file("sha256",$file)!==$hash){throw new Exception("Test version integrity failure");}
 }
 $tree=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($target,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::SELF_FIRST);
 foreach($tree as $entry){$path=substr($entry->getPathname(),strlen($target)+1);if($entry->isLink()||!$entry->isDir()&&!array_key_exists($path,$manifest)){throw new Exception("Unreviewed test file");}}
 return $target;
}
function gnosi_pangea_current($verify=true){
 global $public,$private;
 $link=$public."/current";
 if(!gnosi_exists($link)){return null;}
 if(!is_link($link)){throw new Exception("Unowned active test pointer");}
 $target=readlink($link);$prefix=$private."/releases/";
 if(!str_starts_with($target,$prefix)||!preg_match("~^([a-f0-9]{32})/public$~D",substr($target,strlen($prefix)),$match)){throw new Exception("Unknown active test version");}
 $canonical=gnosi_directory(gnosi_release($match[1])."/public");
 if($canonical!==$target||realpath($link)!==$canonical){throw new Exception("Foreign active test version");}
 if($verify){gnosi_pangea_verify($match[1]);}
 return $match[1];
}
gnosi_pangea_namespace();
'''


@contextlib.contextmanager
def connection(store: SiteStore, *, bounded: bool = False) -> Iterator[tuple[Driver, Bridge]]:
    transport = driver(store)
    session = transport.bridge()
    settings = getattr(session, "settings", None)
    if bounded and isinstance(settings, dict):
        from .bounded_bridge import BoundedBridge
        from .transport_settings import website_transport_settings
        bounded_bridge = BoundedBridge(website_transport_settings(cast(dict[str, str], settings)))
        # A panel can request several private lists at once. Keep their SSH
        # sessions serial through closure, charging queueing to the same deadline.
        if not _BOUNDED_CONNECTION_LOCK.acquire(timeout=bounded_bridge.remaining()):
            raise HTTPException(503, "The Pangea connection is busy; refresh to retry")
        try:
            with bounded_bridge:
                try:
                    bounded_bridge.remaining()
                except TimeoutError:
                    raise HTTPException(503, "The Pangea connection wait exceeded its deadline") from None
                yield transport, bounded_bridge
        finally:
            _BOUNDED_CONNECTION_LOCK.release()
        return
    with session as bridge:
        yield transport, bridge


def _activate(transport: Driver, bridge: Bridge, public: str, private: str, release_id: str, parent_id: str | None, owner: str, *, retain: bool = False) -> str:
    if not re.fullmatch(r"[a-f0-9]{32}", release_id):
        raise HTTPException(409, "Invalid Pangea release identity")
    code = _policy(public, private, owner) + '$lock=gnosi_lock();$id=' + json.dumps(release_id) + ';$link=$public."/current";$current=gnosi_pangea_current();if($current===$id){echo json_encode(["release_id"=>$id,"retention_error"=>null]);exit;}if($current!==' + json.dumps(parent_id) + '){throw new Exception("Parent changed");}$target=gnosi_pangea_verify($id);$tmp=$link.".".bin2hex(random_bytes(6));if(!symlink($target,$tmp)||!rename($tmp,$link)||readlink($link)!==$target){throw new Exception("Test activation failed");}clearstatcache(true,$link);if(gnosi_pangea_current(false)!==$id){throw new Exception("Active version could not be verified");}'
    if retain:
        # Both exact trees were verified above under this same held lock.
        # Switching the pointer does not change either tree's bytes.
        code += retention_program(pangea=True, verified_activation=True)
    code += 'echo json_encode(["release_id"=>$id,"retention_error"=>' + ('$retentionError' if retain else 'null') + ']);'
    return transport.php(bridge, code)


def upload_release(store: SiteStore, site: SiteConfig, target: SiteTarget, release_id: str, output: Path, parent_id: str | None, activation_guard: Callable[[], None] | None = None) -> str:
    validate_target(site, target)
    _registration(store, site, target)
    with connection(store) as (transport, bridge):
        public, private = paths(transport, site, target, bridge=bridge)
        marker = transport.REMOTE_ROOT + "/web/_gnosi-proves/.gnosi-staging-marker"
        owner = _owner(store, site, target)
        setup = namespace_program(private, private, None) + '$marker=' + json.dumps(marker) + ';if(!is_file($marker)||is_link($marker)){throw new Exception("Protected staging missing");}$owner=' + json.dumps(owner) + ';$directories=[' + json.dumps(public) + ',' + json.dumps(private) + '];foreach($directories as $directory){$parent=$directory;while(!gnosi_exists($parent)){$parent=dirname($parent);}if(gnosi_directory($parent)!==$parent){throw new Exception("Noncanonical namespace parent");}if(gnosi_exists($directory)){if(gnosi_directory($directory)!==$directory){throw new Exception("Noncanonical namespace");}$marker=gnosi_file($directory,".gnosi-owner");if(!is_file($marker)||file_get_contents($marker)!==$owner){throw new Exception("Unowned namespace");}}}foreach($directories as $directory){if(gnosi_directory($directory,true,0711)!==$directory){throw new Exception("Invalid new namespace");}gnosi_write($directory,".gnosi-owner",$owner);}$private=' + json.dumps(private) + ';foreach(["service","releases"] as $name){$path=$private."/".$name;if(gnosi_directory($path,true,$name==="service"?0700:0711)!==$path){throw new Exception("Invalid private directory");}}'
        transport.php(bridge, setup)
        transport.php(bridge, _policy(public, private, owner))
        service_root = private + "/service"
        release_root = private + "/releases/" + release_id
        checks = output_manifest(output)
        htaccess = (output / ".htaccess").read_text() if (output / ".htaccess").is_file() else "Options -Indexes\n"
        htaccess += '\nSetEnv GNOSI_SITES_SERVICE_CONFIG "' + service_root + '/config.json"\n'
        checks[".htaccess"] = hashlib.sha256(htaccess.encode()).hexdigest()
        begin = _policy(public, private, owner) + '$lock=gnosi_lock();$id=' + json.dumps(release_id) + ';gnosi_id($id);$parent=' + json.dumps(parent_id) + ';if(gnosi_pangea_current()!==$parent){throw new Exception("Parent changed");}$destination=$private."/releases/".$id;if(gnosi_exists($destination)){throw new Exception("Immutable release exists");}' + begin_upload_program() + 'gnosi_directory($destination,true,0711);gnosi_write($destination,"checksums.json","",0600);'
        transport.php(bridge, begin)
        # Transfer the complete control manifest as a private file rather than
        # embedding an unbounded file list in a remote shell command.
        with tempfile.TemporaryDirectory(prefix="gnosi-pangea-manifest-") as temporary:
            manifest_path = Path(temporary) / "checksums.json"
            manifest_data = json.dumps(checks).encode()
            manifest_path.write_bytes(manifest_data)
            manifest_path.chmod(0o600)
            transport.put(bridge, manifest_path, release_root + "/checksums.json")
        manifest_expression = 'json_decode(file_get_contents($manifestFile),true,512,JSON_THROW_ON_ERROR)'
        plan = _policy(public, private, owner) + '$lock=gnosi_lock();$id=' + json.dumps(release_id) + ';$parent=' + json.dumps(parent_id) + ';if(gnosi_pangea_current()!==$parent){throw new Exception("Parent changed");}$manifestFile=gnosi_file(gnosi_release($id),"checksums.json");if(hash_file("sha256",$manifestFile)!==' + json.dumps(hashlib.sha256(manifest_data).hexdigest()) + '){throw new Exception("Transfer manifest integrity failure");}' + reuse_program(pangea=True, manifest_expression=manifest_expression, verified_parent=True)
        missing = json.loads(transport.php(bridge, plan))
        if not isinstance(missing, list) or any(not isinstance(relative, str) or relative not in checks for relative in missing) or len(set(missing)) != len(missing):
            raise HTTPException(503, "The server returned an invalid release transfer plan")
        config: dict[str, JsonValue] = json.loads(configuration(store, site, target.id).read_text())
        config.update({"public_base_url": target.base_url, "db_path": service_root + "/state.sqlite", "spool_path": service_root + "/captures", "library_path": service_root + "/library.php"})
        with tempfile.TemporaryDirectory(prefix="gnosi-pangea-release-") as temporary:
            root = Path(temporary)
            service = root / "service"
            service.mkdir(mode=0o700)
            for source in SERVICE_ROOT.glob("*.php"):
                if source.name != "test.php":
                    destination = service / source.name
                    destination.write_bytes(source.read_bytes())
                    destination.chmod(0o600)
            (service / "config.json").write_text(json.dumps(config))
            (service / "config.json").chmod(0o600)
            (root / ".htaccess").write_text(htaccess)
            archive = root / "release.tar.gz"
            with tarfile.open(archive, "w:gz") as tar:
                for relative in missing:
                    path = root / ".htaccess" if relative == ".htaccess" else output / relative
                    with path.open("rb") as stream:
                        if hashlib.file_digest(stream, "sha256").hexdigest() != checks[relative]:
                            raise HTTPException(409, "The website output changed during transfer")
                    tar.add(path, arcname="public/" + relative, recursive=False)
                tar.add(service, arcname="service", recursive=False)
                for path in service.iterdir():
                    tar.add(path, arcname="service/" + path.name, recursive=False)
            archive.chmod(0o600)
            package_name = "upload-" + release_id + ".tar.gz"
            package_path = service_root + "/" + package_name
            # Keep credentials private from the first upload byte, including
            # interrupted transfers. The retained static tree is traversable.
            transport.php(bridge, _policy(public, private, owner) + '$s=' + json.dumps(service_root) + ';$name=' + json.dumps(package_name) + ';$file=gnosi_file($s,$name);if(gnosi_exists($file)){throw new Exception("Upload already exists");}gnosi_write($s,$name,"",0600);')
            transport.put(bridge, archive, package_path)
        bridge.run("tar -xzf " + shlex.quote(package_path) + " -C " + shlex.quote(release_root) + " && rm " + shlex.quote(package_path))
        # Service code/config have a separate lifecycle from retained static releases.
        prepare = _policy(public, private, owner) + '$release=' + json.dumps(release_root) + ';$s=' + json.dumps(service_root) + ';foreach(glob($release."/service/*") as $file){$name=basename($file);$source=gnosi_file($release,"service/".$name);gnosi_write($s,$name,file_get_contents($source));unlink($source);}rmdir($release."/service");$it=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($release."/public",FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::SELF_FIRST);foreach($it as $entry){if($entry->isLink()){throw new Exception("Unreviewed version symlink");}chmod($entry->getPathname(),$entry->isDir()?0755:0644);}chmod($release."/public",0755);'
        transport.php(bridge, prepare)
        if activation_guard:
            activation_guard()
        response = _activate(transport, bridge, public, private, release_id, parent_id, owner, retain=True)
        record_result(store, site, target, response)
        from .private_service import service_root as local_service_root
        receipt = local_service_root(store, site.id, target.id) / "worker-start.json"
        try:
            _start_worker(transport, bridge, public, private, owner)
            private_json(receipt, {"error": None})
        except Exception:
            # Activation is already verified. Keep the published version and expose
            # the independent service startup failure for a deliberate retry.
            private_json(receipt, {"error": "worker_start_pending"})
    return target.base_url


def revert(store: SiteStore, site: SiteConfig, target: SiteTarget, release_id: str, parent_id: str | None, activation_guard: Callable[[], None] | None = None) -> None:
    validate_target(site, target)
    _registration(store, site, target)
    with connection(store) as (transport, bridge):
        public, private = paths(transport, site, target, bridge=bridge)
        if activation_guard:
            activation_guard()
        _activate(transport, bridge, public, private, release_id, parent_id, _owner(store, site, target))


def current_release(store: SiteStore, site: SiteConfig, target: SiteTarget) -> str | None:
    validate_target(site, target)
    _registration(store, site, target)
    with connection(store, bounded=True) as (transport, bridge):
        public, private = paths(transport, site, target, bridge=bridge)
        code = '$root=' + json.dumps(public) + ';if(!file_exists($root)&&!is_link($root)){echo "null";exit;}' + _policy(public, private, _owner(store, site, target)) + 'echo json_encode(gnosi_pangea_current());'
        response: object = json.loads(transport.php(bridge, code))
    if response is not None and (not isinstance(response, str) or not re.fullmatch(r"[a-f0-9]{32}", response)):
        raise HTTPException(409, "Invalid remote release receipt")
    return response


def sync_settings(store: SiteStore, site: SiteConfig, target: SiteTarget, forms_site: SiteConfig) -> None:
    validate_target(site, target)
    _registration(store, site, target)
    with connection(store, bounded=True) as (transport, bridge):
        public, private = paths(transport, site, target, bridge=bridge)
        root = private + "/service"
        policy = _policy(public, private, _owner(store, site, target))
        pending = "config-" + uuid.uuid4().hex + ".json"
        transport.php(bridge, policy + 'gnosi_file(' + json.dumps(root) + ',' + json.dumps(pending) + ');')
        config: dict[str, JsonValue] = json.loads(configuration(store, site, target.id, forms_site=forms_site).read_text())
        config.update({"public_base_url": target.base_url, "db_path": root + "/state.sqlite", "spool_path": root + "/captures", "library_path": root + "/library.php"})
        with tempfile.TemporaryDirectory(prefix="gnosi-pangea-config-") as temporary:
            local = Path(temporary) / "config.json"
            local.write_text(json.dumps(config))
            local.chmod(0o600)
            transport.put(bridge, local, root + "/" + pending)
        transport.php(bridge, policy + '$root=' + json.dumps(root) + ';$pending=gnosi_file($root,' + json.dumps(pending) + ');$raw=file_get_contents($pending);json_decode($raw,true,512,JSON_THROW_ON_ERROR);$p=$root;gnosi_install_config($raw);unlink($pending);')
        _service_request(transport, bridge, public, private, _owner(store, site, target), "forms_sync", {"forms": cast(JsonValue, [form.model_dump(mode="json") for form in forms_site.forms if form.enabled]), "form_delivery": config["form_delivery"]})


def _service_request(transport: Driver, bridge: Bridge, public: str, private: str, owner: str, action: str, request: dict[str, JsonValue]) -> dict[str, JsonValue]:
    from .bounded_bridge import BoundedBridge
    root = private + "/service"
    name = "request-" + uuid.uuid4().hex + ".json"
    transport.php(bridge, _policy(public, private, owner) + 'gnosi_file(' + json.dumps(root) + ',' + json.dumps(name) + ');')
    payload = json.dumps({"action": action, "request": request})
    if len(payload.encode()) > 1_000_000:
        raise HTTPException(413, "The private service request is too large")
    with tempfile.TemporaryDirectory(prefix="gnosi-pangea-request-") as temporary:
        local = Path(temporary) / name
        local.write_text(payload)
        local.chmod(0o600)
        transport.put(bridge, local, root + "/" + name)
    cleanup = "rm -f " + shlex.quote(root + "/" + name)
    code = _policy(public, private, owner) + '$p=$private."/service";$config=gnosi_service_config();$cli=gnosi_service_script("cli.php");gnosi_file($p,' + json.dumps(name) + ');if(!putenv("GNOSI_SITES_SERVICE_CONFIG=".$config)){throw new Exception("Service configuration unavailable");}require $cli;'
    command = "trap " + shlex.quote(cleanup) + " EXIT; php -r " + shlex.quote(code) + " < " + shlex.quote(root + "/" + name)
    raw = bridge.run(command, completed_response=True) if isinstance(bridge, BoundedBridge) else bridge.run(command)
    result: object = json.loads(raw)
    if not isinstance(result, dict) or result.get("error") or result.get("test_mode") is not (not owner.endswith(":production")):
        raise HTTPException(503, "The Pangea test service could not complete the operation")
    return cast(dict[str, JsonValue], result)


def service(store: SiteStore, site: SiteConfig, target_id: str, action: str, request: dict[str, JsonValue]) -> dict[str, JsonValue]:
    import pexpect  # type: ignore[import-untyped]
    from .bounded_bridge import BoundedBridge, PangeaTransportInterrupted
    target = next(target for target in site.targets if target.id == target_id)
    validate_target(site, target)
    _registration(store, site, target)
    with connection(store, bounded=True) as (transport, bridge):
        for attempt in range(2):
            try:
                public, private = paths(transport, site, target, bridge=bridge)
                return _service_request(transport, bridge, public, private, _owner(store, site, target), action, request)
            except TimeoutError:
                raise HTTPException(503, "The Pangea operation exceeded its deadline") from None
            except (PangeaTransportInterrupted, pexpect.EOF, pexpect.TIMEOUT, ConnectionAbortedError):
                # Only semantic reads may restart after a lost response. Keep
                # both attempts inside the same connection slot and deadline.
                if action not in _READ_ACTIONS or attempt or not isinstance(bridge, BoundedBridge):
                    raise HTTPException(503, "The Pangea operation was interrupted; its result may be unconfirmed") from None
                bridge.close()
                try:
                    time.sleep(min(1.0, bridge.remaining()))
                    bridge.remaining()
                except TimeoutError:
                    raise HTTPException(503, "The Pangea read exceeded its deadline") from None
                log.info("Recovering interrupted Pangea read: %s", action)
        raise HTTPException(503, "The Pangea read could not complete")
