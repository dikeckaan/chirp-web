"""RadioSettings ↔ JSON tree codec.

CHIRP's settings hierarchy:

    RadioSettings              # top-level container
      └─ RadioSettingGroup     # nested groups (recursive)
           └─ RadioSetting     # leaf — wraps RadioSettingValue
                └─ RadioSettingValue{Boolean,Integer,List,String,Float,Map}

We emit a JSON tree the UI can render generically:

    { "name": "...", "shortname": "...", "type": "group",
      "children": [ ... ] }

For leaves the type matches the RadioSettingValue subtype name, with
``value`` plus type-specific metadata (range, options, etc.).
"""

from __future__ import annotations

from typing import Any

from chirp import settings as _settings


def settings_to_tree(node) -> dict[str, Any]:
    """Convert a RadioSettings / RadioSettingGroup recursively.

    Failures inside a single child are logged and replaced with a stub
    so the rest of the tree still renders — radios with mostly-blank
    images sometimes have undecodable setting values, and we'd rather
    show 90% of the panel than nothing.
    """
    # RadioSetting must be checked first because it's a RadioSettingGroup
    # subclass (a leaf with multiple values).
    if isinstance(node, _settings.RadioSetting):
        return _encode_setting(node)

    is_root = isinstance(node, _settings.RadioSettings)
    children: list[dict[str, Any]] = []
    for child in node:
        try:
            children.append(settings_to_tree(child))
        except Exception as e:  # noqa: BLE001
            import logging
            logging.getLogger("chirp_web.settings_codec").warning(
                "Failed to encode tree node: %s", e)
            children.append({
                "type": "setting",
                "name": "(unreadable)",
                "shortname": "(unreadable)",
                "values": [{"kind": "unknown", "value": str(e)}],
            })
    return {
        "type": "group",
        "name": "" if is_root else node.get_name(),
        "shortname": "" if is_root else node.get_shortname(),
        "isRoot": is_root,
        "children": children,
    }


def _encode_setting(setting: _settings.RadioSetting) -> dict[str, Any]:
    # A RadioSetting can hold multiple values (rare) — encode as list.
    values = list(setting)
    encoded: list[dict[str, Any]] = []
    for v in values:
        try:
            encoded.append(_encode_value(v))
        except Exception as e:  # noqa: BLE001 — a single broken setting
            # should not poison the whole tree. Log and emit a stub.
            import logging
            logging.getLogger("chirp_web.settings_codec").warning(
                "Failed to encode setting %s: %s", setting.get_name(), e)
            encoded.append({"kind": "unknown", "value": ""})
    return {
        "type": "setting",
        "name": setting.get_name(),
        "shortname": setting.get_shortname(),
        "values": encoded,
    }


def _safe_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _safe_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _encode_value(v) -> dict[str, Any]:
    # `RadioSettingValueBoolean` extends `RadioSettingValueInteger` —
    # check the more specific class first.
    if isinstance(v, _settings.RadioSettingValueBoolean):
        return {"kind": "boolean", "value": bool(v.get_value() or False)}
    # `RadioSettingValueMap` extends `RadioSettingValueList`, so check
    # Map first too.
    if isinstance(v, _settings.RadioSettingValueMap):
        try:
            options = [
                (str(label), val) for (label, val) in (v.get_mem_vals() or [])
            ]
        except Exception:  # noqa: BLE001
            options = []
        return {
            "kind": "map",
            "value": v.get_value(),
            "options": options,
        }
    if isinstance(v, _settings.RadioSettingValueInteger):
        cur = v.get_value()
        return {
            "kind": "integer",
            "value": _safe_int(cur),
            "min": _safe_int(v.get_min(), 0),
            "max": _safe_int(v.get_max(), 0xFFFFFFFF),
            "step": _safe_int(getattr(v, "_step", 1), 1),
        }
    if isinstance(v, _settings.RadioSettingValueFloat):
        return {
            "kind": "float",
            "value": _safe_float(v.get_value()),
            "min": _safe_float(v.get_min(), 0.0),
            "max": _safe_float(v.get_max(), 1e9),
            "resolution": _safe_float(getattr(v, "_resolution", 0.1), 0.1),
        }
    if isinstance(v, _settings.RadioSettingValueList):
        try:
            opts = [str(o) for o in v.get_options()]
        except Exception:  # noqa: BLE001
            opts = []
        return {
            "kind": "list",
            "value": str(v.get_value() or ""),
            "options": opts,
        }
    if isinstance(v, _settings.RadioSettingValueString):
        return {
            "kind": "string",
            "value": str(v.get_value() or ""),
            "maxLength": _safe_int(getattr(v, "_maxlength", 0), 0),
            "minLength": _safe_int(getattr(v, "_minlength", 0), 0),
        }
    return {
        "kind": "unknown",
        "value": str(v.get_value()) if hasattr(v, "get_value") else str(v),
    }


def apply_settings_tree(node, tree: dict[str, Any]) -> None:
    """Inverse of :func:`settings_to_tree` — mutates `node` in place."""
    if tree.get("type") == "group":
        # Walk children by name. CHIRP groups support __getitem__ by name.
        for child_tree in tree.get("children", []):
            try:
                child_node = node[child_tree["name"]]
            except (KeyError, IndexError):
                continue
            apply_settings_tree(child_node, child_tree)
        return

    if tree.get("type") == "setting":
        # `node` here is a RadioSetting — set each value
        values = list(node)
        for i, val_tree in enumerate(tree.get("values", [])):
            if i >= len(values):
                break
            _apply_value(values[i], val_tree)


def _apply_value(rsv, val_tree: dict[str, Any]) -> None:
    kind = val_tree.get("kind")
    new_value = val_tree.get("value")
    if new_value is None:
        return
    try:
        if kind == "boolean":
            rsv.set_value(bool(new_value))
        elif kind == "integer":
            rsv.set_value(int(new_value))
        elif kind == "float":
            rsv.set_value(float(new_value))
        else:
            rsv.set_value(new_value)
    except Exception:  # noqa: BLE001 — CHIRP validation may reject; surface upstream
        pass
