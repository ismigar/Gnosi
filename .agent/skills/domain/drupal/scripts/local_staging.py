#!/usr/bin/env python3
"""Build and operate an isolated local clone of production Drupal."""

from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import secrets
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import time
import uuid
from pathlib import Path
from typing import Optional

import pexpect
from dotenv import load_dotenv

from remote_agent import DrupalRemoteAgent


DEFAULT_PROJECT_ROOT = Path(__file__).resolve().parents[5]
PROJECT_ROOT = Path(os.environ.get("DRUPAL_PROJECT_ROOT", DEFAULT_PROJECT_ROOT)).resolve()
ENV_FILE = PROJECT_ROOT / ".env_shared"
STAGING_ROOT = Path(
    os.environ.get("DRUPAL_LOCAL_STAGE_ROOT", PROJECT_ROOT / ".local" / "drupal-staging")
).resolve()
SITE_ROOT = STAGING_ROOT / "site"
STATE_FILE = STAGING_ROOT / "state.json"
PHP_BIN = Path("/opt/homebrew/opt/php@8.4/bin/php")
COMPOSER_BIN = Path("/opt/homebrew/bin/composer")
MARIADB_ROOT = Path("/opt/homebrew/opt/mariadb@11.4/bin")
MARIADB_BIN = MARIADB_ROOT / "mariadb"
MARIADB_ADMIN_BIN = MARIADB_ROOT / "mariadb-admin"
MARIADB_INSTALL_BIN = MARIADB_ROOT / "mariadb-install-db"
MARIADB_SERVER_BIN = MARIADB_ROOT / "mariadbd"
DATABASE_DIR = STAGING_ROOT / "mariadb"
DATABASE_CONFIG = STAGING_ROOT / "mariadb.cnf"
DATABASE_SOCKET = STAGING_ROOT / "mariadb.sock"
DATABASE_PID = STAGING_ROOT / "mariadb.pid"
DATABASE_LOG = STAGING_ROOT / "mariadb.log"
WEB_PID = STAGING_ROOT / "server.pid"
WEB_LOG = STAGING_ROOT / "server.log"
LOCAL_HOST = "127.0.0.1"
LOCAL_WEB_PORT = 8088
LOCAL_DATABASE_PORT = 3307
DATABASE_NAME = "temenos_drupal_stage"
DATABASE_USER = "temenos_stage"


def run(
    command: list[str],
    *,
    cwd: Optional[Path] = None,
    input_file=None,
    input_text: Optional[str] = None,
    input_bytes: Optional[bytes] = None,
    capture: bool = False,
    timeout: Optional[int] = None,
    check: bool = True,
) -> subprocess.CompletedProcess:
    """Run a local command and optionally enforce a successful exit."""
    result = subprocess.run(
        command,
        cwd=cwd,
        stdin=input_file,
        input=input_bytes if input_bytes is not None else input_text,
        text=input_file is None and input_bytes is None,
        capture_output=capture,
        timeout=timeout,
        check=False,
    )
    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip() if capture else ""
        raise RuntimeError(
            f"Command failed ({result.returncode}): {shlex.join(command)}"
            + (f"\n{detail}" if detail else "")
        )
    return result


def ensure_prerequisites() -> None:
    """Validate the deterministic local runtime binaries."""
    required = [
        PHP_BIN,
        COMPOSER_BIN,
        MARIADB_BIN,
        MARIADB_ADMIN_BIN,
        MARIADB_INSTALL_BIN,
        MARIADB_SERVER_BIN,
    ]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise RuntimeError(f"Missing prerequisites: {', '.join(missing)}")
    version = run(
        [str(PHP_BIN), "-r", "echo PHP_MAJOR_VERSION.'.'.PHP_MINOR_VERSION;"],
        capture=True,
    ).stdout.strip()
    if version != "8.4":
        raise RuntimeError(f"Expected PHP 8.4, found {version}")
    modules = run([str(PHP_BIN), "-m"], capture=True).stdout.lower()
    for extension in ("pdo_mysql", "gd", "intl", "mbstring", "xml", "zip"):
        if extension not in modules:
            raise RuntimeError(f"Missing PHP extension: {extension}")


def load_state() -> dict[str, str]:
    """Read local secrets and metadata."""
    if not STATE_FILE.exists():
        return {}
    return json.loads(STATE_FILE.read_text(encoding="utf-8"))


def save_state(state: dict[str, str]) -> None:
    """Persist local secrets with user-only permissions."""
    STAGING_ROOT.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    STATE_FILE.chmod(0o600)


def database_credentials() -> dict[str, str]:
    """Return stable generated credentials for the local clone."""
    state = load_state()
    state.setdefault("database", DATABASE_NAME)
    state.setdefault("database_user", DATABASE_USER)
    # Rotate on every refresh so a failed or logged setup cannot retain access.
    state["database_password"] = secrets.token_urlsafe(32)
    state.setdefault("hash_salt", secrets.token_urlsafe(48))
    save_state(state)
    return state


def write_database_config() -> None:
    """Write the loopback-only MariaDB configuration."""
    STAGING_ROOT.mkdir(parents=True, exist_ok=True)
    DATABASE_CONFIG.write_text(
        f"""[mariadbd]
datadir={DATABASE_DIR}
socket={DATABASE_SOCKET}
pid-file={DATABASE_PID}
log-error={DATABASE_LOG}
port={LOCAL_DATABASE_PORT}
bind-address={LOCAL_HOST}
skip-networking=0
max_allowed_packet=256M
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci

[client]
socket={DATABASE_SOCKET}
port={LOCAL_DATABASE_PORT}
""",
        encoding="utf-8",
    )
    DATABASE_CONFIG.chmod(0o600)


def database_client(
    *arguments: str,
    capture: bool = False,
    check: bool = True,
    input_file=None,
    input_text: Optional[str] = None,
    input_bytes: Optional[bytes] = None,
):
    """Run the isolated MariaDB client through its private socket."""
    return run(
        [
            str(MARIADB_BIN),
            f"--socket={DATABASE_SOCKET}",
            "--user=root",
            *arguments,
        ],
        capture=capture,
        check=check,
        input_file=input_file,
        input_text=input_text,
        input_bytes=input_bytes,
    )


def database_is_running() -> bool:
    """Return whether the dedicated MariaDB instance responds."""
    result = run(
        [
            str(MARIADB_ADMIN_BIN),
            f"--socket={DATABASE_SOCKET}",
            "--user=root",
            "ping",
        ],
        capture=True,
        check=False,
    )
    return result.returncode == 0


def start_database() -> None:
    """Initialize and start the dedicated loopback MariaDB instance."""
    write_database_config()
    if database_is_running():
        return
    if not (DATABASE_DIR / "mysql").exists():
        DATABASE_DIR.mkdir(parents=True, exist_ok=True)
        run(
            [
                str(MARIADB_INSTALL_BIN),
                f"--defaults-file={DATABASE_CONFIG}",
                f"--datadir={DATABASE_DIR}",
                "--auth-root-authentication-method=normal",
                "--skip-test-db",
            ],
            timeout=300,
        )
    subprocess.Popen(
        [str(MARIADB_SERVER_BIN), f"--defaults-file={DATABASE_CONFIG}"],
        cwd=STAGING_ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    for _ in range(80):
        if database_is_running():
            return
        time.sleep(0.25)
    raise RuntimeError(f"MariaDB failed to start; inspect {DATABASE_LOG}")


def stop_database() -> None:
    """Stop the dedicated MariaDB instance cleanly."""
    if database_is_running():
        run(
            [
                str(MARIADB_ADMIN_BIN),
                f"--socket={DATABASE_SOCKET}",
                "--user=root",
                "shutdown",
            ],
            capture=True,
        )


def production_agent() -> DrupalRemoteAgent:
    """Create the Suweb bridge from the shared private environment."""
    if not ENV_FILE.exists():
        raise RuntimeError(f"Shared environment file not found: {ENV_FILE}")
    load_dotenv(ENV_FILE, override=True)
    return DrupalRemoteAgent()


def remote_command(agent: DrupalRemoteAgent, command: str, timeout: int) -> None:
    """Execute a remote command and preserve redaction."""
    success, output = agent.run_command_output(command, timeout=timeout)
    if not success:
        raise RuntimeError(f"Remote command failed: {output}")


def download_remote(agent: DrupalRemoteAgent, remote_path: str, local_path: Path) -> None:
    """Download one temporary production artifact with SCP."""
    local_path.parent.mkdir(parents=True, exist_ok=True)
    local_path.unlink(missing_ok=True)
    child = pexpect.spawn(
        "scp",
        [
            "-P",
            str(agent.port),
            f"{agent.user}@{agent.host}:{remote_path}",
            str(local_path),
        ],
        encoding="utf-8",
        timeout=900,
    )
    transcript = []
    while True:
        match = child.expect(
            [
                "(?i)password:",
                "(?i)are you sure you want to continue connecting",
                pexpect.EOF,
                pexpect.TIMEOUT,
            ]
        )
        transcript.append(child.before or "")
        if match == 0:
            child.sendline(agent.password)
        elif match == 1:
            child.sendline("yes")
        elif match == 2:
            child.close()
            break
        else:
            child.close(force=True)
            raise RuntimeError("SCP download timed out")
    if not local_path.exists() or local_path.stat().st_size == 0:
        detail = DrupalRemoteAgent._redact_output("".join(transcript)).strip()
        raise RuntimeError("SCP produced no artifact" + (f": {detail}" if detail else ""))


def validate_code_archive(path: Path) -> None:
    """Verify the production code archive is complete and recognizable."""
    try:
        with tarfile.open(path, "r:gz") as archive:
            names = set(archive.getnames())
    except (OSError, tarfile.TarError) as error:
        raise RuntimeError(f"Invalid production code archive: {error}") from error
    if "./composer.json" not in names or "./composer.lock" not in names:
        raise RuntimeError("Production code archive is missing Composer metadata")


def validate_database_dump(path: Path) -> None:
    """Verify the compressed database export can be decompressed."""
    try:
        with gzip.open(path, "rb") as dump:
            prefix = dump.read(128)
    except OSError as error:
        raise RuntimeError(f"Invalid production database dump: {error}") from error
    if not prefix:
        raise RuntimeError("Production database dump is empty")


def fetch_code(agent: DrupalRemoteAgent, reuse_code: bool) -> Path:
    """Download or reuse the validated production code snapshot."""
    local_path = STAGING_ROOT / "production-code.tar.gz"
    if reuse_code and local_path.exists():
        validate_code_archive(local_path)
        print("Reusing the validated production code archive.")
        return local_path
    nonce = uuid.uuid4().hex
    remote_path = f"/tmp/temenos-stage-code-{nonce}.tar.gz"
    command = (
        "tar --exclude='./web/sites/default/files' "
        "--exclude='./private_backups' "
        f"-czf {shlex.quote(remote_path)} . && chmod 644 {shlex.quote(remote_path)}"
    )
    try:
        print("Creating the production code snapshot...")
        remote_command(agent, command, timeout=900)
        download_remote(agent, remote_path, local_path)
    finally:
        remote_command(agent, f"rm -f {shlex.quote(remote_path)}", timeout=60)
    validate_code_archive(local_path)
    return local_path


def fetch_database(agent: DrupalRemoteAgent, reuse_database: bool = False) -> Path:
    """Export and download a fresh production database dump."""
    nonce = uuid.uuid4().hex
    remote_base = f"/tmp/temenos-stage-db-{nonce}.sql"
    remote_path = f"{remote_base}.gz"
    local_path = STAGING_ROOT / "production-db.sql.gz"
    if reuse_database and local_path.exists():
        validate_database_dump(local_path)
        print("Reusing the validated production database dump.")
        return local_path
    command = (
        "drush sql:dump --gzip "
        f"--result-file={shlex.quote(remote_base)} "
        f"&& chmod 644 {shlex.quote(remote_path)}"
    )
    try:
        print("Exporting the production database...")
        remote_command(agent, command, timeout=300)
        download_remote(agent, remote_path, local_path)
    finally:
        remote_command(
            agent,
            f"rm -f {shlex.quote(remote_base)} {shlex.quote(remote_path)}",
            timeout=60,
        )
    validate_database_dump(local_path)
    return local_path


def extract_code(code_archive: Path) -> None:
    """Replace only the ignored local clone with the production snapshot."""
    if SITE_ROOT.exists():
        shutil.rmtree(SITE_ROOT)
    SITE_ROOT.mkdir(parents=True)
    destination = SITE_ROOT.resolve()
    with tarfile.open(code_archive, "r:gz") as archive:
        for member in archive.getmembers():
            member_path = (SITE_ROOT / member.name).resolve()
            if destination != member_path and destination not in member_path.parents:
                raise RuntimeError(f"Unsafe archive member: {member.name}")
        archive.extractall(SITE_ROOT)
    source = PROJECT_ROOT / "temenos" / "web" / "sites" / "default" / "files"
    target = SITE_ROOT / "web" / "sites" / "default" / "files"
    if source.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.parent.chmod(0o755)
        run(["/bin/cp", "-cR", str(source), str(target)])
    else:
        target.mkdir(parents=True, exist_ok=True)


def sql_literal(value: str) -> str:
    """Escape one MariaDB string literal."""
    return "'" + value.replace("\\", "\\\\").replace("'", "''") + "'"


def recreate_database(state: dict[str, str], dump_path: Path) -> None:
    """Recreate and import the isolated local Drupal database."""
    database = state["database"]
    username = state["database_user"]
    password = state["database_password"]
    if not re.fullmatch(r"[a-z0-9_]+", database + username):
        raise RuntimeError("Unsafe local database identifier")
    account_local = f"{sql_literal(username)}@'localhost'"
    account_tcp = f"{sql_literal(username)}@'127.0.0.1'"
    statement = (
        f"DROP DATABASE IF EXISTS `{database}`;"
        f"CREATE DATABASE `{database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
        f"CREATE USER IF NOT EXISTS {account_local} IDENTIFIED BY {sql_literal(password)};"
        f"CREATE USER IF NOT EXISTS {account_tcp} IDENTIFIED BY {sql_literal(password)};"
        f"ALTER USER {account_local} IDENTIFIED BY {sql_literal(password)};"
        f"ALTER USER {account_tcp} IDENTIFIED BY {sql_literal(password)};"
        f"GRANT ALL PRIVILEGES ON `{database}`.* TO {account_local};"
        f"GRANT ALL PRIVILEGES ON `{database}`.* TO {account_tcp}; FLUSH PRIVILEGES;"
    )
    database_client(input_text=statement)
    with gzip.open(dump_path, "rb") as dump:
        database_client(database, input_bytes=dump.read())


def apply_database_password(state: dict[str, str]) -> None:
    """Apply the generated Drupal database password without process arguments."""
    username = state["database_user"]
    password = state["database_password"]
    account_local = f"{sql_literal(username)}@'localhost'"
    account_tcp = f"{sql_literal(username)}@'127.0.0.1'"
    statement = (
        f"ALTER USER {account_local} IDENTIFIED BY {sql_literal(password)};"
        f"ALTER USER {account_tcp} IDENTIFIED BY {sql_literal(password)};"
        "FLUSH PRIVILEGES;"
    )
    database_client(input_text=statement)


def php_literal(value: str) -> str:
    """Escape one single-quoted PHP string literal."""
    return value.replace("\\", "\\\\").replace("'", "\\'")


def settings_local_contents(state: dict[str, str]) -> str:
    """Render the ignored Drupal settings override."""
    return f"""<?php

// Generated by local_staging.py. This file must never be committed.
$databases['default']['default'] = [
  'database' => '{php_literal(state['database'])}',
  'username' => '{php_literal(state['database_user'])}',
  'password' => '{php_literal(state['database_password'])}',
  'prefix' => '',
  'host' => '{LOCAL_HOST}',
  'port' => '{LOCAL_DATABASE_PORT}',
  'isolation_level' => 'READ COMMITTED',
  'driver' => 'mysql',
  'namespace' => 'Drupal\\mysql\\Driver\\Database\\mysql',
  'autoload' => 'core/modules/mysql/src/Driver/Database/mysql/',
];

$settings['hash_salt'] = '{php_literal(state['hash_salt'])}';
$settings['trusted_host_patterns'] = ['^localhost$', '^127\\.0\\.0\\.1$'];
$settings['file_private_path'] = '{php_literal(str(STAGING_ROOT / 'private'))}';
$settings['file_temp_path'] = '{php_literal(str(STAGING_ROOT / 'tmp'))}';
$settings['skip_permissions_hardening'] = TRUE;
$settings['deployment_identifier'] = 'local-staging';
$settings['http_client_config']['proxy'] = 'http://127.0.0.1:9';
$settings['enable_html5_validation'] = FALSE;

$config['system.site']['name'] = 'LOCAL STAGING · Temenos de Ismael';
$config['system.logging']['error_level'] = 'verbose';
$config['automated_cron.settings']['interval'] = 0;
$config['smtp.settings']['smtp_on'] = FALSE;
$config['smtp.settings']['smtp_host'] = '127.0.0.1';
$config['smtp.settings']['smtp_port'] = 9;
"""


def router_contents() -> str:
    """Return the PHP built-in-server router for the local Drupal clone."""
    return """<?php
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
$file = __DIR__ . '/site/web' . $path;
if ($path !== '/' && is_file($file)) {
  return FALSE;
}
require __DIR__ . '/site/web/index.php';
"""


def write_local_configuration(state: dict[str, str]) -> None:
    """Write local Drupal settings and the built-in-server router."""
    settings = SITE_ROOT / "web" / "sites" / "default" / "settings.local.php"
    settings.parent.mkdir(parents=True, exist_ok=True)
    if settings.exists():
        settings.chmod(0o600)
    settings.write_text(settings_local_contents(state), encoding="utf-8")
    settings.chmod(0o600)
    (STAGING_ROOT / "private").mkdir(parents=True, exist_ok=True)
    (STAGING_ROOT / "tmp").mkdir(parents=True, exist_ok=True)
    (STAGING_ROOT / "router.php").write_text(router_contents(), encoding="utf-8")


def composer_install() -> None:
    """Install the exact production dependency lock with PHP 8.4."""
    run(
        [
            str(PHP_BIN),
            str(COMPOSER_BIN),
            "install",
            "--no-interaction",
            "--prefer-dist",
            "--no-progress",
        ],
        cwd=SITE_ROOT,
        timeout=1800,
    )


def drush_command(*arguments: str) -> list[str]:
    """Build a Drush command for the deterministic PHP runtime."""
    return [
        str(PHP_BIN),
        "-d",
        "error_reporting=24575",
        str(SITE_ROOT / "vendor" / "drush" / "drush" / "drush.php"),
        "--root",
        str(SITE_ROOT / "web"),
        *arguments,
    ]


def drush(*arguments: str, capture: bool = False, check: bool = True):
    """Run cloned-site Drush with the deterministic PHP runtime."""
    return run(
        drush_command(*arguments),
        cwd=SITE_ROOT,
        capture=capture,
        timeout=300,
        check=check,
    )


def harden_active_configuration() -> None:
    """Persist safe outputs before the first local web request."""
    php = """
if (\\Drupal::configFactory()->get('automated_cron.settings')->getRawData()) {
  \\Drupal::configFactory()->getEditable('automated_cron.settings')
    ->set('interval', 0)->save();
}
if (\\Drupal::configFactory()->get('smtp.settings')->getRawData()) {
  \\Drupal::configFactory()->getEditable('smtp.settings')
    ->set('smtp_on', FALSE)
    ->set('smtp_host', '127.0.0.1')
    ->set('smtp_port', 9)
    ->save();
}
"""
    drush("php:eval", php)
    normalize_php = """
$storage = \\Drupal::entityTypeManager()->getStorage('menu_link_content');
foreach ($storage->loadByProperties(['menu_name' => 'legal']) as $link) {
  $uri = $link->get('link')->uri;
  if (str_starts_with($uri, 'internal:/') && preg_match('/[^\\x00-\\x7F]/', $uri)) {
    $encoded = str_replace('%2F', '/', rawurlencode(substr($uri, 9)));
    $link->set('link', ['uri' => 'internal:/' . $encoded]);
    $link->save();
  }
}
"""
    drush("php:eval", normalize_php)
    drush("cache:rebuild")
    # Production dumps can capture partial plugin-discovery entries while a
    # cache rebuild is in progress. Let the clone repopulate them lazily.
    drush("sql:query", "TRUNCATE cache_discovery;")


def harden() -> None:
    """Reapply safety settings to an imported local clone."""
    ensure_prerequisites()
    start_database()
    state = load_state()
    if not state:
        raise RuntimeError("Local staging has not been refreshed")
    write_local_configuration(state)
    harden_active_configuration()
    verify()


def rotate_credentials() -> None:
    """Rotate the clone-only database password and rewrite local settings."""
    ensure_prerequisites()
    start_database()
    state = load_state()
    if not state:
        raise RuntimeError("Local staging has not been refreshed")
    state["database_password"] = secrets.token_urlsafe(32)
    apply_database_password(state)
    save_state(state)
    write_local_configuration(state)
    verify()


def verify() -> None:
    """Verify bootstrap, isolation, cron, and SMTP safety."""
    ensure_prerequisites()
    start_database()
    if not SITE_ROOT.exists():
        raise RuntimeError("Local staging has not been refreshed")
    output = drush(
        "status",
        "--fields=drupal-version,db-status,bootstrap,uri",
        capture=True,
    ).stdout
    normalized = output.lower()
    if not all(value in normalized for value in ("drupal version", "connected", "successful")):
        raise RuntimeError(f"Drupal verification failed:\n{output}")
    database_runtime = database_client(
        "-Nse", "SELECT @@port, @@bind_address;", capture=True
    ).stdout.strip()
    if str(LOCAL_DATABASE_PORT) not in database_runtime or LOCAL_HOST not in database_runtime:
        raise RuntimeError(f"MariaDB is not isolated: {database_runtime}")
    safety_output = drush(
        "php:eval",
        "echo json_encode(['cron' => \\Drupal::config('automated_cron.settings')->get('interval'), 'smtp' => \\Drupal::config('smtp.settings')->get('smtp_on')]);",
        capture=True,
    ).stdout.strip()
    safety = json.loads(safety_output)
    if safety.get("cron") != 0:
        raise RuntimeError("Automated cron is not disabled")
    if safety.get("smtp") is not False:
        raise RuntimeError("SMTP is not disabled")
    print(output.strip())
    print(
        f"Isolation checks: MariaDB {LOCAL_HOST}:{LOCAL_DATABASE_PORT}; "
        "automated cron disabled; SMTP disabled; Drupal HTTP proxy blocked."
    )


def refresh(
    reuse_code: bool = False,
    reuse_database: bool = False,
    reuse_site: bool = False,
) -> None:
    """Refresh the complete local clone from production."""
    ensure_prerequisites()
    start_database()
    agent = production_agent()
    code_archive = fetch_code(agent, reuse_code)
    database_dump = fetch_database(agent, reuse_database=reuse_database)
    if reuse_site and (SITE_ROOT / "composer.json").exists():
        print("Reusing the already extracted local site.")
        source = PROJECT_ROOT / "temenos" / "web" / "sites" / "default" / "files"
        target = SITE_ROOT / "web" / "sites" / "default" / "files"
        if source.exists() and not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            target.parent.chmod(0o755)
            run(["/bin/cp", "-cR", str(source), str(target)])
    else:
        print("Extracting the production code snapshot...")
        extract_code(code_archive)
    state = database_credentials()
    write_local_configuration(state)
    print("Installing locked Composer dependencies with PHP 8.4...")
    composer_install()
    print("Importing the production database...")
    recreate_database(state, database_dump)
    print("Applying local safety settings...")
    harden_active_configuration()
    verify()


def web_is_running() -> bool:
    """Return whether the loopback web port accepts connections."""
    try:
        with socket.create_connection((LOCAL_HOST, LOCAL_WEB_PORT), timeout=0.5):
            return True
    except OSError:
        return False


def web_server_command() -> list[str]:
    """Build the loopback web command with Drupal's web root as document root."""
    return [
        str(PHP_BIN),
        "-d",
        "sendmail_path=/usr/bin/false",
        "-S",
        f"{LOCAL_HOST}:{LOCAL_WEB_PORT}",
        "-t",
        str(SITE_ROOT / "web"),
        str(STAGING_ROOT / "router.php"),
    ]


def start() -> None:
    """Start the loopback-only PHP server in the background."""
    verify()
    if web_is_running():
        print(f"Local staging is already running at http://{LOCAL_HOST}:{LOCAL_WEB_PORT}")
        return
    command = web_server_command()
    with WEB_LOG.open("a", encoding="utf-8") as log:
        process = subprocess.Popen(
            command,
            cwd=STAGING_ROOT,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    WEB_PID.write_text(f"{process.pid}\n", encoding="utf-8")
    for _ in range(40):
        if web_is_running():
            print(f"Local staging started at http://{LOCAL_HOST}:{LOCAL_WEB_PORT}")
            return
        if process.poll() is not None:
            break
        time.sleep(0.25)
    raise RuntimeError(f"Web server failed to start; inspect {WEB_LOG}")


def stop_web() -> None:
    """Stop the PHP built-in server if this helper started it."""
    if not WEB_PID.exists():
        return
    pid = int(WEB_PID.read_text(encoding="utf-8").strip())
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    WEB_PID.unlink(missing_ok=True)


def stop() -> None:
    """Stop both local staging services."""
    stop_web()
    stop_database()
    print("Local Drupal staging stopped.")


def parse_args() -> argparse.Namespace:
    """Parse the lifecycle command."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action",
        choices=("refresh", "harden", "rotate_credentials", "verify", "start", "stop"),
    )
    parser.add_argument(
        "--reuse-code",
        action="store_true",
        help="Reuse an already validated production code archive during refresh.",
    )
    parser.add_argument(
        "--reuse-site",
        action="store_true",
        help="Reuse an already extracted local site after a safe retry.",
    )
    parser.add_argument(
        "--reuse-database",
        action="store_true",
        help="Reuse an already validated production database dump during a retry.",
    )
    return parser.parse_args()


def main() -> int:
    """Execute the requested lifecycle action."""
    args = parse_args()
    try:
        if args.action == "refresh":
            refresh(
                reuse_code=args.reuse_code,
                reuse_database=args.reuse_database,
                reuse_site=args.reuse_site,
            )
        else:
            globals()[args.action]()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
