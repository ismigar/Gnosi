"""HTTP and filesystem regressions for exact Reader podcast playback."""

import ctypes
import os
import sys
from types import SimpleNamespace

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
import pytest

from backend.domains.reader import podcast_media as media, podcast_routes
from backend.domains.reader import podcast_media_windows as windows
from backend.services import active_vault_middleware as middleware
from backend.services.workspace_service import WorkspaceContext, get_workspace_context


def _url(vault: str, suffix: str) -> str:
    return f"/api/v1/vaults/{vault}/reader/podcast/{suffix}"


@pytest.fixture
def library(tmp_path, monkeypatch):
    vaults = {name: tmp_path / name for name in ("one", "two")}
    for vault in vaults.values():
        (vault / "data" / "podcasts").mkdir(parents=True)

    async def lookup(identifier):
        return (identifier, str(vaults[identifier])) if identifier in vaults else None

    def authorized(request: Request):
        vault = request.headers.get("x-vault-id")
        if request.headers.get("authorization") != "Bearer fixture" or vault not in vaults:
            raise HTTPException(403)
        return WorkspaceContext("test", "listener", "viewer", vaults[vault])

    monkeypatch.setattr(middleware, "_resolve_request_vault_identity", lookup)
    router = APIRouter(prefix="/api/reader")
    podcast_routes.register_routes(router)
    app = FastAPI()
    app.add_middleware(middleware.ActiveVaultMiddleware)
    app.dependency_overrides[get_workspace_context] = authorized
    app.include_router(router)
    with TestClient(app, headers={"authorization": "Bearer fixture"}) as client:
        yield client, {name: vault / "data" / "podcasts" for name, vault in vaults.items()}


def test_newer_episode_leaves_retained_audio_and_its_http_ranges_playable(library):
    client, folders = library
    old = folders["one"] / "daily_podcast_2026_11_22.mp3"
    old.write_bytes(b"first episode")
    info = client.get(_url("one", "info")).json()
    assert info["filename"] == old.name
    pinned = _url("one", f"episodes/{info['episode_id']}")
    assert client.get(pinned).content == b"first episode"

    (folders["one"] / "daily_podcast_2026_11_23.mp3").write_bytes(b"latest episode")
    assert client.get(_url("one", "latest")).content == b"latest episode"
    assert client.get(_url("one", "info")).json()["episode_id"] != info["episode_id"]
    replay = client.get(pinned, headers={"range": "bytes=0-4"})
    assert replay.status_code == 206 and replay.content == b"first"
    assert replay.headers["content-range"] == "bytes 0-4/13"
    assert replay.headers["etag"] == f'"{info["episode_id"]}"'
    assert replay.headers["accept-ranges"] == "bytes"
    assert replay.headers["content-type"] == "audio/mpeg"

    # Even an identical underlying inode in another Vault has a different ID.
    os.link(old, folders["two"] / old.name)
    foreign_id = client.get(_url("two", "info")).json()["episode_id"]
    assert foreign_id != info["episode_id"]
    assert client.get(_url("two", f"episodes/{info['episode_id']}"),
                      headers={"x-vault-id": "one"}).status_code == 404
    assert client.get(pinned, headers={"authorization": "Bearer other"}).status_code == 403
    assert client.get(_url("one", "episodes/not-an-id")).status_code == 422


@pytest.mark.parametrize("atomic", [True, False])
def test_same_name_size_and_modification_time_never_play_replacement_bytes(library, atomic):
    client, folders = library
    target = folders["one"] / "daily_podcast_2026_11_20.mp3"
    target.write_bytes(b"AAA")
    stamp = target.stat().st_mtime_ns
    first = client.get(_url("one", "info")).json()
    old_url = _url("one", f"episodes/{first['episode_id']}")
    changed = folders["one"] / "sync-partial" if atomic else target
    changed.write_bytes(b"BBB")
    os.utime(changed, ns=(stamp, stamp))
    if atomic:
        changed.replace(target)

    replacement = client.get(_url("one", "info")).json()
    assert replacement["filename"] == first["filename"]
    assert replacement["created_at"] == first["created_at"]
    assert replacement["episode_id"] != first["episode_id"]
    expired = client.get(old_url, headers={"range": "bytes=1-1"})
    assert expired.status_code == 404
    new_url = _url("one", f"episodes/{replacement['episode_id']}")
    assert client.get(new_url).content == b"BBB"
    target.unlink()
    assert client.get(new_url).status_code == 404
    assert client.get(_url("one", "info")).json() == {"exists": False}


def test_metadata_skips_audio_content_and_range_reads_are_bounded(library, monkeypatch):
    client, folders = library
    target = folders["one"] / "daily_podcast_2026_11_20.mp3"
    with target.open("wb") as audio:
        audio.write(b"HEAD")
        audio.seek(2 ** 24)
        audio.write(b"TAIL")
    reads = []
    opened = []
    original_windows_open = windows.open_file
    original_open = os.open

    def watch_windows(path, *, read_audio):
        if read_audio:
            opened.append(path.name)
        return original_windows_open(path, read_audio=read_audio)

    def watch_unix(path, *args, **kwargs):
        if str(path).endswith(".mp3"):
            opened.append(str(path))
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(windows, "open_file", watch_windows)
    monkeypatch.setattr(os, "open", watch_unix)
    pinned = _url("one", "episodes/" + client.get(_url("one", "info")).json()["episode_id"])
    assert opened == []
    original_episode = podcast_routes.open_episode

    class Meter:
        def __init__(self, file):
            self.file = file

        def read(self, length):
            reads.append(length)
            return self.file.read(length)

        def __getattr__(self, key):
            return getattr(self.file, key)

    def monitored(*args):
        episode, file = original_episode(*args)
        return episode, Meter(file)

    monkeypatch.setattr(podcast_routes, "open_episode", monitored)
    assert client.get(pinned, headers={"range": "bytes=-4"}).content == b"TAIL"
    multipart = client.get(pinned, headers={"range": "bytes=0-3,16777216-16777219"})
    assert multipart.status_code == 206
    assert multipart.headers["content-type"].startswith("multipart/byteranges")
    assert len(multipart.content) == int(multipart.headers["content-length"])
    assert b"HEAD" in multipart.content and b"TAIL" in multipart.content
    assert client.get(pinned, headers={"range": "bytes=99999999-"}).status_code == 416
    assert reads == [4, 4, 4]


def test_unpublished_files_and_directory_or_leaf_links_are_excluded(library):
    client, folders = library
    directory = folders["one"]
    other = folders["two"] / "daily_podcast_2026_11_20.mp3"
    other.write_bytes(b"private")
    (directory / ".generated").mkdir()
    (directory / ".generated" / "unpublished.mp3").write_bytes(b"cancelled")
    (directory / ".unpublished.mp3").write_bytes(b"hidden")
    (directory / "unfinished.mp3").write_bytes(b"not a published episode")
    (directory / "daily_podcast_2026_11_25.mp3").mkdir()
    assert client.get(_url("one", "info")).json() == {"exists": False}
    try:
        (directory / "daily_podcast_2026_11_26.mp3").symlink_to(other)
    except OSError as error:
        if os.name == "nt":
            pytest.skip(f"Test account lacks symlink privilege: {error}")
        raise
    assert client.get(_url("one", "info")).json() == {"exists": False}
    (directory / "daily_podcast_2026_11_21.mp3").write_bytes(b"self")
    old = client.get(_url("one", "info")).json()["episode_id"]
    directory.rename(directory.with_name("archive"))
    directory.symlink_to(folders["two"], target_is_directory=True)
    assert client.get(_url("one", "info")).json() == {"exists": False}
    assert client.get(_url("one", f"episodes/{old}")).status_code == 404


def test_replacement_after_open_is_never_sent_as_the_previous_revision(library, monkeypatch):
    client, folders = library
    path = folders["one"] / "daily_podcast_2026_11_20.mp3"
    path.write_bytes(b"original")
    pinned = _url("one", "episodes/" + client.get(_url("one", "info")).json()["episode_id"])
    original = podcast_routes.open_episode

    def replace_after_open(*args):
        result = original(*args)
        replacement = path.with_suffix(".stage")
        replacement.write_bytes(b"replaced")
        replacement.replace(path)
        return result

    monkeypatch.setattr(podcast_routes, "open_episode", replace_after_open)
    response = client.get(pinned, headers={"range": "bytes=0-3"})
    assert response.status_code == 404 or (response.status_code == 206 and response.content == b"orig")


def test_stream_discards_a_chunk_changed_during_the_read(tmp_path):
    directory = tmp_path / "vault" / "data" / "podcasts"
    directory.mkdir(parents=True)
    path = directory / "daily_podcast_2026_11_20.mp3"
    path.write_bytes(b"old bytes")
    episode = media.latest_episode(directory)
    current, audio = media.open_episode(directory, episode.episode_id)
    with audio:
        response = media.EpisodeResponse(current, audio)
        response.chunk_size = 3
        chunks = response._chunks([(0, 9)], "", None)
        assert next(chunks) == b"old"
        if os.name == "nt":
            # The native playing handle denies concurrent in-place writes.
            with pytest.raises(PermissionError):
                path.write_bytes(b"new bytes")
            assert b"".join(chunks) == b" bytes"
        else:
            path.write_bytes(b"new bytes")
            with pytest.raises(OSError, match="changed during playback"):
                next(chunks)


def test_windows_metadata_and_read_handles_share_the_verified_revision(tmp_path, monkeypatch):
    directory = tmp_path / "vault" / "data" / "podcasts"
    directory.mkdir(parents=True)
    path = directory / "daily_podcast_2026_11_20.mp3"
    path.write_bytes(b"old")
    requests = []
    stamp = 1

    def open_handle(path, *, read_audio):
        requests.append(read_audio)
        return path.open("rb")

    monkeypatch.setattr(media, "_WINDOWS", True)
    monkeypatch.setattr(windows, "open_file", open_handle)
    monkeypatch.setattr(windows, "change_time", lambda fd: stamp)
    episode = media.latest_episode(directory)
    assert requests == [False]
    found, audio = media.open_episode(directory, episode.episode_id)
    with audio:
        assert found.episode_id == episode.episode_id
        assert audio.read() == b"old"
    assert requests == [False, False, True]
    stamp = 2
    assert media.open_episode(directory, episode.episode_id) is None
    assert requests[-1] is False


@pytest.mark.parametrize("final, expected, matches", [
    (r"\\?\C:\Vault\Data\podcasts\one.mp3", r"c:\vault\data\podcasts\one.mp3", True),
    (r"\\?\UNC\host\library\one.mp3", r"\\HOST\library\one.mp3", True),
    (r"\\?\C:\Other\data\podcasts\one.mp3", r"C:\Vault\data\podcasts\one.mp3", False),
])
def test_windows_final_handle_path_rejects_reparse_escape(final, expected, matches):
    assert windows._same_handle_path(final, expected) is matches


def test_windows_native_handle_validates_target_and_uses_attributes_for_preview(tmp_path, monkeypatch):
    path = tmp_path / "vault" / "data" / "podcasts" / "daily_podcast_2026_11_20.mp3"
    path.parent.mkdir(parents=True)
    path.write_bytes(b"fixture")
    final = str(path)
    opened = []
    closed = []

    class Kernel:
        def CreateFileW(self, name, access, share, _security, _open, flags, _template):
            opened.append((access, share, flags))
            return 7

        def GetFinalPathNameByHandleW(self, handle, output, size, flags):
            if output is None:
                return len(final) + 1
            output.value = final
            return len(final)

        def GetFileInformationByHandleEx(self, handle, info_class, out, size):
            basic = ctypes.cast(out, ctypes.POINTER(windows._FileBasicInfo)).contents
            basic.change_time = 714
            return True

        def CloseHandle(self, handle):
            closed.append(handle)

    monkeypatch.setattr(windows, "_kernel", Kernel)
    monkeypatch.setattr(windows, "sys", SimpleNamespace(platform="win32"))
    monkeypatch.setattr(os, "O_BINARY", getattr(os, "O_BINARY", 0), raising=False)
    monkeypatch.setitem(sys.modules, "msvcrt", SimpleNamespace(
        open_osfhandle=lambda handle, flags: os.open(path, os.O_RDONLY),
        get_osfhandle=lambda fd: 7,
    ))
    with windows.open_file(path, read_audio=False) as attributes:
        assert windows.change_time(attributes.fileno()) == 714
    with windows.open_file(path, read_audio=True) as audio:
        assert audio.read() == b"fixture"
    assert opened == [(0x80, 0x7, 0x00100000), (0x80000000, 0x5, 0)]
    final = str(tmp_path / "outside.mp3")
    with pytest.raises(FileNotFoundError):
        windows.open_file(path, read_audio=True)
    assert closed == [7]


def test_temporarily_unavailable_storage_has_a_retryable_response(library, monkeypatch):
    client, folders = library
    path = folders["one"] / "daily_podcast_2026_11_20.mp3"
    path.write_bytes(b"published")
    episode = client.get(_url("one", "info")).json()
    def unavailable(*_args):
        raise OSError("private provider diagnostics")

    monkeypatch.setattr(podcast_routes, "open_episode", unavailable)
    response = client.get(_url("one", "episodes/" + episode["episode_id"]))
    assert response.status_code == 503
    assert response.json()["detail"] == "Podcast storage is temporarily unavailable"
