"""Descriptor-bound Darwin content generations without reading cloud bytes."""
from __future__ import annotations

import ctypes
import sys


class _Attributes(ctypes.Structure):
    _fields_ = [('count', ctypes.c_uint16), ('reserved', ctypes.c_uint16),
               ('common', ctypes.c_uint32), ('volume', ctypes.c_uint32),
               ('directory', ctypes.c_uint32), ('file', ctypes.c_uint32),
               ('fork', ctypes.c_uint32)]


def content_generation(descriptor: int) -> int | None:
    """Return only an explicitly supported write-generation count.

    Darwin sys/attr.h: ATTR_CMN_GEN_COUNT requires FSOPT_ATTR_CMN_EXTENDED.
    RETURNED_ATTRS confirms support. Zero is invalid (including mapped files).
    The caller pins/rechecks the file identity; inode numbers alone are not versions.
    """
    if sys.platform != 'darwin':
        return None
    try:
        function = ctypes.CDLL(None, use_errno=True).fgetattrlist
        function.argtypes = [ctypes.c_int, ctypes.POINTER(_Attributes),
                             ctypes.c_void_p, ctypes.c_size_t, ctypes.c_ulong]
        function.restype = ctypes.c_int
        attributes = _Attributes(5, 0, 0x80080000, 0, 0, 0, 0)
        result = (ctypes.c_uint32 * 7)()
        if function(descriptor, ctypes.byref(attributes), result, ctypes.sizeof(result), 0x20):
            return None
        if result[0] != ctypes.sizeof(result) or result[1] != attributes.common:
            return None
        return int(result[6]) or None
    except (AttributeError, OSError, ValueError):
        return None
