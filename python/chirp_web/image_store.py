"""Helpers for image-bytes ↔ metadata extraction.

Most heavy lifting lives in CHIRP itself
(:func:`chirp.chirp_common.FileBackedRadio.load_mmap` and friends). This
module just exposes the *metadata blob* without instantiating a full
radio, which is useful for the UI "Recent Files" list.
"""

from __future__ import annotations

import base64
import json
import logging
from typing import Any

from chirp import chirp_common

LOG = logging.getLogger("chirp_web.image_store")

_MAGIC = b"CHIRP"  # see chirp_common.save_mmap


def peek_metadata(data: bytes) -> dict[str, Any] | None:
    """Return the embedded metadata blob from an image, or None."""
    data = bytes(data)
    idx = data.rfind(_MAGIC)
    if idx < 0:
        return None
    try:
        meta_blob = data[idx + len(_MAGIC):].rstrip(b"\x00")
        decoded = base64.b64decode(meta_blob)
        return json.loads(decoded)
    except Exception:  # noqa: BLE001
        LOG.debug("Failed to peek metadata", exc_info=True)
        return None


def guess_radio(data: bytes) -> str | None:
    """Best-effort driver id for an image. Uses CHIRP's own matcher."""
    import os
    import tempfile

    fd, path = tempfile.mkstemp(suffix=".img")
    os.close(fd)
    try:
        with open(path, "wb") as fp:
            fp.write(bytes(data))
        from chirp import directory
        cls = directory.get_radio_by_image(path)
        if cls is None:
            return None
        return getattr(cls, "_DRV_KEY", cls.__name__)
    except Exception:  # noqa: BLE001
        return None
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


__all__ = ["peek_metadata", "guess_radio"]
