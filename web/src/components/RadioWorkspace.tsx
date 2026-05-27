import { useRef, useState } from "react";
import { runtime } from "../pyodide/instance";
import { useAppStore } from "../state/store";
import { saveImage } from "../storage/image-store";
import { MemoryEditor } from "./MemoryEditor";
import { SettingsEditor } from "./SettingsEditor";
import { CloneDialog } from "./CloneDialog";

type WorkspaceTab = "memory" | "settings";

export function RadioWorkspace() {
  const open = useAppStore((s) => s.openRadio);
  const setOpenRadio = useAppStore((s) => s.setOpenRadio);
  const setDirty = useAppStore((s) => s.setDirty);
  const setError = useAppStore((s) => s.setError);
  const [tab, setTab] = useState<WorkspaceTab>("memory");
  const [showUpload, setShowUpload] = useState(false);
  const drivers = useAppStore((s) => s.drivers);
  const csvInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const titleParts = [open.info.vendor, open.info.model, open.info.variant]
    .filter(Boolean)
    .join(" ");

  async function handleSave() {
    if (!open) return;
    try {
      const data = await runtime.saveImage(open.info.handle);
      const stored = await saveImage({
        id: open.storedId ?? undefined,
        filename: open.filename ?? `${open.info.model}.img`,
        driverId: open.info.model,
        vendor: open.info.vendor,
        model: open.info.model,
        variant: open.info.variant,
        data,
      });
      setOpenRadio({
        ...open,
        filename: stored.filename,
        storedId: stored.id,
        dirty: false,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleDownload() {
    if (!open) return;
    try {
      const data = await runtime.saveImage(open.info.handle);
      const blob = new Blob([data as BlobPart], {
        type: "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = open.filename ?? `${open.info.model}.img`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleExportCsv() {
    if (!open) return;
    try {
      const data = await runtime.exportCsv(open.info.handle);
      const blob = new Blob([data as BlobPart], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (open.filename ?? open.info.model).replace(/\.img$/i, "") + ".csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleImportCsv(file: File) {
    if (!open) return;
    if (
      !confirm(
        "Bu CSV'deki kanallar mevcut radyoya yazılacak. Devam edilsin mi?",
      )
    ) {
      return;
    }
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const result = await runtime.importCsv(open.info.handle, buf);
      // Refresh memory list
      const memories = await runtime.getMemoryRange(
        open.info.handle,
        open.info.memoryBounds[0],
        open.info.memoryBounds[1],
      );
      setOpenRadio({ ...open, memories, dirty: true });
      const summary =
        `İçeri alındı: ${result.imported} kanal\n` +
        (result.skipped ? `Atlandı: ${result.skipped} kanal\n` : "") +
        (result.warnings.length
          ? "\nUyarılar:\n" + result.warnings.slice(0, 10).join("\n")
          : "");
      alert(summary);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleClose() {
    if (!open) return;
    if (
      open.dirty &&
      !confirm(
        "Kaydedilmemiş değişiklikler var. Kapatmak istediğinden emin misin?",
      )
    ) {
      return;
    }
    try {
      await runtime.closeRadio(open.info.handle);
    } catch {
      // best effort
    }
    setOpenRadio(null);
  }

  return (
    <div className="workspace">
      <div className="workspace-toolbar">
        <div className="radio-label">
          <span className="model">
            {open.dirty && <span className="dirty-dot" />}
            {titleParts || "Radyo"}
          </span>
          <span className="filename">
            {open.filename ?? "Kaydedilmemiş"}
            {" · "}
            {open.memories.length} kanal
          </span>
        </div>

        <div className="workspace-tabs">
          <button
            className={"workspace-tab" + (tab === "memory" ? " active" : "")}
            onClick={() => setTab("memory")}
          >
            Bellek
          </button>
          {open.info.hasSettings && (
            <button
              className={
                "workspace-tab" + (tab === "settings" ? " active" : "")
              }
              onClick={() => setTab("settings")}
            >
              Ayarlar
            </button>
          )}
        </div>

        <span className="spacer" />
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImportCsv(f);
            if (csvInputRef.current) csvInputRef.current.value = "";
          }}
        />
        <button
          className="btn secondary"
          onClick={() => csvInputRef.current?.click()}
          title="CSV dosyasından kanal listesi içeri al"
        >
          CSV İçe Al
        </button>
        <button
          className="btn secondary"
          onClick={handleExportCsv}
          title="Mevcut kanalları CSV olarak indir"
        >
          CSV Dışa Aktar
        </button>
        {open.info.isClone && (
          <button
            className="btn secondary"
            onClick={() => setShowUpload(true)}
            title="Bu image'ı bağlı radyoya yaz"
          >
            Radyoya Yükle
          </button>
        )}
        <button className="btn secondary" onClick={handleSave}>
          Kaydet (Browser)
        </button>
        <button className="btn" onClick={handleDownload}>
          .img İndir
        </button>
        <button className="btn secondary" onClick={handleClose}>
          Kapat
        </button>
      </div>

      {tab === "memory" && <MemoryEditor radio={open} />}
      {tab === "settings" && open.info.hasSettings && (
        <SettingsEditor handle={open.info.handle} />
      )}

      {showUpload && (
        <CloneDialog
          mode="upload"
          drivers={drivers}
          onClose={() => setShowUpload(false)}
        />
      )}
    </div>
  );
}
