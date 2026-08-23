#!/usr/bin/env python3
"""Check that pyproject.toml.ROCM hasn't drifted from pyproject.toml.

The ROCm variant is maintained by hand.  CI's rocm-resolve job proves it still
*resolves*; this proves it still *matches*, apart from the differences that are
deliberate (declared below).  Run it before touching either file:

    uv run --no-project scripts/check_rocm_sync.py

Exits 1 and prints what disagrees.  Needs Python 3.11+ for tomllib.
"""

import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CUDA = ROOT / "pyproject.toml"
ROCM = ROOT / "pyproject.toml.ROCM"

# Packages that are deliberately in one file only.  Anything else that appears
# on one side and not the other is drift.
CUDA_ONLY = {
    # CUDA-only prebuilt wheel; on ROCm the LM backend falls back to SDPA.
    "flash-attn",
}
ROCM_ONLY = {
    # torch+rocm's own dependency; only exists on the rocm wheel index.
    "triton-rocm",
}

# [project] fields that must be identical in both files.
SHARED_FIELDS = ["name", "version", "description", "requires-python"]

_NAME_RE = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)")


def normalize(name):
    """PEP 503 normalized distribution name."""
    return re.sub(r"[-_.]+", "-", name).lower()


def parse_deps(entries):
    """Map normalized package name -> the rest of its PEP 508 requirement."""
    out = {}
    for entry in entries:
        match = _NAME_RE.match(entry)
        if not match:
            sys.exit(f"could not parse requirement: {entry!r}")
        name = normalize(match.group(1))
        # Everything after the name: specifier, URL, and environment marker.
        # Whitespace is normalized so reformatting alone isn't reported as drift.
        rest = " ".join(entry[match.end():].split())
        out[name] = rest
    return out


def compare(what, cuda, rocm, cuda_only, rocm_only, problems):
    """Compare two name -> requirement maps, honoring the expected-diff sets."""
    for name in sorted((set(cuda) - set(rocm)) - cuda_only):
        problems.append(f"{what}: {name!r} is in pyproject.toml but missing from the ROCm variant")
    for name in sorted((set(rocm) - set(cuda)) - rocm_only):
        problems.append(f"{what}: {name!r} is in the ROCm variant but missing from pyproject.toml")
    for name in sorted(cuda_only & set(rocm)):
        problems.append(f"{what}: {name!r} is CUDA-only but appears in the ROCm variant")
    for name in sorted(rocm_only & set(cuda)):
        problems.append(f"{what}: {name!r} is ROCm-only but appears in pyproject.toml")
    for name in sorted((set(cuda) & set(rocm)) - cuda_only - rocm_only):
        if cuda[name] != rocm[name]:
            problems.append(
                f"{what}: {name!r} specifier differs\n"
                f"    pyproject.toml:      {cuda[name] or '(none)'}\n"
                f"    pyproject.toml.ROCM: {rocm[name] or '(none)'}"
            )


def main():
    for path in (CUDA, ROCM):
        if not path.is_file():
            sys.exit(f"missing {path}")

    cuda = tomllib.loads(CUDA.read_text(encoding="utf-8"))
    rocm = tomllib.loads(ROCM.read_text(encoding="utf-8"))
    problems = []

    for field in SHARED_FIELDS:
        a, b = cuda["project"].get(field), rocm["project"].get(field)
        if a != b:
            problems.append(f"[project] {field} differs: {a!r} vs {b!r}")

    if cuda.get("project", {}).get("scripts") != rocm.get("project", {}).get("scripts"):
        problems.append("[project.scripts] differs between the two files")

    compare(
        "dependencies",
        parse_deps(cuda["project"].get("dependencies", [])),
        parse_deps(rocm["project"].get("dependencies", [])),
        {normalize(n) for n in CUDA_ONLY},
        {normalize(n) for n in ROCM_ONLY},
        problems,
    )
    compare(
        "dev group",
        parse_deps(cuda.get("dependency-groups", {}).get("dev", [])),
        parse_deps(rocm.get("dependency-groups", {}).get("dev", [])),
        set(),
        set(),
        problems,
    )

    if problems:
        print("pyproject.toml.ROCM has drifted from pyproject.toml:\n")
        for problem in problems:
            print(f"  - {problem}")
        print(
            "\nMirror the change into pyproject.toml.ROCM, or — if the difference is"
            "\nintentional — add the package to CUDA_ONLY / ROCM_ONLY in this script."
        )
        return 1

    print("pyproject.toml.ROCM is in sync with pyproject.toml")
    return 0


if __name__ == "__main__":
    sys.exit(main())
