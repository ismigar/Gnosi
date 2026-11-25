"""Exercise the real process socket and disposable provider decisions for skill reads."""

import asyncio
import os
import sys
import tempfile
import threading
from contextlib import ExitStack
from pathlib import Path

import pytest

from backend.platform.files import coordinated, skill_worker, snapshots
from backend.platform.files.availability import MetadataUnavailable


pytestmark = pytest.mark.skipif(os.name != "posix", reason="Native descriptor passing")

_HELPER = """
import array, json, os, socket, struct, sys, time
from pathlib import Path

root = Path(__file__).parent
def record(event):
    with (root / "events").open("a") as output:
        output.write(f"{os.getpid()} {event}\\n")

def copy(path, fd):
    record(path.parent.name)
    status = (root / "status").read_text()
    if status == "block":
        time.sleep(30)
    if int(status):
        return int(status), None
    with path.open("rb") as source:
        info = os.fstat(source.fileno())
        os.write(fd, source.read())
    fields = [info.st_mode, info.st_ino, info.st_dev, info.st_nlink, info.st_uid,
              info.st_gid, info.st_size]
    for ns in (info.st_atime_ns, info.st_mtime_ns, info.st_ctime_ns):
        fields.extend(divmod(ns, 10 ** 9))
    return 0, fields + [0, info.st_blocks, info.st_blksize, info.st_rdev, 0, 0, 0]

if sys.argv[1] != "--worker":
    record("cli")
    status, fields = copy(Path(sys.argv[1]), 1)
    if not status:
        sys.stderr.write(json.dumps(fields))
    sys.exit(status)
record("worker")
if (root / "legacy").exists():
    sys.exit(64)
channel = socket.socket(fileno=0)
channel.sendall(b"GNS1")
def exact(size):
    data = bytearray()
    while len(data) < size:
        part = channel.recv(size - len(data))
        if not part:
            raise EOFError()
        data.extend(part)
    return bytes(data)
while True:
    marker, controls, _, _ = channel.recvmsg(1, socket.CMSG_SPACE(4))
    if not marker:
        break
    assert marker == b"R" and len(controls) == 1
    rights = array.array("i")
    rights.frombytes(controls[0][2])
    fd, = rights
    path = Path(os.fsdecode(exact(struct.unpack("!H", exact(2))[0])))
    try:
        response = copy(path, fd)
    finally:
        os.close(fd)
    channel.sendall(json.dumps(response).encode() + b"\\n")
"""


@pytest.fixture
def provider(tmp_path, monkeypatch):
    helper = tmp_path / "helper"
    helper.write_text(f"#!{sys.executable}\n" + _HELPER)
    helper.chmod(0o700)
    (tmp_path / "status").write_text("0")
    (tmp_path / "events").touch()
    pool = skill_worker.SkillWorkers()
    monkeypatch.delenv("GNOSI_FILE_ACCESS_HELPER", raising=False)
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(coordinated, "_bundled_helper", lambda: helper)
    monkeypatch.setattr(coordinated, "_skill_workers", pool)
    monkeypatch.setattr(coordinated, "_shutdown_requested", threading.Event())
    yield helper
    pool.close()


def _source(root, package="user.example"):
    path = root / ".gnosi/agent/skills" / package / "SKILL.md"
    path.parent.mkdir(parents=True)
    path.write_bytes(b"original")
    return path


def _read(path, timeout=3):
    with tempfile.TemporaryFile() as target:
        info = asyncio.run(coordinated.copy_coordinated(path, target, timeout))
        target.seek(0)
        return target.read(), info


def _events(root, kind):
    return [int(pid) for pid, event in (
        line.split() for line in (root / "events").read_text().splitlines()
    ) if event == kind]


def test_single_read_worker_still_reads_after_declining_a_group(provider):
    path = _source(provider.parent)
    info = path.stat()
    expected = {path: (*snapshots.revision(info), getattr(info, "st_flags", 0))}
    assert snapshots.reads.read_skill_sources(expected) == {}
    assert _read(path)[0] == b"original"


@pytest.mark.skipif(sys.platform != "darwin", reason="macOS native contract")
def test_compiled_worker_returns_the_replacement_contents_and_source_inode(tmp_path, monkeypatch):
    monkeypatch.delenv("GNOSI_FILE_ACCESS_HELPER", raising=False)
    helper = coordinated.helper_path()
    if not helper.is_file():
        pytest.skip("Build desktop/scripts/file-access-build.cjs first")
    path = _source(tmp_path.resolve())
    pool = skill_worker.SkillWorkers()
    monkeypatch.setattr(coordinated, "_skill_workers", pool)
    commands = []
    spawn = skill_worker.subprocess.Popen

    def launch(command, **kwargs):
        commands.append(list(command))
        return spawn(command, **kwargs)

    monkeypatch.setattr(skill_worker.subprocess, "Popen", launch)
    try:
        original_inode = path.stat().st_ino
        content, source = _read(path)
        assert content == b"original" and source.st_ino == original_inode
        replacement = path.with_name("replacement")
        replacement.write_bytes(b"modified")
        replacement.replace(path)
        expected = path.stat()
        content, source = _read(path)
        assert expected.st_ino != original_inode and content == b"modified"
        assert (source.st_dev, source.st_ino, source.st_mtime_ns, source.st_ctime_ns) == (
            expected.st_dev, expected.st_ino, expected.st_mtime_ns, expected.st_ctime_ns,
        )
        assert commands == [[str(helper), "--worker"]]
    finally:
        pool.close()


def test_each_read_observes_the_current_grant_on_the_same_resident_revision(provider):
    root = provider.parent
    path = _source(root)
    data, info = _read(path)
    assert data == path.read_bytes()
    assert (info.st_ino, info.st_size, info.st_ctime_ns) == (
        path.stat().st_ino, path.stat().st_size, path.stat().st_ctime_ns,
    )
    for status, reason in [(77, "permission"), (69, "offline"), (73, "no_space"), (75, "pending")]:
        (root / "status").write_text(str(status))
        assert path.stat().st_ctime_ns == info.st_ctime_ns and os.access(path, os.R_OK)
        with pytest.raises(MetadataUnavailable) as error:
            _read(path)
        assert (error.value.reason, error.value.path) == (reason, path)
    (root / "status").write_text("0")
    path.write_bytes(b"replaced")
    assert _read(path)[0] == b"replaced"
    (pid,) = _events(root, "worker")
    assert _events(root, "user.example") == [pid] * 6
    assert not _events(root, "cli")


def test_explicit_helper_receives_each_path_even_when_it_can_delegate_worker_mode(provider, monkeypatch):
    root = provider.parent
    path = _source(root)
    alternate = root / "alternate"
    alternate.symlink_to(provider)
    monkeypatch.setenv("GNOSI_FILE_ACCESS_HELPER", str(alternate))
    assert _read(path)[0] == b"original"
    (root / "status").write_text("77")
    with pytest.raises(MetadataUnavailable) as error:
        _read(path)
    assert error.value.reason == "permission"
    assert len(_events(root, "cli")) == 2
    assert not _events(root, "worker")


def test_old_bundle_falls_back_and_unrelated_files_keep_the_ordinary_cli(provider):
    root = provider.parent
    (root / "legacy").touch()
    assert _read(_source(root))[0] == b"original"
    ordinary = root / "SKILL.md"
    ordinary.write_bytes(b"ordinary")
    assert _read(ordinary)[0] == b"ordinary"
    assert len(_events(root, "worker")) == 1 and len(_events(root, "cli")) == 2


async def _started(root, package):
    async with asyncio.timeout(3):
        while not (observed := _events(root, package)):
            await asyncio.sleep(0.01)
        return observed[-1]


def _reaped(pid):
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)


def test_bound_and_deadline_include_the_queue_and_cancellation_reaps_only_its_child(provider):
    root = provider.parent
    paths = [_source(root, name) for name in ("first", "second", "third", "fourth")]
    (root / "status").write_text("block")

    async def scenario():
        with ExitStack() as stack:
            destinations = [stack.enter_context(tempfile.TemporaryFile()) for _ in paths]
            first, second = [
                asyncio.create_task(coordinated.copy_coordinated(paths[i], destinations[i], 5))
                for i in range(2)
            ]
            first_pid, second_pid = await asyncio.gather(*(_started(root, name) for name in ("first", "second")))
            with pytest.raises(MetadataUnavailable) as queued:
                await coordinated.copy_coordinated(paths[2], destinations[2], 0.1)
            assert queued.value.reason == "pending" and not _events(root, "third")
            assert len(_events(root, "worker")) == 2
            first.cancel()
            with pytest.raises(asyncio.CancelledError):
                await first
            _reaped(first_pid)
            assert not second.done()
            with pytest.raises(MetadataUnavailable) as running:
                await coordinated.copy_coordinated(paths[3], destinations[3], 0.4)
            assert running.value.reason == "pending"
            _reaped(_events(root, "fourth")[0])
            coordinated.cancel_materializations_for_shutdown()
            with pytest.raises(MetadataUnavailable):
                await second
            _reaped(second_pid)
            with pytest.raises(MetadataUnavailable):
                await coordinated.copy_coordinated(paths[2], destinations[2], 1)
            assert not _events(root, "third")

    asyncio.run(scenario())


@pytest.mark.parametrize("finish", ["shutdown", "deadline"])
def test_stop_while_the_new_child_is_being_registered(provider, monkeypatch, finish):
    root = provider.parent
    path = _source(root)
    started, resume = threading.Event(), threading.Event()
    spawn = skill_worker.subprocess.Popen
    children = []

    def delayed(*args, **kwargs):
        child = spawn(*args, **kwargs)
        children.append(child)
        started.set()
        assert resume.wait(3)
        return child

    monkeypatch.setattr(skill_worker.subprocess, "Popen", delayed)

    async def scenario():
        with tempfile.TemporaryFile() as target:
            timeout = 0.2 if finish == "deadline" else 3
            task = asyncio.create_task(coordinated.copy_coordinated(path, target, timeout))
            try:
                assert await asyncio.to_thread(started.wait, 2)
                if finish == "shutdown":
                    coordinated.cancel_materializations_for_shutdown()
                    resume.set()
                with pytest.raises(MetadataUnavailable) as stopped:
                    await asyncio.wait_for(task, 1)
                if finish == "deadline":
                    assert stopped.value.reason == "pending"
            finally:
                resume.set()
            async with asyncio.timeout(2):
                while children[0].returncode is None:
                    await asyncio.sleep(0.01)
            assert not _events(root, "user.example")
            _reaped(children[0].pid)

    asyncio.run(scenario())
