"""Fail release packaging on the unsupported macOS Intel Torch/NumPy ABI."""

from __future__ import annotations

import platform
import sys


def main() -> None:
    """Round-trip a NumPy array through Torch on the legacy Intel target."""
    if sys.platform != "darwin" or platform.machine() != "x86_64":
        print("Python ABI probe skipped: target is not macOS x86_64")
        return

    import numpy as np
    import torch

    source = np.array([1.25, 2.5], dtype=np.float32)
    restored = torch.from_numpy(source).numpy()
    if not np.array_equal(restored, source):
        raise RuntimeError("macOS x86_64 Torch/NumPy round-trip changed values")
    print(f"Python ABI probe passed: NumPy {np.__version__}, Torch {torch.__version__}")


if __name__ == "__main__":
    main()
