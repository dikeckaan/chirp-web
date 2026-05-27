"""Pyodide startup hook for CHIRP-Web.

Order matters: shims must be installed in ``sys.modules`` *before* any
:mod:`chirp` submodule is imported, otherwise driver modules will bind
to the real :mod:`serial` / :mod:`wx` and fail.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

LOG = logging.getLogger("chirp_web.boot")


def _install_shims() -> None:
    """Wire shim packages into sys.modules.

    ``shims/`` is already on ``sys.path`` (see runtime.ts), so importing
    ``serial`` and ``wx`` here picks up the shim copies. We then alias
    ``chirp.platform`` to our stub so driver imports of
    ``chirp.platform.is_ble_serial`` resolve cleanly.
    """
    # Force-import the shim copies. This step is what makes downstream
    # `import serial` inside CHIRP drivers resolve to our shim. The
    # `shims/` directory is on sys.path (see worker.ts), so the names
    # resolve flat without a `shims.` package prefix.
    import serial  # noqa: F401 — alias-installing side effect
    import serial.tools.list_ports  # noqa: F401
    import wx  # noqa: F401

    import chirp_platform_stub as _platform_stub  # ships under shims/
    sys.modules["chirp.platform"] = _platform_stub
    LOG.info("Installed serial, wx, chirp.platform shims")


def _load_drivers(allowlist: list[str] | None = None) -> list[str]:
    """Import every driver module bundled under ``chirp.drivers``.

    The build script already filters which driver source files end up in
    the bundle (see ``scripts/build-bundle.py`` + ``driver-allowlist.txt``),
    so here we just walk whatever made it through.

    Passing ``allowlist`` explicitly still works for tests / debugging.
    """
    import pkgutil
    import importlib
    from chirp import directory, drivers

    if allowlist is not None:
        candidates = list(allowlist)
    else:
        candidates = [
            modname for _finder, modname, _ispkg in pkgutil.iter_modules(drivers.__path__)
        ]

    imported: list[str] = []
    for modname in candidates:
        try:
            importlib.import_module(f"chirp.drivers.{modname}")
            imported.append(modname)
        except Exception:  # noqa: BLE001
            LOG.exception("Failed to import driver %s", modname)

    directory.enable_reregistrations()
    LOG.info("Loaded %d/%d drivers", len(imported), len(candidates))
    return imported


def startup(allowlist: list[str] | None = None) -> dict:
    """Top-level entry — called once from runtime.ts after the bundle is open."""
    logging.basicConfig(level=logging.INFO)
    _install_shims()
    loaded = _load_drivers(allowlist)

    from chirp import chirp_common
    from chirp import directory

    return {
        "version": getattr(chirp_common, "CHIRP_VERSION", "dev"),
        "driversLoaded": loaded,
        "driverCount": len(directory.DRV_TO_RADIO),
    }


# Drivers shipped with the MVP bundle. Kept in lockstep with
# `scripts/driver-allowlist.txt`.
DEFAULT_ALLOWLIST = [
    "fake",
    "generic_csv",
    "baofeng_common",
    "uv5r",
    "baofeng_uv17Pro",
]
