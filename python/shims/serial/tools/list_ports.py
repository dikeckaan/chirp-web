"""serial.tools.list_ports drop-in for WebSerial.

`comports()` returns the set of ports the user has already granted via
`navigator.serial.requestPort()`. The JS bridge surfaces each port as a
dict-like object with at least `handle`, `device`, and `description`
fields.
"""

from __future__ import annotations

try:
    import js  # type: ignore[import-not-found]
    _IN_PYODIDE = True
except ImportError:
    _IN_PYODIDE = False
    js = None  # type: ignore[assignment]


class ListPortInfo:
    """Minimal pyserial ListPortInfo replacement."""

    def __init__(self, device, description="n/a", manufacturer=None,
                 vid=None, pid=None, serial_number=None, hwid=None):
        self.device = device
        self.description = description or "n/a"
        self.manufacturer = manufacturer
        self.vid = vid
        self.pid = pid
        self.serial_number = serial_number
        self.hwid = hwid or "n/a"
        # Some CHIRP UI code expects `name` attribute
        self.name = description or device

    def __iter__(self):
        # pyserial returns 3-tuples in legacy callers
        yield self.device
        yield self.description
        yield self.hwid

    def __repr__(self):
        return f"<ListPortInfo device={self.device!r} desc={self.description!r}>"


def comports(include_links=False):  # noqa: ARG001 — signature compat
    if not _IN_PYODIDE or not hasattr(js, "chirpWebSerial"):
        return []
    try:
        granted = js.chirpWebSerial.getGrantedPorts().to_py()
    except Exception:  # noqa: BLE001
        return []
    return [
        ListPortInfo(
            device=p.get("handle"),
            description=p.get("description", "WebSerial Port"),
            manufacturer=p.get("manufacturer"),
            vid=p.get("vid"),
            pid=p.get("pid"),
            serial_number=p.get("serialNumber"),
            hwid=p.get("hwid"),
        )
        for p in granted
    ]


def grep(regexp, include_links=False):  # noqa: ARG001
    import re as _re
    pat = _re.compile(regexp, _re.I)
    for port in comports():
        if pat.search(port.device) or pat.search(port.description):
            yield port
