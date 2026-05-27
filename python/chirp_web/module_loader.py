"""Dynamic CHIRP driver module loader.

Port of CHIRP's :func:`chirp.wxui.main.ChirpMain._menu_load_module` logic
(see ``chirp/wxui/main.py:1846``). The browser uploads a ``.py`` file,
we drop it into Pyodide's in-memory FS, then import it via
:mod:`importlib`. Any drivers the module registers become available
through :data:`chirp.directory.DRV_TO_RADIO`.
"""

from __future__ import annotations

import hashlib
import importlib.util
import logging
import os
import sys
import time
from typing import Any

from chirp import directory

LOG = logging.getLogger("chirp_web.module_loader")
LOADED_DIR = "/home/pyodide/loaded"


def load_module(filename: str, source: bytes) -> dict[str, Any]:
    """Load a community driver module.

    Returns a dict describing the newly registered drivers and the
    SHA-256 of the loaded source (for UI display + storage keying).
    """
    directory.enable_reregistrations()
    os.makedirs(LOADED_DIR, exist_ok=True)

    source = bytes(source)
    sha = hashlib.sha256(source).hexdigest()
    fs_path = os.path.join(LOADED_DIR, f"{sha}.py")
    with open(fs_path, "wb") as fp:
        fp.write(source)

    before = set(directory.DRV_TO_RADIO.keys())

    base = os.path.splitext(os.path.basename(filename))[0]
    # Collapse dots so modnames are stable importables
    safe_base = base.replace(".", "_").replace("-", "_")
    modname = f"chirp.loaded.{safe_base}_{sha[:8]}"

    spec = importlib.util.spec_from_file_location(modname, fs_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not build import spec for {filename}")

    module = importlib.util.module_from_spec(spec)
    module._was_loaded = True  # CHIRP convention
    sys.modules[modname] = module
    spec.loader.exec_module(module)

    after = set(directory.DRV_TO_RADIO.keys())
    new_drivers: list[dict[str, str]] = []
    for drv_id in sorted(after - before):
        cls = directory.DRV_TO_RADIO[drv_id]
        try:
            name = cls.get_name() if hasattr(cls, "get_name") else cls.MODEL
        except Exception:  # noqa: BLE001
            name = drv_id
        new_drivers.append({
            "id": drv_id,
            "name": str(name),
            "vendor": getattr(cls, "VENDOR", ""),
            "model": getattr(cls, "MODEL", ""),
        })

    LOG.info("Loaded module %s (%s) → %d new drivers", filename, sha[:12], len(new_drivers))

    return {
        "sha256": sha,
        "modname": modname,
        "filename": filename,
        "loadedAt": int(time.time()),
        "newDrivers": new_drivers,
    }


def unload_module(modname: str) -> None:
    """Best-effort removal — note CHIRP's directory keeps the registered
    class even after the module is gone. Full cleanup would require
    surgery on ``directory.DRV_TO_RADIO``; we defer that to a future
    sprint and just drop ``sys.modules`` here so a fresh upload of the
    same driver succeeds."""
    sys.modules.pop(modname, None)
