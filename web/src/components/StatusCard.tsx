import type { ReactNode } from "react";

interface StatusCardProps {
  status: string;
  progressLabel: string;
  error: string | null;
}

export function StatusCard({ status, progressLabel, error }: StatusCardProps) {
  const className =
    "status-card" +
    (status === "ready" ? " ready" : status === "error" ? " error" : "");

  let title = "Beklemede";
  let body: ReactNode = "Hazır.";

  if (status === "loading") {
    title = "Yükleniyor";
    body = (
      <>
        <span className="spinner" />
        {progressLabel || "..."}
      </>
    );
  } else if (status === "ready") {
    title = "Hazır";
    body = "CHIRP browser'da çalışıyor.";
  } else if (status === "error") {
    title = "Hata";
    body = <pre>{error}</pre>;
  }

  return (
    <div className={className}>
      <div className="label">Çalışma Zamanı</div>
      <div className="value">{title}</div>
      <div style={{ marginTop: "0.5rem", color: "var(--fg-muted)" }}>
        {body}
      </div>
    </div>
  );
}
