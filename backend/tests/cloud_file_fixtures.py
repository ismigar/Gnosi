"""Simulate one native accessor for tests using real, disposable source files."""

import os
import shutil

from backend.platform.files import snapshots
from backend.utils import metadata_io


def install_coordinated_reader(monkeypatch, download):
    def native(path, info=None, **_):
        return metadata_io.is_cloud_placeholder(path, info or path.stat())

    async def copy(path, handle, timeout):
        if not download(path):
            raise metadata_io.MetadataUnavailable(path=path)
        with path.open("rb") as original:
            shutil.copyfileobj(original, handle)
            return os.fstat(original.fileno())

    monkeypatch.setattr(metadata_io, "is_native_vault_file", native)
    monkeypatch.setattr(snapshots, "copy_coordinated", copy)
