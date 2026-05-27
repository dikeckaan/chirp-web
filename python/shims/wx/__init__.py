"""wx stub for CHIRP-Web.

CHIRP drivers occasionally `import wx` to surface user-facing warnings
via :func:`wx.MessageBox`. In the browser we forward those messages to
the JS bridge, which renders them as native modal dialogs.

Only the constants and APIs that actually appear in driver code are
modeled. Anything else raises :class:`AttributeError`, which surfaces
fast during driver loading.
"""

from __future__ import annotations

try:
    import js  # type: ignore[import-not-found]
    _IN_PYODIDE = True
except ImportError:
    _IN_PYODIDE = False
    js = None  # type: ignore[assignment]


# --- style flags (wx.OK | wx.CANCEL | wx.ICON_WARNING) -------------
OK = 0x0004
CANCEL = 0x0010
YES_NO = 0x0008
YES = 0x0002
NO = 0x0080
CANCEL_DEFAULT = 0x80000000
OK_DEFAULT = 0x00000000
ICON_INFORMATION = 0x00000800
ICON_WARNING = 0x00000200
ICON_ERROR = 0x00000100
ICON_QUESTION = 0x00000400

# --- return values -------------------------------------------------
ID_OK = 5100
ID_CANCEL = 5101
ID_YES = 5103
ID_NO = 5104


def MessageBox(message, caption="Message", style=OK, parent=None):  # noqa: N802 — wx API
    """Display a modal in the browser. Returns ID_OK / ID_CANCEL."""
    if not _IN_PYODIDE or not hasattr(js, "chirpWebUI"):
        # Test / headless context — default to OK so drivers continue.
        return ID_OK
    try:
        result = js.chirpWebUI.messageBoxSync(str(message), str(caption), int(style))
        return int(result) if result is not None else ID_OK
    except Exception:  # noqa: BLE001
        return ID_OK


# Some drivers call wx.LogMessage / wx.LogWarning. No-op them.
def LogMessage(msg):  # noqa: N802
    pass


def LogWarning(msg):  # noqa: N802
    pass


def LogError(msg):  # noqa: N802
    pass
