"""Provider neutral SSH/SFTP authentication, quoting and bounded failures."""
from __future__ import annotations

import os
from pathlib import Path
import stat
import subprocess
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.domains.sites import ssh_transport as transport


def settings(**changes):
    values = dict(host="server.example", username="alice", port=2222,
                  authentication="agent", identity_file="", ssh_key_reference="")
    return SimpleNamespace(**(values | changes))


@pytest.fixture(autouse=True)
def binaries(monkeypatch):
    monkeypatch.setattr(transport.shutil, "which", lambda name: "/usr/bin/" + name)


def test_agent_uses_strict_known_hosts_and_existing_agent(monkeypatch):
    monkeypatch.setenv("SSH_AUTH_SOCK", "/tmp/test-agent")
    monkeypatch.setenv("GNOSI_UNRELATED_SECRET", "never-forward")
    seen = {}

    def run(argv, **kwargs):
        seen.update(argv=argv, **kwargs)
        return SimpleNamespace(returncode=0, stdout=b"ready")

    monkeypatch.setattr(transport.subprocess, "run", run)
    assert transport.run_ssh(settings(), "echo ready", payload=b"data", timeout=12) == b"ready"
    assert "StrictHostKeyChecking=yes" in seen["argv"]
    assert "BatchMode=yes" in seen["argv"]
    assert seen["argv"][-4:] == ["-p", "2222", "server.example", "echo ready"]
    assert "User=alice" in seen["argv"]
    assert seen["input"] == b"data" and seen["timeout"] == 12
    assert seen["env"]["SSH_AUTH_SOCK"] == "/tmp/test-agent"
    assert "GNOSI_UNRELATED_SECRET" not in seen["env"]
    assert seen["start_new_session"] is True
    assert "shell" not in seen


@pytest.mark.parametrize("change", [dict(host="-oProxyCommand=bad"), dict(host="server\nput bad"),
                                   dict(username="alice:other"), dict(username="x\n"),
                                   dict(username="alice/other"), dict(username="alice other"),
                                   dict(username="-oProxyCommand=evil"),
                                   dict(port=0), dict(port=True), dict(port="22"),
                                   dict(ssh_key_reference="bad\nkey"), dict(authentication="other")])
def test_invalid_connections_never_spawn(change, monkeypatch):
    monkeypatch.setattr(transport.subprocess, "run", lambda *a, **kw: pytest.fail("spawned"))
    with pytest.raises(HTTPException) as error:
        transport.run_ssh(settings(**change), "true")
    assert error.value.status_code == 422


def test_explicit_key_requires_absolute_existing_regular_file(tmp_path):
    key = tmp_path / "identity with spaces"
    key.write_text("synthetic")
    argv = transport.ssh_argv(settings(authentication="key", identity_file=str(key)))
    assert argv[argv.index("-i") + 1] == str(key)
    assert "IdentitiesOnly=yes" in argv and "BatchMode=yes" in argv
    for invalid in ("relative", str(tmp_path), str(tmp_path / "missing"), str(key) + "\n"):
        with pytest.raises(HTTPException) as error:
            transport.ssh_argv(settings(authentication="key", identity_file=invalid))
        assert error.value.status_code == 422


def test_unresolved_legacy_key_reference_is_not_silently_ignored():
    with pytest.raises(HTTPException) as error:
        transport.ssh_argv(settings(ssh_key_reference="historical-key"))
    assert error.value.status_code == 409


def test_sftp_ipv6_destination_keeps_address_separate_from_remote_path(monkeypatch):
    captured = []

    def run(argv, **kwargs):
        captured.append(argv)
        return SimpleNamespace(returncode=0, stdout=b"ready")

    monkeypatch.setattr(transport.subprocess, "run", run)
    assert transport.probe_sftp(settings(host="2001:db8::1")) is True
    assert captured[0][-1] == "[2001:db8::1]"


@pytest.mark.parametrize("protocol", ["ssh", "sftp"])
def test_email_virtual_account_is_one_explicit_user_option_for_exact_host(monkeypatch, protocol):
    captured = []
    account = "alice+website@example.org"

    def run(argv, **kwargs):
        captured.append(argv)
        return SimpleNamespace(returncode=0, stdout=b"ready")

    monkeypatch.setattr(transport.subprocess, "run", run)
    profile = settings(username=account)
    if protocol == "ssh":
        transport.run_ssh(profile, "true")
        assert captured[0][-2:] == ["server.example", "true"]
    else:
        transport.run_sftp(profile, "pwd\nquit\n")
        assert captured[0][-1] == "server.example"
    argv = captured[0]
    assert argv.count("User=" + account) == 1
    assert argv[argv.index("User=" + account) - 1] == "-o"
    assert all(account not in arg for arg in argv if arg != "User=" + account)


@pytest.mark.parametrize("failed", [False, True])
def test_password_is_child_only_and_helper_removed_even_after_timeout(monkeypatch, failed):
    secret = "synthetic password `not a command`"
    original_environment = dict(os.environ)
    helper_paths = []
    child_environment = []

    def run(argv, **kwargs):
        environment = kwargs["env"]
        child_environment.append(environment)
        helper = Path(environment["SSH_ASKPASS"])
        helper_paths.append(helper)
        assert stat.S_IMODE(helper.stat().st_mode) == 0o700
        assert stat.S_IMODE(helper.parent.stat().st_mode) == 0o700
        assert secret not in helper.read_text() and secret not in " ".join(argv)
        assert environment["GNOSI_SSH_PASSWORD"] == secret
        assert environment["SSH_ASKPASS_REQUIRE"] == "force"
        assert "BatchMode=no" in argv and "PreferredAuthentications=password" in argv
        assert dict(os.environ) == original_environment
        if failed:
            raise subprocess.TimeoutExpired(argv, 1, output=secret.encode(), stderr=secret.encode())
        return SimpleNamespace(returncode=0, stdout=b"ready")

    monkeypatch.setattr(transport.subprocess, "run", run)
    if failed:
        with pytest.raises(HTTPException) as error:
            transport.run_ssh(settings(authentication="password"), "true", password=secret)
        assert error.value.status_code == 503 and secret not in str(error.value.detail)
    else:
        assert transport.run_ssh(settings(authentication="password"), "true", password=secret) == b"ready"
    assert helper_paths and all(not path.exists() for path in helper_paths)
    assert "GNOSI_SSH_PASSWORD" not in child_environment[0]
    assert dict(os.environ) == original_environment


def test_password_required_before_spawn(monkeypatch):
    monkeypatch.setattr(transport.subprocess, "run", lambda *a, **kw: pytest.fail("spawned"))
    with pytest.raises(HTTPException) as error:
        transport.run_sftp(settings(authentication="password"), "pwd\n")
    assert error.value.status_code == 409


@pytest.mark.parametrize("failure", [OSError("secret"), ValueError("secret"),
                                    subprocess.TimeoutExpired("ssh", 1, stderr=b"secret")])
def test_failures_never_expose_remote_output_or_credentials(monkeypatch, failure):
    def run(*args, **kwargs):
        raise failure

    monkeypatch.setattr(transport.subprocess, "run", run)
    with pytest.raises(HTTPException) as error:
        transport.run_ssh(settings(), "true")
    assert error.value.status_code == 503 and "secret" not in error.value.detail


def test_sftp_transfer_quotes_local_globs_and_spaces_and_uses_port(tmp_path, monkeypatch):
    local = tmp_path / 'asset [one]*?".txt'
    local.write_text("synthetic")
    captured = {}

    def run(argv, **kwargs):
        captured.update(argv=argv, **kwargs)
        return SimpleNamespace(returncode=0, stdout=b"")

    monkeypatch.setattr(transport.subprocess, "run", run)
    transport.upload_sftp(settings(), local, "/home/alice/site/asset one.txt")
    assert captured["argv"][-5:] == ["-P", "2222", "-b", "-", "server.example"]
    assert b'\\[one\\]\\*\\?\\".txt" "/home/alice/site/asset one.txt"\nquit\n' in captured["input"]
    assert captured["timeout"] == 45


@pytest.mark.parametrize("remote", ["relative/file", "/a/../file", "/a\n!touch evil", "/a\rquit", "/a\"file", "/a;file", "/a\\file"])
def test_sftp_transfer_rejects_injected_paths(tmp_path, monkeypatch, remote):
    local = tmp_path / "file"
    local.write_text("synthetic")
    monkeypatch.setattr(transport.subprocess, "run", lambda *a, **kw: pytest.fail("spawned"))
    with pytest.raises(HTTPException) as error:
        transport.upload_sftp(settings(), local, remote)
    assert error.value.status_code == 422


def test_sftp_rejects_local_newline_and_reports_probe_failure(tmp_path, monkeypatch):
    local = tmp_path / "file\n!evil"
    local.write_text("synthetic")
    monkeypatch.setattr(transport.subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=1, stdout=b"sensitive", stderr=b"sensitive"))
    with pytest.raises(HTTPException) as error:
        transport.upload_sftp(settings(), local, "/file")
    assert error.value.status_code == 422
    assert transport.probe_sftp(settings()) is False


@pytest.mark.parametrize("timeout", [0, -1, 301, float("nan"), True])
def test_deadlines_are_bounded_before_spawning(timeout, monkeypatch):
    monkeypatch.setattr(transport.subprocess, "run", lambda *a, **kw: pytest.fail("spawned"))
    with pytest.raises(HTTPException) as error:
        transport.run_ssh(settings(), "true", timeout=timeout)
    assert error.value.status_code == 422
