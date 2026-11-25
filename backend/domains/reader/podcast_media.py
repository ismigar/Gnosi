"""Identify and stream published podcast file revisions within the active Vault."""

from collections.abc import Callable, Iterator
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass
import errno
from hashlib import sha256
import os
import re
from pathlib import Path
from secrets import token_hex
import stat
from typing import BinaryIO

from starlette.concurrency import run_in_threadpool
from starlette.datastructures import Headers
from starlette.responses import (
    FileResponse, MalformedRangeHeader, PlainTextResponse, RangeNotSatisfiable,
    Response, StreamingResponse,
)
from starlette.types import Receive, Scope, Send

from backend.domains.reader import podcast_media_windows as windows


_WINDOWS = os.name == "nt"
_ABSENT = {errno.ENOENT, errno.ENOTDIR, errno.EISDIR, errno.ELOOP}


def _name_id(path: Path) -> str:
    # Includes the Vault directory. The URL never supplies a filesystem path.
    return sha256(os.fsencode(path)).hexdigest()[:32]


@dataclass(frozen=True)
class PodcastEpisode:
    path: Path
    metadata: os.stat_result
    change_time: int

    @property
    def revision(self) -> tuple[int, ...]:
        # Replacement changes file ID; an in-place rewrite changes the filesystem
        # change stamp even when a sync provider preserves size and mtime.
        m = self.metadata
        return (m.st_dev, m.st_ino, m.st_size, m.st_mtime_ns, self.change_time)

    @property
    def episode_id(self) -> str:
        version = sha256(repr(self.revision).encode("ascii")).hexdigest()
        return _name_id(self.path) + version[:32]

    @classmethod
    def from_handle(cls, path: Path, audio: BinaryIO) -> "PodcastEpisode":
        metadata = os.fstat(audio.fileno())
        changed = windows.change_time(audio.fileno()) if _WINDOWS else metadata.st_ctime_ns
        return cls(path, metadata, changed)


@contextmanager
def _publication_directory(directory: Path) -> Iterator[Path | int]:
    # Unix pins every directory below the trusted Vault by descriptor. On
    # Windows, verify the physical target of the actual file handle as well.
    if _WINDOWS:
        expected = directory.parent.parent.resolve(strict=True) / directory.parent.name / directory.name
        if directory.resolve(strict=True) != expected:
            raise FileNotFoundError(errno.ENOENT, "Podcast directory is outside its Vault")
        yield directory
        return
    with ExitStack() as stack:
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY")
        fd = os.open(directory.parent.parent, flags)
        stack.callback(os.close, fd)
        for name in (directory.parent.name, directory.name):
            fd = os.open(name, flags | getattr(os, "O_NOFOLLOW"), dir_fd=fd)
            stack.callback(os.close, fd)
        yield fd


def _published_names(directory: Path | int) -> Iterator[str]:
    return (name for name in os.listdir(directory)
            if re.fullmatch(r"daily_podcast_[0-9]{4}_[0-9]{2}_[0-9]{2}\.mp3", name))


def _inspect(directory: Path | int, path: Path) -> PodcastEpisode | None:
    if isinstance(directory, Path):
        if not stat.S_ISREG(path.lstat().st_mode):
            return None
        with windows.open_file(path, read_audio=False) as attributes:
            episode = PodcastEpisode.from_handle(path, attributes)
    else:
        metadata = os.stat(path.name, dir_fd=directory, follow_symlinks=False)
        episode = PodcastEpisode(path, metadata, metadata.st_ctime_ns)
    return episode if stat.S_ISREG(episode.metadata.st_mode) else None


def latest_episode(directory: Path) -> PodcastEpisode | None:
    """Inspect directory entries and metadata only, including cloud placeholders."""
    try:
        with _publication_directory(directory) as handle:
            for name in sorted(_published_names(handle), reverse=True):
                try:
                    episode = _inspect(handle, directory / name)
                except FileNotFoundError:
                    continue
                if episode:
                    return episode
    except OSError as error:
        if error.errno not in _ABSENT:
            raise
    return None


def find_episode(directory: Path, episode_id: str) -> PodcastEpisode | None:
    """Inspect the requested published revision without opening its audio bytes."""
    try:
        with _publication_directory(directory) as handle:
            for name in _published_names(handle):
                path = directory / name
                if _name_id(path) == episode_id[:32]:
                    episode = _inspect(handle, path)
                    return episode if episode and episode.episode_id == episode_id else None
    except OSError as error:
        if error.errno not in _ABSENT:
            raise
    return None


def open_episode(directory: Path, episode_id: str) -> tuple[PodcastEpisode, BinaryIO] | None:
    """Open only the named published revision, independently of which is latest."""
    try:
        with _publication_directory(directory) as handle:
            for name in _published_names(handle):
                path = directory / name
                if _name_id(path) != episode_id[:32]:
                    continue
                # A stale URL must not hydrate its replacement. Recheck after
                # opening to cover a rename between the two operations.
                episode = _inspect(handle, path)
                if episode is None or episode.episode_id != episode_id:
                    return None
                if isinstance(handle, Path):
                    audio = windows.open_file(path, read_audio=True)
                else:
                    flags = os.O_RDONLY | getattr(os, "O_NONBLOCK") | getattr(os, "O_NOFOLLOW")
                    fd = os.open(name, flags, dir_fd=handle)
                    if not stat.S_ISREG(os.fstat(fd).st_mode):
                        os.close(fd)
                        return None
                    audio = os.fdopen(fd, "rb", buffering=0)
                with ExitStack() as cleanup:
                    cleanup.callback(audio.close)
                    actual = PodcastEpisode.from_handle(path, audio)
                    if stat.S_ISREG(actual.metadata.st_mode) and actual.episode_id == episode_id:
                        cleanup.pop_all()
                        return actual, audio
    except OSError as error:
        if error.errno not in _ABSENT:
            raise
    return None


class EpisodeResponse(FileResponse):
    """Use Starlette's range semantics with a pinned, validated file descriptor."""

    def __init__(self, episode: PodcastEpisode, audio: BinaryIO) -> None:
        super().__init__(episode.path, stat_result=episode.metadata, media_type="audio/mpeg",
                         headers={"etag": f'"{episode.episode_id}"', "cache-control": "private, no-cache"})
        self.audio = audio
        self.episode = episode

    def _chunks(self, ranges: list[tuple[int, int]], boundary: str,
                part_header: Callable[[int, int], bytes] | None) -> Iterator[bytes]:
        for start, end in ranges:
            if part_header:
                yield part_header(start, end)
            self.audio.seek(start)
            while start < end:
                # Read only the requested portion. Revalidate the pinned handle
                # after the read and before handing these bytes to the client.
                content = self.audio.read(min(self.chunk_size, end - start))
                if not content or not self._still_current():
                    raise OSError("Podcast file changed during playback")
                yield content
                start += len(content)
            if part_header:
                yield b"\r\n"
        if boundary:
            yield f"--{boundary}--".encode("ascii")

    def _still_current(self) -> bool:
        return PodcastEpisode.from_handle(self.episode.path, self.audio).revision == self.episode.revision

    def _stream(self, scope: Scope) -> Response:
        if not self._still_current():
            return Response(status_code=404, headers={"cache-control": "no-store"})
        request = Headers(scope=scope)
        headers = dict(self.headers)
        size = self.episode.metadata.st_size
        status = 200
        ranges = [(0, size)]
        boundary = ""
        part_header = None
        requested = request.get("range")
        condition = request.get("if-range")
        if requested and (condition is None or self._should_use_range(condition)):
            try:
                ranges = self._parse_range_header(requested, size)
            except MalformedRangeHeader as error:
                return PlainTextResponse(error.content, status_code=400)
            except RangeNotSatisfiable:
                ranges = []
            if not ranges:
                return Response(status_code=416, headers={"content-range": f"bytes */{size}"})
            status = 206
            if len(ranges) == 1:
                start, end = ranges[0]
                headers["content-range"] = f"bytes {start}-{end - 1}/{size}"
                headers["content-length"] = str(end - start)
            else:
                boundary = token_hex(13)
                length, part_header = self.generate_multipart(ranges, boundary, size, "audio/mpeg")
                headers["content-type"] = f"multipart/byteranges; boundary={boundary}"
                headers["content-length"] = str(length)
        return StreamingResponse(self._chunks(ranges, boundary, part_header), status_code=status, headers=headers)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            try:
                response = await run_in_threadpool(self._stream, scope)
            except OSError:
                response = PlainTextResponse("Podcast storage is temporarily unavailable", status_code=503)
            await response(scope, receive, send)
        finally:
            self.audio.close()
