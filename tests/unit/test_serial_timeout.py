"""Unit tests for the pyserial→WebSerial timeout encoding.

pyserial semantics the bridge must honor:
    timeout=None  → block forever  (encoded as -1)
    timeout=0     → non-blocking   (encoded as 0)
    timeout>0     → wait N seconds  (encoded as ms)

Runnable directly (``python3 tests/unit/test_serial_timeout.py``) or via
pytest. Only needs ``python/shims`` on the path — no Pyodide, no chirp.
"""

import os
import sys

_SHIMS = os.path.join(os.path.dirname(__file__), "..", "..", "python", "shims")
sys.path.insert(0, os.path.abspath(_SHIMS))

from serial import _timeout_to_ms  # noqa: E402


def test_none_is_infinite():
    assert _timeout_to_ms(None) == -1


def test_zero_is_nonblocking():
    assert _timeout_to_ms(0) == 0


def test_negative_is_nonblocking():
    # Defensive: any non-positive finite value is treated as non-blocking.
    assert _timeout_to_ms(-0.5) == 0


def test_positive_seconds_to_ms():
    assert _timeout_to_ms(0.25) == 250
    assert _timeout_to_ms(1) == 1000
    assert _timeout_to_ms(2.5) == 2500


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"ok   {name}")
            except AssertionError as e:
                failures += 1
                print(f"FAIL {name}: {e}")
    sys.exit(1 if failures else 0)
