import { useEffect, useState } from "react";
import { runtime } from "../pyodide/instance";
import { errMsg } from "../lib/err";

export interface SerialPortInfo {
  handle: number;
  description: string;
}

interface Props {
  value: number | null;
  onChange: (handle: number | null) => void;
}

export function SerialPortPicker({ value, onChange }: Props) {
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [granting, setGranting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    try {
      const list = runtime.serial.listGrantedPorts();
      setPorts(list);
      // Auto-pick the only port if no selection
      if (value === null && list.length === 1) {
        onChange(list[0].handle);
      }
    } catch (e) {
      setError(errMsg(e));
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRequest() {
    setError(null);
    setGranting(true);
    try {
      const { handle } = await runtime.serial.requestPort();
      refresh();
      onChange(handle);
    } catch (e) {
      const msg = errMsg(e);
      // User cancelled the picker — not an error.
      if (!/cancelled|no port selected/i.test(msg)) {
        setError(msg);
      }
    } finally {
      setGranting(false);
    }
  }

  return (
    <div className="port-picker">
      <label className="settings-label">Seri Port</label>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <select
          className="value-input"
          value={value ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? null : Number(v));
          }}
          disabled={ports.length === 0}
        >
          {ports.length === 0 && <option value="">Hiç port yok</option>}
          {ports.map((p) => (
            <option key={p.handle} value={p.handle}>
              {p.description} (#{p.handle})
            </option>
          ))}
        </select>
        <button
          className="btn secondary"
          onClick={handleRequest}
          disabled={granting}
        >
          {granting ? "İzin bekleniyor…" : "Port Ekle"}
        </button>
      </div>
      {error && (
        <p style={{ color: "var(--danger)", fontSize: "0.8125rem" }}>
          {error}
        </p>
      )}
      <p style={{ color: "var(--fg-muted)", fontSize: "0.75rem" }}>
        "Port Ekle" tarayıcının seri port seçim penceresini açar. Önce
        radyonu USB ile bağla, sonra portu listeden seç.
      </p>
    </div>
  );
}
