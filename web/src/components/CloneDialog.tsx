import { useState } from "react";
import { runtime } from "../pyodide/instance";
import { useAppStore } from "../state/store";
import { saveImage } from "../storage/image-store";
import type { DriverInfo } from "../pyodide/types";
import { SerialPortPicker } from "./SerialPortPicker";
import { errMsg } from "../lib/err";
import { useModalDismiss } from "../lib/useModalDismiss";

interface Props {
  mode: "download" | "upload";
  drivers: DriverInfo[];
  onClose: () => void;
}

export function CloneDialog({ mode, drivers, onClose }: Props) {
  const open = useAppStore((s) => s.openRadio);
  const setOpenRadio = useAppStore((s) => s.setOpenRadio);

  // Only cloneable drivers (clone-mode + a workable serial connection).
  const cloneDrivers = drivers.filter((d) => d.isClone);

  // Default vendor on download: first by alphabetical order.
  const [driverId, setDriverId] = useState<string>(
    mode === "upload" ? open?.info.model ?? "" : cloneDrivers[0]?.id ?? "",
  );
  const [portHandle, setPortHandle] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{
    cur: number;
    max: number;
    msg: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useModalDismiss(() => {
    if (!running) onClose();
  });

  async function run() {
    if (portHandle === null) {
      setError("Önce bir port seç.");
      return;
    }
    setError(null);
    setProgress(null);
    setRunning(true);

    try {
      if (mode === "download") {
        const info = await runtime.cloneIn(
          driverId,
          portHandle,
          (cur, max, msg) => setProgress({ cur, max, msg }),
        );
        const memories = await runtime.getMemoryRange(
          info.handle,
          info.memoryBounds[0],
          info.memoryBounds[1],
        );
        // Persist as a recent image immediately.
        const data = await runtime.saveImage(info.handle);
        const stored = await saveImage({
          filename: `${info.model}-${Date.now()}.img`,
          driverId: info.model,
          vendor: info.vendor,
          model: info.model,
          variant: info.variant,
          data,
        });
        setOpenRadio({
          info,
          filename: stored.filename,
          storedId: stored.id,
          memories,
          dirty: false,
          validationErrors: {},
        });
        onClose();
      } else {
        if (!open) {
          setError("Açık bir radyo yok.");
          return;
        }
        await runtime.cloneOut(
          open.info.handle,
          portHandle,
          (cur, max, msg) => setProgress({ cur, max, msg }),
        );
        onClose();
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !running && onClose()}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "download" ? "Radyodan İndir" : "Radyoya Yükle"}
      >
        <h2 style={{ marginTop: 0 }}>
          {mode === "download"
            ? "Radyodan İndir"
            : "Radyoya Yükle"}
        </h2>

        {mode === "download" && (
          <div className="form-row">
            <label className="settings-label">Radyo Modeli</label>
            <select
              className="value-input"
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              disabled={running}
            >
              {cloneDrivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {mode === "upload" && open && (
          <div className="form-row">
            <label className="settings-label">Radyo</label>
            <div className="value-input" style={{ background: "transparent" }}>
              {open.info.vendor} {open.info.model}
            </div>
          </div>
        )}

        <div className="form-row">
          <SerialPortPicker value={portHandle} onChange={setPortHandle} />
        </div>

        {progress && (
          <div className="form-row">
            <label className="settings-label">İlerleme</label>
            <div>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{
                    width:
                      progress.max > 0
                        ? `${(progress.cur / progress.max) * 100}%`
                        : "0%",
                  }}
                />
              </div>
              <div
                style={{
                  fontSize: "0.8125rem",
                  color: "var(--fg-muted)",
                  marginTop: "0.3rem",
                }}
              >
                {progress.msg} ({progress.cur} / {progress.max})
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="form-row">
            <span />
            <p style={{ color: "var(--danger)", margin: 0 }}>{error}</p>
          </div>
        )}

        <div className="modal-actions">
          {running ? (
            <button
              className="btn secondary"
              onClick={async () => {
                if (
                  !confirm(
                    "Aktif clone iptal edilecek. Pyodide worker yeniden " +
                      "başlatılacak ama sayfa tazelenmeyecek.\n\nDevam edilsin mi?",
                  )
                ) {
                  return;
                }
                try {
                  await runtime.hardReset();
                } finally {
                  // Modal close + state reset; the App-level useEffect
                  // re-runs init, so the user sees the loading bar
                  // briefly then we're back to Welcome.
                  setRunning(false);
                  setProgress(null);
                  setError("İşlem iptal edildi.");
                  onClose();
                }
              }}
            >
              Durdur
            </button>
          ) : (
            <button className="btn secondary" onClick={onClose}>
              İptal
            </button>
          )}
          <button
            className="btn"
            onClick={run}
            disabled={running || portHandle === null || !driverId}
          >
            {running
              ? mode === "download"
                ? "İndiriliyor…"
                : "Yükleniyor…"
              : mode === "download"
                ? "İndir"
                : "Yükle"}
          </button>
        </div>
      </div>
    </div>
  );
}
