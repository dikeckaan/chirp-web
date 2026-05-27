"""Replacement for `chirp.platform` in Pyodide.

The real :mod:`chirp.platform` uses :mod:`subprocess` and host-FS
discovery for things like config directories and BLE detection — none
of which apply (or work) in a browser. Drivers import a handful of
helpers from here; we model just those.
"""

from __future__ import annotations

import os
import tempfile


# Drivers (e.g. baofeng_uv17Pro.py:22) check this before issuing
# BLE-specific clone commands. Web Bluetooth is not in MVP scope.
is_ble_serial = False


class _StubPlatform:
    """Subset of chirp.platform.Platform that CHIRP code touches."""

    def config_file(self, name):
        return os.path.join(tempfile.gettempdir(), name)

    def config_dir(self):
        return tempfile.gettempdir()

    def filter_filename(self, name):
        # Strip path separators and control chars — CHIRP uses this for
        # building safe download filenames.
        bad = "/\\:*?\"<>|\x00"
        return "".join(c for c in name if c not in bad)

    def os_version_string(self):
        return "Pyodide (browser)"

    def get_platform_name(self):
        return "Web"

    def list_serial_ports(self):
        # CHIRP calls list_ports.comports() via the shim already; this
        # legacy entry point delegates to it.
        from serial.tools import list_ports
        return [p.device for p in list_ports.comports()]


_PLATFORM = _StubPlatform()


def get_platform():
    return _PLATFORM
