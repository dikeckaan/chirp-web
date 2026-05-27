import { useEffect, useState } from "react";
import { runtime } from "../pyodide/instance";
import type { SettingsTreeNode, SettingsValue } from "../pyodide/types";

interface Props {
  handle: number;
}

export function SettingsEditor({ handle }: Props) {
  const [tree, setTree] = useState<SettingsTreeNode | null>(null);
  const [activeTab, setActiveTab] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setTree(null);
    setDirty(false);
    setError(null);
    (async () => {
      try {
        const t = await runtime.getSettingsTree(handle);
        if (cancelled) return;
        setTree(t);
        const first = t.children?.[0];
        if (first) setActiveTab(first.name || first.shortname || "0");
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handle]);

  if (error) {
    return (
      <div style={{ padding: "1.5rem" }}>
        <p style={{ color: "var(--danger)" }}>{error}</p>
      </div>
    );
  }

  if (!tree) {
    return (
      <div style={{ padding: "1.5rem", color: "var(--fg-muted)" }}>
        <span className="spinner" />
        Ayarlar yükleniyor…
      </div>
    );
  }

  const tabs = tree.children ?? [];
  const active =
    tabs.find((t) => (t.name || t.shortname || "0") === activeTab) ?? tabs[0];

  function onValueChange(
    path: string[],
    valueIndex: number,
    newValue: unknown,
  ) {
    setTree((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev) as SettingsTreeNode;
      const node = navigate(next, path);
      if (node && node.values && node.values[valueIndex]) {
        node.values[valueIndex] = {
          ...node.values[valueIndex],
          value: newValue,
        } as SettingsValue;
      }
      return next;
    });
    setDirty(true);
  }

  async function handleApply() {
    if (!tree) return;
    setApplying(true);
    setError(null);
    try {
      await runtime.applySettings(handle, tree);
      const fresh = await runtime.getSettingsTree(handle);
      setTree(fresh);
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApplying(false);
    }
  }

  async function handleRevert() {
    setApplying(true);
    try {
      const fresh = await runtime.getSettingsTree(handle);
      setTree(fresh);
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="settings-editor">
      <div className="settings-tabs">
        {tabs.map((t) => {
          const key = t.name || t.shortname || "0";
          return (
            <button
              key={key}
              className={"settings-tab" + (active === t ? " active" : "")}
              onClick={() => setActiveTab(key)}
            >
              {t.shortname || t.name || key}
            </button>
          );
        })}
        <span style={{ flex: 1 }} />
        {dirty && (
          <button
            className="btn secondary"
            disabled={applying}
            onClick={handleRevert}
          >
            Geri Al
          </button>
        )}
        <button
          className="btn"
          disabled={!dirty || applying}
          onClick={handleApply}
        >
          {applying ? "Uygulanıyor…" : "Uygula"}
        </button>
      </div>

      <div className="settings-pane">
        {active ? (
          <GroupRenderer
            node={active}
            path={[active.name]}
            onValueChange={onValueChange}
            depth={0}
          />
        ) : (
          <p style={{ color: "var(--fg-muted)" }}>Görüntülenecek ayar yok.</p>
        )}
      </div>
    </div>
  );
}

function navigate(
  root: SettingsTreeNode,
  path: string[],
): SettingsTreeNode | null {
  // First segment is the top-level group's name (e.g. "basic"). Walk
  // children by name to find the target.
  let node: SettingsTreeNode = root;
  for (const segment of path) {
    const child = node.children?.find((c) => c.name === segment);
    if (!child) return null;
    node = child;
  }
  return node;
}

interface GroupRendererProps {
  node: SettingsTreeNode;
  path: string[];
  onValueChange: (path: string[], idx: number, val: unknown) => void;
  depth: number;
}

function GroupRenderer({
  node,
  path,
  onValueChange,
  depth,
}: GroupRendererProps) {
  const Heading = (depth === 0 ? "h2" : depth === 1 ? "h3" : "h4") as
    | "h2"
    | "h3"
    | "h4";

  return (
    <div className="settings-group" data-depth={depth}>
      {depth > 0 && (
        <Heading className="settings-group-title">
          {node.shortname || node.name}
        </Heading>
      )}
      {(node.children ?? []).map((child) => {
        if (child.type === "setting") {
          return (
            <SettingRow
              key={child.name}
              node={child}
              path={[...path, child.name]}
              onValueChange={onValueChange}
            />
          );
        }
        return (
          <GroupRenderer
            key={child.name}
            node={child}
            path={[...path, child.name]}
            onValueChange={onValueChange}
            depth={depth + 1}
          />
        );
      })}
    </div>
  );
}

interface SettingRowProps {
  node: SettingsTreeNode;
  path: string[];
  onValueChange: (path: string[], idx: number, val: unknown) => void;
}

function SettingRow({ node, path, onValueChange }: SettingRowProps) {
  return (
    <div className="settings-row">
      <label className="settings-label">{node.shortname || node.name}</label>
      <div className="settings-values">
        {(node.values ?? []).map((v, idx) => (
          <ValueInput
            key={idx}
            value={v}
            onChange={(nv) => onValueChange(path, idx, nv)}
          />
        ))}
      </div>
    </div>
  );
}

function ValueInput({
  value,
  onChange,
}: {
  value: SettingsValue;
  onChange: (v: unknown) => void;
}) {
  switch (value.kind) {
    case "boolean":
      return (
        <label className="value-bool">
          <input
            type="checkbox"
            checked={value.value}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{value.value ? "Açık" : "Kapalı"}</span>
        </label>
      );
    case "integer":
      return (
        <input
          type="number"
          className="value-input"
          value={value.value}
          min={value.min}
          max={value.max}
          step={value.step || 1}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      );
    case "float":
      return (
        <input
          type="number"
          className="value-input"
          value={value.value}
          min={value.min}
          max={value.max}
          step={value.resolution || 0.1}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      );
    case "list":
      return (
        <select
          className="value-input"
          value={value.value}
          onChange={(e) => onChange(e.target.value)}
        >
          {value.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case "map":
      return (
        <select
          className="value-input"
          value={String(value.value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          {value.options.map(([label, val]) => (
            <option key={String(val)} value={String(val)}>
              {label}
            </option>
          ))}
        </select>
      );
    case "string":
      return (
        <input
          type="text"
          className="value-input"
          value={value.value}
          maxLength={value.maxLength || undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "unknown":
    default:
      return (
        <span style={{ color: "var(--fg-muted)" }}>
          {String((value as { value: unknown }).value)}
        </span>
      );
  }
}
