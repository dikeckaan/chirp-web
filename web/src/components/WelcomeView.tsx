import { useEffect, useRef, useState } from "react";
import { runtime } from "../pyodide/instance";
import { useAppStore } from "../state/store";
import { saveImage, listRecentImages, loadImageBytes } from "../storage/image-store";
import type { StoredImage } from "../storage/indexeddb";
import type { DriverInfo } from "../pyodide/types";
import { CloneDialog } from "./CloneDialog";
import { ModuleLoader } from "./ModuleLoader";
import { errMsg } from "../lib/err";

export function WelcomeView() {
  const drivers = useAppStore((s) => s.drivers);
  const setOpenRadio = useAppStore((s) => s.setOpenRadio);
  const setError = useAppStore((s) => s.setError);
  const [recents, setRecents] = useState<StoredImage[]>([]);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [showModuleLoader, setShowModuleLoader] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Only recents — the driver list is owned by App.tsx (which loads
  // community modules first, then calls listDrivers, then writes the
  // result into the store). Re-fetching it here would race against
  // that and could wipe out freshly-loaded community drivers.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const recent = await listRecentImages();
        if (cancelled) return;
        setRecents(recent);
      } catch (e) {
        if (!cancelled) setError(errMsg(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setError]);

  async function handleFileOpen(file: File) {
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const info = await runtime.openImage(buf, file.name);
      const memories = await runtime.getMemoryRange(
        info.handle,
        info.memoryBounds[0],
        info.memoryBounds[1],
      );
      const stored = await saveImage({
        filename: file.name,
        driverId: info.model,
        vendor: info.vendor,
        model: info.model,
        variant: info.variant,
        data: buf,
      });
      setOpenRadio({
        info,
        filename: file.name,
        storedId: stored.id,
        memories,
        dirty: false,
        validationErrors: {},
      });
      setRecents(await listRecentImages());
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function handleNewRadio(driverId: string) {
    try {
      const info = await runtime.newRadio(driverId);
      const memories = await runtime.getMemoryRange(
        info.handle,
        info.memoryBounds[0],
        info.memoryBounds[1],
      );
      setOpenRadio({
        info,
        filename: null,
        storedId: null,
        memories,
        dirty: false,
        validationErrors: {},
      });
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function handleOpenRecent(stored: StoredImage) {
    try {
      const data = await loadImageBytes(stored.id);
      if (!data) {
        setError("Recent image not found in storage.");
        return;
      }
      const info = await runtime.openImage(data, stored.filename);
      const memories = await runtime.getMemoryRange(
        info.handle,
        info.memoryBounds[0],
        info.memoryBounds[1],
      );
      setOpenRadio({
        info,
        filename: stored.filename,
        storedId: stored.id,
        memories,
        dirty: false,
        validationErrors: {},
      });
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <>
      <div className="welcome-grid">
        <OpenImageCard fileInputRef={fileInputRef} onFile={handleFileOpen} />
        <NewRadioCard drivers={drivers} onCreate={handleNewRadio} />
        <CloneFromRadioCard onOpen={() => setShowCloneDialog(true)} />
        <ModuleLoaderCard onOpen={() => setShowModuleLoader(true)} />
        <RecentImagesCard recents={recents} onOpen={handleOpenRecent} />
      </div>
      {showCloneDialog && (
        <CloneDialog
          mode="download"
          drivers={drivers}
          onClose={() => setShowCloneDialog(false)}
        />
      )}
      {showModuleLoader && (
        <ModuleLoader onClose={() => setShowModuleLoader(false)} />
      )}
    </>
  );
}

function ModuleLoaderCard({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="card">
      <h2>Modül Yükle</h2>
      <p>
        f4hwn UV-K5 gibi topluluk <code>.py</code> sürücülerini yükle.
        Pyodide sandbox'ı içinde çalışırlar.
      </p>
      <button className="btn" onClick={onOpen}>
        Modül Seç
      </button>
    </div>
  );
}

function CloneFromRadioCard({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="card">
      <h2>Radyodan İndir</h2>
      <p>
        Bağlı bir radyodan WebSerial üzerinden image indirir. Önce USB
        kablosunu tak, sonra "İndir" diyaloğundan port izni ver.
      </p>
      <button className="btn" onClick={onOpen}>
        İndir Diyaloğunu Aç
      </button>
      <p
        style={{
          marginTop: "0.75rem",
          fontSize: "0.75rem",
          color: "var(--fg-muted)",
        }}
      >
        WebSerial sadece Chrome / Edge masaüstünde çalışır. Firefox ve
        Safari'de bu özellik yok.
      </p>
    </div>
  );
}

function OpenImageCard({
  fileInputRef,
  onFile,
}: {
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFile: (f: File) => void;
}) {
  return (
    <div className="card">
      <h2>Image Aç</h2>
      <p>
        Daha önce kaydedilmiş bir <code>.img</code> dosyasını yükle. CHIRP
        içeriği otomatik tanır.
      </p>
      <input
        id="welcome-img-input"
        ref={fileInputRef}
        type="file"
        accept=".img,.dat,.bin"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }}
      />
      <label
        htmlFor="welcome-img-input"
        className="btn"
        style={{ cursor: "pointer", display: "inline-block" }}
      >
        Dosya seç
      </label>
    </div>
  );
}

function NewRadioCard({
  drivers,
  onCreate,
}: {
  drivers: DriverInfo[];
  onCreate: (id: string) => void;
}) {
  // Only show drivers that can synthesize an empty image. UV-17 Pro and
  // friends compute their memsize from the actual dump, so they require
  // either a real download or an existing .img.
  const supported = drivers.filter((d) => d.supportsNew);
  const [selected, setSelected] = useState<string>(supported[0]?.id ?? "");

  useEffect(() => {
    if (!selected && supported.length) setSelected(supported[0].id);
  }, [supported, selected]);

  return (
    <div className="card">
      <h2>Yeni Radyo</h2>
      <p>Boş image yaratabilen sürücülerden birini seç.</p>
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        style={{
          width: "100%",
          padding: "0.4rem 0.5rem",
          background: "var(--bg)",
          border: "1px solid var(--border-strong)",
          borderRadius: 6,
          marginBottom: "0.75rem",
        }}
      >
        {supported.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <button
        className="btn"
        disabled={!selected}
        onClick={() => onCreate(selected)}
      >
        Oluştur
      </button>
      <p
        style={{
          marginTop: "0.75rem",
          fontSize: "0.75rem",
          color: "var(--fg-muted)",
        }}
      >
        UV-17 Pro vs. bellek boyutunu dump'tan öğrenen sürücüler için önce
        bir .img aç ya da radyodan download yap.
      </p>
    </div>
  );
}

function RecentImagesCard({
  recents,
  onOpen,
}: {
  recents: StoredImage[];
  onOpen: (s: StoredImage) => void;
}) {
  return (
    <div className="card">
      <h2>Son Açılanlar</h2>
      {recents.length === 0 ? (
        <p>Henüz dosya yok. Açtığın image'lar burada birikir.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {recents.map((r) => (
            <li
              key={r.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0.4rem 0",
                borderBottom: "1px solid var(--border)",
                fontSize: "0.875rem",
              }}
            >
              <div>
                <div style={{ fontWeight: 500 }}>{r.filename}</div>
                <div
                  style={{
                    color: "var(--fg-muted)",
                    fontSize: "0.75rem",
                  }}
                >
                  {r.vendor} {r.model}
                </div>
              </div>
              <button className="btn secondary" onClick={() => onOpen(r)}>
                Aç
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
