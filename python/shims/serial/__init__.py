"""pyserial drop-in shim for Pyodide → WebSerial.

Sync API on top of the JS-side `chirpWebSerial` bridge. CHIRP drivers
call this exactly like upstream `pyserial`; the bridge translates the
calls into async WebSerial operations via SharedArrayBuffer + Atomics.

Only the surface actually used by CHIRP drivers is implemented:

    Properties: port, baudrate, bytesize, parity, stopbits, timeout,
                rtscts, rts, dtr, in_waiting
    Methods:    open, close, read, write, readline, read_until,
                reset_input_buffer, reset_output_buffer, flush,
                setRTS, setDTR, log

The bridge object is exposed as ``js.chirpWebSerial`` from the main
thread. When that global is missing (e.g. unit-test execution outside
the browser) all I/O methods raise :class:`SerialException`.
"""

from __future__ import annotations

from .serialutil import (
    SerialException,
    PARITY_NONE, PARITY_EVEN, PARITY_ODD,
    STOPBITS_ONE, STOPBITS_TWO,
    EIGHTBITS, SEVENBITS,
)

try:
    import js  # type: ignore[import-not-found]
    from pyodide.ffi import to_js  # type: ignore[import-not-found]
    _IN_PYODIDE = True
except ImportError:
    _IN_PYODIDE = False
    js = None  # type: ignore[assignment]

    def to_js(obj, **_):  # type: ignore[misc]
        return obj


_PARITY_MAP = {
    PARITY_NONE: "none",
    PARITY_EVEN: "even",
    PARITY_ODD: "odd",
}

# Sentinel the bridge understands for "block forever". pyserial timeout
# semantics: ``None`` blocks indefinitely, ``0`` is non-blocking (return
# immediately with whatever is buffered), ``>0`` waits that many seconds.
_TIMEOUT_INFINITE_MS = -1


def _timeout_to_ms(timeout):
    """Map a pyserial timeout to the bridge's millisecond encoding.

    ``None`` → -1 (infinite), ``0`` → 0 (non-blocking), ``>0`` → ms.
    """
    if timeout is None:
        return _TIMEOUT_INFINITE_MS
    if timeout <= 0:
        return 0
    return int(timeout * 1000)


def _bridge():
    if not _IN_PYODIDE or not hasattr(js, "chirpWebSerial"):
        raise SerialException(
            "WebSerial bridge unavailable — running outside Pyodide or "
            "before the chirpWebSerial bridge has been installed.")
    return js.chirpWebSerial


class Serial:
    """pyserial.Serial drop-in. Delegates to JS bridge via SAB."""

    def __init__(
        self,
        port=None,
        baudrate=9600,
        bytesize=EIGHTBITS,
        parity=PARITY_NONE,
        stopbits=STOPBITS_ONE,
        timeout=None,
        write_timeout=None,
        rtscts=False,
        dsrdtr=False,
        xonxoff=False,
        **_kwargs,
    ):
        self._port = port
        self._baudrate = baudrate
        self._bytesize = bytesize
        self._parity = parity
        self._stopbits = stopbits
        self._timeout = timeout
        self._write_timeout = write_timeout
        self._rtscts = rtscts
        self._dsrdtr = dsrdtr
        self._xonxoff = xonxoff
        self._rts = True
        self._dtr = True
        self._handle = None
        if port is not None:
            self.open()

    # ------------------------------------------------------------------ props
    @property
    def port(self):
        return self._port

    @port.setter
    def port(self, value):
        self._port = value

    @property
    def baudrate(self):
        return self._baudrate

    @baudrate.setter
    def baudrate(self, value):
        self._baudrate = value
        if self._handle is not None:
            _bridge().reconfigure(self._handle, self._js_opts())

    @property
    def bytesize(self):
        return self._bytesize

    @bytesize.setter
    def bytesize(self, value):
        self._bytesize = value
        if self._handle is not None:
            _bridge().reconfigure(self._handle, self._js_opts())

    @property
    def parity(self):
        return self._parity

    @parity.setter
    def parity(self, value):
        self._parity = value
        if self._handle is not None:
            _bridge().reconfigure(self._handle, self._js_opts())

    @property
    def stopbits(self):
        return self._stopbits

    @stopbits.setter
    def stopbits(self, value):
        self._stopbits = value
        if self._handle is not None:
            _bridge().reconfigure(self._handle, self._js_opts())

    @property
    def timeout(self):
        return self._timeout

    @timeout.setter
    def timeout(self, value):
        self._timeout = value

    @property
    def write_timeout(self):
        return self._write_timeout

    @write_timeout.setter
    def write_timeout(self, value):
        self._write_timeout = value

    @property
    def rtscts(self):
        return self._rtscts

    @rtscts.setter
    def rtscts(self, value):
        self._rtscts = value
        if self._handle is not None:
            _bridge().reconfigure(self._handle, self._js_opts())

    @property
    def rts(self):
        return self._rts

    @rts.setter
    def rts(self, value):
        self._rts = bool(value)
        if self._handle is not None:
            _bridge().setSignals(self._handle, to_js({"rts": self._rts}))

    @property
    def dtr(self):
        return self._dtr

    @dtr.setter
    def dtr(self, value):
        self._dtr = bool(value)
        if self._handle is not None:
            _bridge().setSignals(self._handle, to_js({"dtr": self._dtr}))

    @property
    def in_waiting(self):
        if self._handle is None:
            return 0
        return int(_bridge().inWaiting(self._handle))

    @property
    def is_open(self):
        return self._handle is not None

    # ------------------------------------------------------------------- ops
    def open(self):
        if self._handle is not None:
            return
        try:
            self._handle = _bridge().openSync(self._port, self._js_opts())
        except Exception as exc:  # noqa: BLE001 — re-wrap JS errors
            raise SerialException(f"Failed to open port {self._port!r}: {exc}") from exc

    def close(self):
        if self._handle is None:
            return
        try:
            _bridge().closeSync(self._handle)
        finally:
            self._handle = None

    def read(self, size=1):
        if self._handle is None:
            raise SerialException("Port not open")
        timeout_ms = _timeout_to_ms(self._timeout)
        try:
            buf = _bridge().readSync(self._handle, size, timeout_ms)
        except Exception as exc:  # noqa: BLE001
            raise SerialException(f"Read failed: {exc}") from exc
        if buf is None:
            return b""
        # JsProxy of Uint8Array → bytes
        return bytes(buf.to_py()) if hasattr(buf, "to_py") else bytes(buf)

    def write(self, data):
        if self._handle is None:
            raise SerialException("Port not open")
        if isinstance(data, str):
            data = data.encode()
        try:
            n = _bridge().writeSync(self._handle, to_js(bytes(data)))
        except Exception as exc:  # noqa: BLE001
            raise SerialException(f"Write failed: {exc}") from exc
        return int(n)

    def readline(self, size=-1, eol=b"\n"):
        out = bytearray()
        while True:
            ch = self.read(1)
            if not ch:
                break
            out += ch
            if out.endswith(eol):
                break
            if size > 0 and len(out) >= size:
                break
        return bytes(out)

    def read_until(self, expected=b"\n", size=None):
        out = bytearray()
        elen = len(expected)
        while True:
            ch = self.read(1)
            if not ch:
                break
            out += ch
            if out[-elen:] == expected:
                break
            if size is not None and len(out) >= size:
                break
        return bytes(out)

    def reset_input_buffer(self):
        if self._handle is not None:
            _bridge().resetInputBuffer(self._handle)

    def reset_output_buffer(self):
        if self._handle is not None:
            _bridge().resetOutputBuffer(self._handle)

    def flush(self):
        if self._handle is not None:
            _bridge().flushSync(self._handle)

    def setRTS(self, value):
        self.rts = value

    def setDTR(self, value):
        self.dtr = value

    def log(self, msg):
        # CHIRP's SerialTrace passes log lines here. Forward to the bridge
        # for the optional transcript panel; no-op when bridge missing.
        try:
            _bridge().log(self._handle, str(msg))
        except SerialException:
            pass

    # ----------------------------------------------------------- internals
    def _js_opts(self):
        return to_js({
            "baudRate": self._baudrate,
            "dataBits": self._bytesize,
            "parity": _PARITY_MAP.get(self._parity, "none"),
            "stopBits": 2 if self._stopbits == STOPBITS_TWO else 1,
            "flowControl": "hardware" if self._rtscts else "none",
        })

    # context-manager sugar
    def __enter__(self):
        if self._handle is None and self._port is not None:
            self.open()
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()
        return False


def serial_for_url(url, *args, **kwargs):
    """Stub — CHIRP-Web doesn't expose URL-based ports (socket://, loop://)."""
    raise SerialException(
        "serial_for_url() is not supported in the WebSerial shim. "
        f"Got: {url!r}")
