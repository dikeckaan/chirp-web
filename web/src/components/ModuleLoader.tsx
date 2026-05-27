import { useEffect, useRef, useState } from "react";
import { runtime } from "../pyodide/instance";
import { useAppStore } from "../state/store";
import {
  listModules,
  saveModule,
  deleteModule,
  loadModuleBytes,
} from "../storage/module-store";
import type { StoredModule } from "../storage/indexeddb";

interface Props {
  onClose: () => void;
}

type LoadResult = Awaited<ReturnType<typeof runtime.loadModule>>;

export function ModuleLoader({ onClose }: Props) {
  const setDrivers = useAppStore((s) => s.setDrivers);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState<string>("");
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [source, setSource] = useState<string>("");
  const [sha, setSha] = useState<string>("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recents, setRecents] = useState<StoredModule[]>([]);

  useEffect(() => {
    listModules().then(setRecents);
  }, []);

  async function pickFile(file: File) {
    setError(null);
    const buf = new Uint8Array(await file.arrayBuffer());
    setBytes(buf);
    setFilename(file.name);
    const text = new TextDecoder().decode(buf);
    // Cap preview at 64 KB for huge modules — f4hwn is ~136 KB.
    setSource(text.length > 64 * 1024 ? text.slice(0, 64 * 1024) + "\n…(devamı kesildi)…" : text);
    const hash = await sha256Hex(buf);
    setSha(hash);
    setAcknowledged(false);
  }

  async function handleLoad(useBytes: Uint8Array, useFilename: string) {
    setLoading(true);
    setError(null);
    try {
      const result: LoadResult = await runtime.loadModule(
        useFilename,
        useBytes,
      );
      await saveModule(useFilename, useBytes, result.sha256, result.newDrivers);
      // Refresh global driver list so dropdowns pick up the new ones.
      const fresh = await runtime.listDrivers();
      setDrivers(fresh);
      setRecents(await listModules());
      // Reset form so the user can load another.
      setBytes(null);
      setSource("");
      setSha("");
      setFilename("");
      setAcknowledged(false);
      alert(
        `Yüklendi: ${result.newDrivers.length} yeni sürücü\n` +
          result.newDrivers.map((d) => `• ${d.name}`).join("\n"),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleReloadRecent(r: StoredModule) {
    const data = await loadModuleBytes(r.sha256);
    if (!data) {
      setError("Modül cache'de yok.");
      return;
    }
    await handleLoad(data, r.filename);
  }

  async function handleDeleteRecent(r: StoredModule) {
    if (!confirm(`'${r.filename}' modülü kaldırılsın mı?`)) return;
    await deleteModule(r.sha256);
    setRecents(await listModules());
  }

  return (
    <div className="modal-backdrop" onClick={() => !loading && onClose()}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{ maxWidth: 720 }}
      >
        <h2 style={{ marginTop: 0 }}>Topluluk Modülü Yükle</h2>

        <p
          style={{
            color: "var(--fg-muted)",
            fontSize: "0.8125rem",
            margin: "0 0 1rem 0",
          }}
        >
          .py modülleri Pyodide sandbox'ı içinde çalışır — disk veya ağına
          erişimleri yok. Ancak <strong>seri portuna bağlı radyona istediği
          byte'ı yazabilirler</strong>. Sadece güvendiğin kaynaklardan
          (CHIRP forumu, GitHub) yükle.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".py,.mod,text/x-python"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) pickFile(f);
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
        />

        {!bytes && (
          <button
            className="btn"
            onClick={() => fileInputRef.current?.click()}
          >
            .py dosyası seç
          </button>
        )}

        {bytes && (
          <>
            <div className="form-row">
              <label className="settings-label">Dosya</label>
              <div className="value-input" style={{ background: "transparent" }}>
                {filename} ({bytes.byteLength.toLocaleString()} byte)
              </div>
            </div>

            <div className="form-row">
              <label className="settings-label">SHA-256</label>
              <code
                style={{
                  fontSize: "0.75rem",
                  wordBreak: "break-all",
                  color: "var(--fg-muted)",
                }}
              >
                {sha}
              </code>
            </div>

            <details
              style={{
                marginBottom: "0.75rem",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "0.5rem 0.75rem",
              }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  fontSize: "0.8125rem",
                  color: "var(--fg-muted)",
                }}
              >
                Kaynağı görüntüle
              </summary>
              <pre
                style={{
                  maxHeight: 240,
                  overflow: "auto",
                  fontSize: "0.75rem",
                  marginTop: "0.5rem",
                }}
              >
                {source}
              </pre>
            </details>

            <label
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "flex-start",
                fontSize: "0.8125rem",
                marginBottom: "0.75rem",
              }}
            >
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              <span>
                Bu modülün kaynağına güveniyorum ve radyoya yazabilme
                yetkisi olabileceğini biliyorum.
              </span>
            </label>

            {error && (
              <p style={{ color: "var(--danger)", fontSize: "0.8125rem" }}>
                {error}
              </p>
            )}

            <div className="modal-actions">
              <button
                className="btn secondary"
                onClick={() => {
                  setBytes(null);
                  setSource("");
                  setSha("");
                  setFilename("");
                  setAcknowledged(false);
                }}
                disabled={loading}
              >
                Başka Dosya
              </button>
              <button
                className="btn"
                onClick={() => bytes && handleLoad(bytes, filename)}
                disabled={!acknowledged || loading}
              >
                {loading ? "Yükleniyor…" : "Yükle"}
              </button>
            </div>
          </>
        )}

        {recents.length > 0 && (
          <div style={{ marginTop: "1.5rem" }}>
            <h3 style={{ fontSize: "0.875rem", margin: "0 0 0.5rem 0" }}>
              Önceden Yüklenenler
            </h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {recents.map((r) => (
                <li
                  key={r.sha256}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.4rem 0",
                    borderBottom: "1px solid var(--border)",
                    fontSize: "0.8125rem",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {r.filename}
                    </div>
                    <div style={{ color: "var(--fg-muted)", fontSize: "0.75rem" }}>
                      {r.newDrivers.length} sürücü ·{" "}
                      {r.sha256.slice(0, 12)}…
                    </div>
                  </div>
                  <button
                    className="btn secondary"
                    onClick={() => handleReloadRecent(r)}
                    disabled={loading}
                  >
                    Tekrar Yükle
                  </button>
                  <button
                    className="btn secondary"
                    onClick={() => handleDeleteRecent(r)}
                    disabled={loading}
                    title="Cache'den kaldır"
                  >
                    Sil
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: "1rem" }}>
          <button
            className="btn secondary"
            onClick={onClose}
            disabled={loading}
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
