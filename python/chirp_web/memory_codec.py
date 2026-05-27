"""Memory ↔ JSON codec.

Only the fields that the MVP UI cares about. Extra columns (driver-
specific `Memory.extra` settings) are surfaced as a dict so the UI can
render unknown fields generically.
"""

from __future__ import annotations

from typing import Any

from chirp import chirp_common


_SIMPLE_FIELDS = (
    "number", "freq", "name", "rtone", "ctone", "dtcs", "rx_dtcs",
    "tmode", "cross_mode", "dtcs_polarity", "skip", "power",
    "duplex", "offset", "mode", "tuning_step", "comment",
)


def memory_to_dict(mem: chirp_common.Memory) -> dict[str, Any]:
    out: dict[str, Any] = {"empty": bool(getattr(mem, "empty", False))}
    for f in _SIMPLE_FIELDS:
        val = getattr(mem, f, None)
        if isinstance(val, chirp_common.PowerLevel):
            val = str(val)
        out[f] = val

    # Extras — driver-specific RadioSetting list
    extras = []
    extra = getattr(mem, "extra", None)
    if extra:
        for setting in extra:
            try:
                extras.append({
                    "name": setting.get_name(),
                    "shortname": setting.get_shortname(),
                    "value": _value_to_py(setting.value),
                })
            except Exception:  # noqa: BLE001
                continue
    out["extra"] = extras
    return out


def dict_to_memory(d: dict[str, Any], radio: chirp_common.Radio | None = None) -> chirp_common.Memory:
    """Inverse of :func:`memory_to_dict`. Mirrors the same field set."""
    mem = chirp_common.Memory()
    mem.empty = bool(d.get("empty", False))
    for f in _SIMPLE_FIELDS:
        if f not in d or d[f] is None:
            continue
        setattr(mem, f, d[f])

    # Power level — match by string name against the radio's catalog
    if radio is not None and isinstance(d.get("power"), str):
        for level in radio.get_features().valid_power_levels:
            if str(level) == d["power"]:
                mem.power = level
                break

    return mem


def _value_to_py(value) -> Any:
    """Best-effort RadioSettingValue → primitive."""
    try:
        return value.get_value()
    except Exception:  # noqa: BLE001
        return str(value)
