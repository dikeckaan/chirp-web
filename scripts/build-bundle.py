#!/usr/bin/env python3
"""Build chirp_pkg.tar — the runtime bundle for Pyodide.

The bundle contains:

    chirp/             # vendored CHIRP core + allowlisted drivers
    chirp_web/         # browser-side application code
    shims/             # serial, wx, chirp_platform_stub

It is opened on Pyodide boot (see ``web/src/pyodide/runtime.ts``) into
``/home/pyodide/`` and added to ``sys.path``.

Usage:
    python scripts/build-bundle.py
    python scripts/build-bundle.py --verify        # print bundle inventory

Outputs:
    web/public/chirp-bundle/chirp_pkg.tar
    web/public/chirp-bundle/chirp_pkg.sha256
"""

from __future__ import annotations

import argparse
import hashlib
import io
import logging
import re
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDOR_CHIRP = ROOT / "vendor" / "chirp" / "chirp"
PYTHON_SRC = ROOT / "python"
ALLOWLIST = ROOT / "scripts" / "driver-allowlist.txt"
OUT_TAR = ROOT / "web" / "public" / "chirp-bundle" / "chirp_pkg.tar"
OUT_SHA = ROOT / "web" / "public" / "chirp-bundle" / "chirp_pkg.sha256"

# Top-level chirp/ subtrees that are useless or expensive in the
# browser. Anything under these prefixes is skipped.
EXCLUDE_PREFIXES = (
    "wxui",       # full wxPython app — replaced by web frontend
    "cli",        # chirpc/experttune CLI
    "locale",     # gettext .mo files (i18n MVP-out)
    "share",      # icons, PNGs — frontend owns these
    "stock_configs",  # MVP-out
    "sources",    # Repeaterbook/RadioReference fetch (no requests in MVP)
)

# Files within `chirp/` that drivers transitively need but live outside
# `drivers/`. Always include.
CORE_FILES = {
    "__init__.py",
    "chirp_common.py",
    "directory.py",
    "memmap.py",
    "settings.py",
    "bitwise.py",
    "bitwise_grammar.py",
    "pyPEG.py",
    "util.py",
    "errors.py",
    "logger.py",
    "import_logic.py",
    "icf.py",
    "elib_intl.py",
}

LOG = logging.getLogger("build-bundle")


def load_allowlist() -> list[str]:
    drivers: list[str] = []
    for line in ALLOWLIST.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        drivers.append(line)
    return drivers


def driver_paths(allowlist: list[str]) -> set[Path]:
    """Return concrete .py paths under vendor/chirp/chirp/drivers."""
    out: set[Path] = set()
    drivers_dir = VENDOR_CHIRP / "drivers"
    for name in allowlist:
        candidate = drivers_dir / f"{name}.py"
        if not candidate.exists():
            LOG.warning("Allowlist entry %r has no matching driver file", name)
            continue
        out.add(candidate)
    # Always include the drivers package marker.
    init = drivers_dir / "__init__.py"
    if init.exists():
        out.add(init)
    return out


_IMPORT_RE = re.compile(
    r"^\s*(?:from\s+(chirp(?:\.drivers)?\.[\w_]+)|import\s+(chirp(?:\.drivers)?\.[\w_]+))",
    re.MULTILINE,
)


def expand_driver_deps(paths: set[Path]) -> set[Path]:
    """Walk the full transitive closure of `chirp.drivers.*` imports.

    A single-hop closure misses drivers like `yaesu_clone` that other
    drivers depend on but the allowlist doesn't mention directly. We
    keep iterating until no new files are pulled in.
    """
    drivers_dir = VENDOR_CHIRP / "drivers"
    seen = set(paths)
    frontier = set(paths)
    while frontier:
        new_frontier: set[Path] = set()
        for p in frontier:
            try:
                src = p.read_text(errors="ignore")
            except OSError:
                continue
            for m in _IMPORT_RE.finditer(src):
                ref = m.group(1) or m.group(2)
                if not ref or not ref.startswith("chirp.drivers."):
                    continue
                modname = ref.split(".", 2)[2]
                candidate = drivers_dir / f"{modname}.py"
                if candidate.exists() and candidate not in seen:
                    seen.add(candidate)
                    new_frontier.add(candidate)
        frontier = new_frontier
    return seen


def chirp_files(allowlist: list[str]) -> list[tuple[Path, str]]:
    """Yield (source_path, arcname) for everything we ship under chirp/."""
    out: list[tuple[Path, str]] = []

    # Core .py files at the chirp/ root
    for fname in CORE_FILES:
        p = VENDOR_CHIRP / fname
        if p.exists():
            out.append((p, f"chirp/{fname}"))

    # Also any other .py at top-level we didn't list, EXCEPT excluded
    # subtrees (those are directories, not files).
    for p in VENDOR_CHIRP.iterdir():
        if p.is_file() and p.suffix == ".py":
            arc = f"chirp/{p.name}"
            if not any(arc == d for _, d in out):
                out.append((p, arc))

    # Allowlisted + transitively-needed drivers
    drv_paths = expand_driver_deps(driver_paths(allowlist))
    for p in sorted(drv_paths):
        rel = p.relative_to(VENDOR_CHIRP)
        out.append((p, f"chirp/{rel.as_posix()}"))

    return out


def python_files(subdir: str) -> list[tuple[Path, str]]:
    """Walk python/<subdir> and yield (src, arcname)."""
    base = PYTHON_SRC / subdir
    files: list[tuple[Path, str]] = []
    for p in base.rglob("*"):
        if p.is_file() and p.suffix in {".py", ".txt"}:
            rel = p.relative_to(PYTHON_SRC)
            files.append((p, rel.as_posix()))
    return files


def build(verify: bool = False) -> Path:
    allowlist = load_allowlist()
    LOG.info("Loaded %d drivers from allowlist", len(allowlist))

    entries: list[tuple[Path, str]] = []
    entries.extend(chirp_files(allowlist))
    entries.extend(python_files("shims"))
    entries.extend(python_files("chirp_web"))

    # De-dupe by arcname (last-write-wins — should never collide, but be safe)
    seen: dict[str, Path] = {}
    for src, arc in entries:
        seen[arc] = src

    OUT_TAR.parent.mkdir(parents=True, exist_ok=True)

    # Build deterministic tar (sorted arcnames, fixed mtime 0)
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tf:
        for arc in sorted(seen):
            src = seen[arc]
            info = tarfile.TarInfo(name=arc)
            data = src.read_bytes()
            info.size = len(data)
            info.mtime = 0
            info.mode = 0o644
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            tf.addfile(info, io.BytesIO(data))

    tar_bytes = buf.getvalue()
    OUT_TAR.write_bytes(tar_bytes)
    sha = hashlib.sha256(tar_bytes).hexdigest()
    OUT_SHA.write_text(sha + "\n")

    size_kb = len(tar_bytes) / 1024
    LOG.info("Wrote %s (%d entries, %.1f KB)", OUT_TAR.relative_to(ROOT),
             len(seen), size_kb)
    LOG.info("SHA-256: %s", sha)

    if verify:
        print()
        print(f"Bundle inventory ({len(seen)} entries):")
        for arc in sorted(seen):
            print(f"  {arc}")

    return OUT_TAR


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--verify", action="store_true",
                    help="Print the full file list after building.")
    args = ap.parse_args()

    if not VENDOR_CHIRP.exists():
        LOG.error("vendor/chirp/chirp not found — did you `git submodule update --init`?")
        return 2

    build(verify=args.verify)
    return 0


if __name__ == "__main__":
    sys.exit(main())
