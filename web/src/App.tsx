import { useEffect, useRef, useState } from "react";
import { useAppStore } from "./state/store";
import { runtime } from "./pyodide/instance";
import { useTheme } from "./state/theme";
import { StatusCard } from "./components/StatusCard";
import { WelcomeView } from "./components/WelcomeView";
import { RadioWorkspace } from "./components/RadioWorkspace";
import { AboutDialog } from "./components/AboutDialog";
import { listModules, loadModuleBytes } from "./storage/module-store";

export function App() {
  const status = useAppStore((s) => s.status);
  const progressLabel = useAppStore((s) => s.progressLabel);
  const runtimeInfo = useAppStore((s) => s.runtime);
  const error = useAppStore((s) => s.error);
  const openRadio = useAppStore((s) => s.openRadio);

  const setStatus = useAppStore((s) => s.setStatus);
  const setProgress = useAppStore((s) => s.setProgress);
  const setRuntime = useAppStore((s) => s.setRuntime);
  const setError = useAppStore((s) => s.setError);

  const inited = useRef(false);
  const [autoLoadStatus, setAutoLoadStatus] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [theme, setTheme] = useTheme();

  useEffect(() => {
    if (inited.current) return;
    inited.current = true;
    setStatus("loading");
    runtime.init({
      onProgress: (label) => setProgress(label),
      onReady: (info) => setRuntime(info),
      onError: (msg) => setError(msg),
    });
    return () => {
      // Keep the runtime alive across hot reloads; dispose only on close.
    };
  }, [setStatus, setProgress, setRuntime, setError]);

  // Once Pyodide is ready, re-load any community modules the user has
  // previously saved to IndexedDB so their drivers are back in the
  // registry. Failures are swallowed (with a console warning) — the
  // user can re-load manually from the Module Loader.
  useEffect(() => {
    if (status !== "ready") return;
    let cancelled = false;
    (async () => {
      const modules = await listModules();
      if (modules.length === 0) return;
      setAutoLoadStatus(`${modules.length} kayıtlı modül yükleniyor…`);
      let loaded = 0;
      for (const m of modules) {
        if (cancelled) return;
        try {
          const data = await loadModuleBytes(m.sha256);
          if (data) {
            await runtime.loadModule(m.filename, data);
            loaded++;
          }
        } catch (e) {
          console.warn(
            `[chirp-web] auto-reload failed for ${m.filename}:`,
            e,
          );
        }
      }
      if (cancelled) return;
      setAutoLoadStatus(`${loaded} modül yüklendi`);
      // Refresh driver list with the newly-registered drivers.
      try {
        const fresh = await runtime.listDrivers();
        useAppStore.getState().setDrivers(fresh);
      } catch {
        /* ignore */
      }
      // Clear the toast after a few seconds.
      setTimeout(() => !cancelled && setAutoLoadStatus(null), 3000);
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  const pillClass =
    "runtime-pill " +
    (status === "ready"
      ? "ready"
      : status === "error"
        ? "error"
        : "");

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>CHIRP-Web</h1>
        <span className="tagline">Browser-native CHIRP</span>
        <span className="header-spacer" />
        <span className={pillClass} title={runtimeInfo?.bundleSha ?? ""}>
          {status === "loading" && (
            <>
              <span className="spinner" />
              {progressLabel || "Yükleniyor"}
            </>
          )}
          {status === "ready" && runtimeInfo && (
            <>
              CHIRP {runtimeInfo.version} · {runtimeInfo.driverCount} sürücü
            </>
          )}
          {status === "error" && "Hata"}
        </span>
        <button
          className="icon-btn"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title={theme === "dark" ? "Açık tema" : "Koyu tema"}
          aria-label="Tema değiştir"
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
        <button
          className="icon-btn"
          onClick={() => setShowAbout(true)}
          title="Hakkında"
          aria-label="Hakkında"
        >
          ℹ
        </button>
      </header>

      <main className="app-main">
        {status !== "ready" && (
          <StatusCard
            status={status}
            progressLabel={progressLabel}
            error={error}
          />
        )}

        {status === "ready" && !openRadio && <WelcomeView />}
        {status === "ready" && openRadio && <RadioWorkspace />}
        {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
        {autoLoadStatus && (
          <div
            style={{
              position: "fixed",
              bottom: "1rem",
              right: "1rem",
              background: "var(--bg-elev)",
              border: "1px solid var(--accent)",
              borderRadius: 8,
              padding: "0.5rem 0.85rem",
              color: "var(--accent)",
              fontSize: "0.8125rem",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              zIndex: 200,
            }}
          >
            {autoLoadStatus}
          </div>
        )}

        {status === "loading" && (
          <p
            style={{
              color: "var(--fg-muted)",
              padding: "0 1.5rem",
              maxWidth: 700,
            }}
          >
            İlk yükleme Pyodide WebAssembly çalışma zamanını ve CHIRP
            paketini indirir (~10 MB). Sonraki ziyaretlerde Service
            Worker cache devreye girecek.
          </p>
        )}
      </main>

      <footer className="app-footer">
        Açık kaynak ·{" "}
        <a
          href="https://github.com/kk7ds/chirp"
          target="_blank"
          rel="noopener"
        >
          Upstream CHIRP
        </a>{" "}
        · GPL-3.0
      </footer>
    </div>
  );
}
