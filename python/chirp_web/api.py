"""JS ↔ Python façade for CHIRP-Web.

Functions here are designed to be called from JavaScript via
``pyodide.runPythonAsync('from chirp_web.api import …')`` or by binding
to ``globalThis``. They return plain dicts / lists / bytes so JS can
consume them without dealing with Python objects.
"""

from __future__ import annotations

import io
import logging
from typing import Any

from chirp import chirp_common, directory, memmap

from chirp_web.memory_codec import memory_to_dict, dict_to_memory
from chirp_web.settings_codec import settings_to_tree, apply_settings_tree
from chirp_web import module_loader as _module_loader

LOG = logging.getLogger("chirp_web.api")

# Handle table — JS holds opaque integer handles instead of radio refs.
_RADIO_HANDLES: dict[int, chirp_common.Radio] = {}
_NEXT_HANDLE = 1


def _store(radio: chirp_common.Radio) -> int:
    global _NEXT_HANDLE
    h = _NEXT_HANDLE
    _NEXT_HANDLE += 1
    _RADIO_HANDLES[h] = radio
    return h


def _get(handle: int) -> chirp_common.Radio:
    if handle not in _RADIO_HANDLES:
        raise KeyError(f"Unknown radio handle: {handle}")
    return _RADIO_HANDLES[handle]


# ------------------------------------------------------------- drivers
def list_drivers() -> list[dict[str, str]]:
    """All registered driver classes.

    ``supportsNew`` tells the UI whether ``new_radio()`` can synthesize
    a blank image without a real dump. CHIRP only supports that for
    drivers that declare a static ``_memsize`` (and for live radios,
    which manage their own state).
    """
    out = []
    for drv_id, cls in sorted(directory.DRV_TO_RADIO.items()):
        try:
            name = cls.get_name() if hasattr(cls, "get_name") else cls.MODEL
        except Exception:  # noqa: BLE001
            name = drv_id
        is_live = issubclass(cls, chirp_common.LiveRadio)
        is_clone = issubclass(cls, chirp_common.CloneModeRadio)
        memsize = getattr(cls, "_memsize", 0)
        supports_new = is_live or (is_clone and memsize > 0)
        out.append({
            "id": drv_id,
            "name": str(name),
            "vendor": getattr(cls, "VENDOR", ""),
            "model": getattr(cls, "MODEL", ""),
            "variant": getattr(cls, "VARIANT", ""),
            "isLive": is_live,
            "isClone": is_clone,
            "supportsNew": supports_new,
            "memsize": memsize,
        })
    return out


# --------------------------------------------------------------- image
def open_image_bytes(data: bytes, filename: str = "radio.img") -> dict[str, Any]:
    """Open an image file. Auto-detects the radio model from CHIRP metadata."""
    # `get_radio_by_image` needs the bytes on disk; in Pyodide we write to
    # the in-memory FS at /tmp, detect, construct, then clean up — the
    # radio loads the whole image into its mmap at construction.
    import os
    import tempfile

    fd, path = tempfile.mkstemp(suffix=".img")
    os.close(fd)
    try:
        with open(path, "wb") as fp:
            fp.write(bytes(data))
        radio_cls = directory.get_radio_by_image(path)
        radio = radio_cls(path)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
    handle = _store(radio)
    return _describe(handle)


def save_image_bytes(handle: int) -> bytes:
    """Serialize the radio image to bytes (including CHIRP metadata blob)."""
    radio = _get(handle)
    if not isinstance(radio, chirp_common.FileBackedRadio):
        raise TypeError("This radio is not file-backed (live radio)")
    import os
    import tempfile

    fd, path = tempfile.mkstemp(suffix=".img")
    os.close(fd)
    try:
        radio.save_mmap(path)
        with open(path, "rb") as fp:
            return fp.read()
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def new_radio(driver_id: str) -> dict[str, Any]:
    """Create a fresh radio instance of the given driver (empty memory).

    Clone-mode drivers need a pre-allocated mmap of the declared
    ``_memsize``. Drivers that compute their size dynamically from a
    dump (e.g. baofeng_uv17Pro) cannot be created blank — the caller
    must open an existing image or download from the radio first.
    """
    cls = directory.DRV_TO_RADIO[driver_id]
    if issubclass(cls, chirp_common.CloneModeRadio):
        memsize = getattr(cls, "_memsize", 0)
        if not memsize:
            raise ValueError(
                f"{getattr(cls, 'MODEL', cls.__name__)} sürücüsü için boş "
                "image oluşturulamaz: bu sürücü bellek boyutunu radyo "
                "dump'ından öğreniyor. Önce bir .img dosyası aç veya "
                "radyodan download yap.")
        mmap_buf = memmap.MemoryMapBytes(b"\xff" * memsize)
        radio = cls(mmap_buf)
    else:
        radio = cls(None)
    handle = _store(radio)
    return _describe(handle)


def close_radio(handle: int) -> None:
    _RADIO_HANDLES.pop(handle, None)


def _describe(handle: int) -> dict[str, Any]:
    radio = _get(handle)
    feat: chirp_common.RadioFeatures = radio.get_features()
    return {
        "handle": handle,
        "vendor": getattr(radio, "VENDOR", ""),
        "model": getattr(radio, "MODEL", ""),
        "variant": getattr(radio, "VARIANT", ""),
        "memoryBounds": list(feat.memory_bounds),
        "hasSettings": feat.has_settings,
        "hasBank": feat.has_bank,
        "hasName": feat.has_name,
        "isClone": isinstance(radio, chirp_common.CloneModeRadio),
        "isLive": isinstance(radio, chirp_common.LiveRadio),
        "validModes": list(feat.valid_modes),
        "validTmodes": list(feat.valid_tmodes),
        "validDuplexes": list(feat.valid_duplexes),
        "validPowerLevels": [str(p) for p in feat.valid_power_levels],
        "validTuningSteps": list(feat.valid_tuning_steps),
        "validBands": [list(b) for b in feat.valid_bands],
    }


# -------------------------------------------------------------- memory
def get_memory(handle: int, number: int) -> dict[str, Any]:
    radio = _get(handle)
    mem = radio.get_memory(number)
    return memory_to_dict(mem)


def get_memory_range(handle: int, start: int, end: int) -> list[dict[str, Any]]:
    radio = _get(handle)
    out = []
    for n in range(start, end + 1):
        try:
            mem = radio.get_memory(n)
        except Exception as e:  # noqa: BLE001
            # Empty slot or driver-side InvalidValueError — surface the
            # row anyway so the UI can still render an editable line.
            LOG.debug("get_memory(%d) failed (%s); using placeholder", n, e)
            mem = chirp_common.Memory()
            mem.number = n
            mem.empty = True
        out.append(memory_to_dict(mem))
    return out


def set_memory(handle: int, mem_dict: dict[str, Any]) -> list[str]:
    """Apply a memory dict. Returns any validation messages."""
    radio = _get(handle)
    mem = dict_to_memory(mem_dict, radio)
    messages = radio.validate_memory(mem)
    if messages:
        return [str(m) for m in messages]
    radio.set_memory(mem)
    return []


def erase_memory(handle: int, number: int) -> None:
    radio = _get(handle)
    radio.erase_memory(number)


# -------------------------------------------------------------- settings
def get_settings_tree(handle: int) -> dict[str, Any]:
    radio = _get(handle)
    if not radio.get_features().has_settings:
        return {"groups": []}
    settings = radio.get_settings()
    return settings_to_tree(settings)


def apply_settings(handle: int, tree: dict[str, Any]) -> list[str]:
    """Apply a settings tree. Returns labels of settings that failed."""
    radio = _get(handle)
    current = radio.get_settings()
    failures = apply_settings_tree(current, tree)
    radio.set_settings(current)
    return failures


# ----------------------------------------------------------------- clone
def _open_pipe(rclass, port_handle: int) -> Any:
    """Open the WebSerial shim with the driver's expected parameters."""
    import serial

    pipe = serial.Serial()
    pipe.port = port_handle
    pipe.baudrate = getattr(rclass, "BAUD_RATE", 9600)
    pipe.timeout = 0.25
    pipe.rtscts = getattr(rclass, "HARDWARE_FLOW", False)
    pipe.rts = getattr(rclass, "WANTS_RTS", False)
    pipe.dtr = getattr(rclass, "WANTS_DTR", False)
    pipe.open()
    # Defensive: discard any stale bytes left over from a previous
    # session (e.g. clone-exit messages from the radio firmware).
    try:
        pipe.reset_input_buffer()
    except Exception:  # noqa: BLE001
        pass
    return pipe


def _wrap_status(status_callback) -> Any:
    """Return a unary fn matching CHIRP's `Radio.status_fn(status)`."""
    if status_callback is None:
        return None

    def _fn(status):
        try:
            status_callback(
                int(getattr(status, "cur", 0) or 0),
                int(getattr(status, "max", 0) or 0),
                str(getattr(status, "msg", "") or ""),
            )
        except Exception:  # noqa: BLE001
            LOG.debug("status_fn callback raised", exc_info=True)

    return _fn


def clone_in(driver_id: str, port_handle: int,
             status_callback=None) -> dict[str, Any]:
    """Download an image from a connected radio via the WebSerial port.

    `port_handle` is the integer the bridge handed us via
    `getGrantedPorts()`. `status_callback` is a JS function called as
    `(cur, max, msg)` for progress updates.
    """
    cls = directory.DRV_TO_RADIO[driver_id]
    if not issubclass(cls, chirp_common.CloneModeRadio):
        raise TypeError(f"{driver_id} klon-modu sürücüsü değil")

    radio = cls(None)
    LOG.info("clone_in: opening pipe for %s on port=%s", driver_id, port_handle)
    pipe = _open_pipe(cls, port_handle)
    try:
        radio.set_pipe(pipe)
        cb = _wrap_status(status_callback)
        if cb is not None:
            radio.status_fn = cb  # shadow the method
        LOG.info("clone_in: starting sync_in")
        radio.sync_in()
        LOG.info("clone_in: sync_in returned")
        # Drivers don't always emit a final tick — give the UI a clear
        # 100% so it can flip back to the workspace.
        if status_callback is not None:
            try:
                status_callback(100, 100, "Tamamlandı")
            except Exception:  # noqa: BLE001
                pass
    finally:
        try:
            LOG.info("clone_in: closing pipe")
            pipe.close()
            LOG.info("clone_in: pipe closed")
        except Exception:  # noqa: BLE001
            LOG.warning("Failed to close pipe cleanly", exc_info=True)

    handle = _store(radio)
    return _describe(handle)


def clone_out(handle: int, port_handle: int, status_callback=None) -> None:
    """Upload an in-memory image to a connected radio."""
    radio = _get(handle)
    if not isinstance(radio, chirp_common.CloneModeRadio):
        raise TypeError("Klon-modu olmayan bir radyo upload edilemez")

    rclass = type(radio)
    LOG.info("clone_out: opening pipe for %s on port=%s", rclass.__name__, port_handle)
    pipe = _open_pipe(rclass, port_handle)
    try:
        radio.set_pipe(pipe)
        cb = _wrap_status(status_callback)
        if cb is not None:
            radio.status_fn = cb
        LOG.info("clone_out: starting sync_out")
        radio.sync_out()
        LOG.info("clone_out: sync_out returned")
        if status_callback is not None:
            try:
                status_callback(100, 100, "Tamamlandı")
            except Exception:  # noqa: BLE001
                pass
    finally:
        try:
            LOG.info("clone_out: closing pipe")
            pipe.close()
            LOG.info("clone_out: pipe closed")
        except Exception:  # noqa: BLE001
            LOG.warning("Failed to close pipe cleanly", exc_info=True)


# Port grant and listing happen on the main thread (Web Serial UI
# restriction). The frontend talks to `WebSerialBridge` directly for
# those; only `clone_in`/`clone_out` need a Python-side entry point.


# ----------------------------------------------------------------- modules
def load_module(filename: str, source: bytes) -> dict[str, Any]:
    """Load a community .py driver module into Pyodide.

    Thin wrapper around `chirp_web.module_loader.load_module` so the
    RPC dispatcher (which looks up methods on this module) can find it.
    """
    return _module_loader.load_module(filename, source)


def unload_module(modname: str) -> None:
    _module_loader.unload_module(modname)


# --------------------------------------------------------------- CSV I/O
def export_csv(handle: int) -> bytes:
    """Export the open radio's memories as a generic CSV file.

    Mirrors CHIRP's `_menu_export` flow: copy every non-empty memory
    through `import_logic.import_mem` into a fresh `CSVRadio` so the
    output uses the canonical CHIRP CSV column set.
    """
    import os
    import tempfile
    from chirp.drivers import generic_csv
    from chirp import import_logic

    src_radio = _get(handle)
    src_features = src_radio.get_features()
    start, end = src_features.memory_bounds

    csv_radio = generic_csv.CSVRadio(None)
    for n in range(start, end + 1):
        try:
            mem = src_radio.get_memory(n)
        except Exception:  # noqa: BLE001 — skip unreadable slots
            continue
        if getattr(mem, "empty", False):
            continue
        try:
            imported = import_logic.import_mem(csv_radio, src_features, mem)
            csv_radio.set_memory(imported)
        except Exception as e:  # noqa: BLE001
            LOG.warning("export_csv: skipping memory %s: %s", n, e)

    fd, path = tempfile.mkstemp(suffix=".csv")
    os.close(fd)
    try:
        csv_radio.save_mmap(path)
        with open(path, "rb") as fp:
            return fp.read()
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def import_csv(handle: int, data: bytes) -> dict[str, Any]:
    """Import CSV memories into the currently-open radio.

    Returns a dict with `imported`, `skipped`, and `warnings`.
    """
    import os
    import tempfile
    from chirp.drivers import generic_csv
    from chirp import import_logic

    target_radio = _get(handle)
    target_features = target_radio.get_features()
    target_start, target_end = target_features.memory_bounds

    fd, path = tempfile.mkstemp(suffix=".csv")
    os.close(fd)
    imported = 0
    skipped = 0
    warnings: list[str] = []
    try:
        with open(path, "wb") as fp:
            fp.write(bytes(data))
        csv_radio = generic_csv.CSVRadio(path)
        src_features = csv_radio.get_features()
        start, end = src_features.memory_bounds

        for n in range(start, end + 1):
            try:
                mem = csv_radio.get_memory(n)
            except Exception:  # noqa: BLE001
                continue
            if getattr(mem, "empty", False):
                continue
            try:
                converted = import_logic.import_mem(
                    target_radio, src_features, mem,
                )
            except Exception as e:  # noqa: BLE001
                warnings.append(f"Kanal {n}: {e}")
                skipped += 1
                continue
            if converted.number < target_start or converted.number > target_end:
                warnings.append(
                    f"Kanal {converted.number}: hedef radyo aralık "
                    f"dışı ({target_start}-{target_end})")
                skipped += 1
                continue
            try:
                target_radio.set_memory(converted)
                imported += 1
            except Exception as e:  # noqa: BLE001
                warnings.append(f"Kanal {converted.number}: {e}")
                skipped += 1
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass

    return {
        "imported": imported,
        "skipped": skipped,
        "warnings": warnings,
    }
