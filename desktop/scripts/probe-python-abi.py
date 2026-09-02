"""Fail packaging on an unusable or accelerator-contaminated Python stack."""

from __future__ import annotations

from importlib.metadata import distributions
import sys


def main() -> None:
    """Exercise the locked semantic stack and enforce Linux CPU-only Torch."""
    import numpy as np
    import torch
    import transformers

    source = np.array([1.25, 2.5], dtype=np.float32)
    restored = torch.from_numpy(source).numpy()
    if not np.array_equal(restored, source):
        raise RuntimeError("Torch/NumPy round-trip changed values")
    if not transformers.is_torch_available():
        raise RuntimeError(
            "Transformers disabled the locked PyTorch runtime"
        )

    if sys.platform.startswith("linux"):
        if torch.__version__ != "2.13.0+cpu" or torch.version.cuda is not None:
            raise RuntimeError(
                "Linux packaging must use the locked CPU-only Torch 2.13.0 wheel"
            )
        installed = {
            distribution.metadata["Name"].lower()
            for distribution in distributions()
            if distribution.metadata["Name"]
        }
        forbidden = sorted(
            name
            for name in installed
            if name == "triton" or name.startswith(("cuda-", "nvidia-"))
        )
        if forbidden:
            raise RuntimeError(
                "Linux packaging contains GPU-only dependencies: " + ", ".join(forbidden)
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
