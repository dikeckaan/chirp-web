"""RPC dispatch glue between the JS worker and ``chirp_web.api``.

Single entry point — ``dispatch(method_name, args)`` — invoked from the
worker via ``pyodide.globals.get('_rpc_dispatch')(method, args)``. The
worker handles error propagation; we only ensure return values are in
shapes JavaScript can consume directly.
"""

from __future__ import annotations

from typing import Any

from chirp_web import api


def dispatch(method_name: str, args: Any) -> Any:
    """Call ``api.<method_name>(*args)`` and return the result.

    ``args`` arrives as a Pyodide :class:`JsProxy` wrapping a JS array
    (or an already-converted Python list — both are tolerated). Each
    argument is unwrapped with ``to_py()`` where possible so the called
    API function sees plain Python primitives.
    """
    fn = getattr(api, method_name, None)
    if fn is None:
        raise AttributeError(f"Unknown RPC method: {method_name!r}")

    if hasattr(args, "to_py"):
        py_args = args.to_py()
    else:
        py_args = list(args)

    # `bytes` arguments arrive as JS Uint8Array → Python memoryview after
    # to_py(). Coerce to bytes so downstream code can treat them
    # uniformly.
    norm_args = []
    for a in py_args:
        if isinstance(a, memoryview):
            norm_args.append(bytes(a))
        elif isinstance(a, (bytes, bytearray)):
            norm_args.append(bytes(a))
        else:
            norm_args.append(a)

    return fn(*norm_args)
