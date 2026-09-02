"""Fail macOS Intel packaging on an unusable semantic Python stack."""

from __future__ import annotations

import platform
import sys


def main() -> None:
    """Exercise the locked NumPy, Torch and Transformers stack on Intel."""
    if sys.platform != "darwin" or platform.machine() != "x86_64":
        print("Python ABI probe skipped: target is not macOS x86_64")
        return

    import numpy as np
    import torch
    import transformers

    source = np.array([1.25, 2.5], dtype=np.float32)
    restored = torch.from_numpy(source).numpy()
    if not np.array_equal(restored, source):
        raise RuntimeError("macOS x86_64 Torch/NumPy round-trip changed values")
    if not transformers.is_torch_available():
        raise RuntimeError(
            "macOS x86_64 Transformers disabled the locked PyTorch runtime"
        )

    from sentence_transformers import SentenceTransformer

    print(
        "Python semantic probe passed: "
        f"NumPy {np.__version__}, Torch {torch.__version__}, "
        f"Transformers {transformers.__version__}, "
        f"SentenceTransformer {SentenceTransformer.__name__}"
    )


if __name__ == "__main__":
    main()
