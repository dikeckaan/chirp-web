import { useModalDismiss } from "../lib/useModalDismiss";

interface Props {
  onClose: () => void;
}

export function AboutDialog({ onClose }: Props) {
  const dialogRef = useModalDismiss(onClose);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="CHIRP-Web Hakkında"
        style={{ maxWidth: 560 }}
      >
        <h2 style={{ marginTop: 0 }}>CHIRP-Web Hakkında</h2>

        <p style={{ color: "var(--fg-muted)", fontSize: "0.875rem" }}>
          Browser-native CHIRP — Python radyo programlama yazılımının
          kurulum gerektirmeyen versiyonu. Tüm CHIRP kodu{" "}
          <a
            href="https://pyodide.org/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Pyodide
          </a>{" "}
          ile WebAssembly içinde çalışır; gerçek radyolarla iletişim
          WebSerial API üzerinden kurulur.
        </p>

        <h3 style={{ fontSize: "0.95rem", marginTop: "1.25rem" }}>Gizlilik</h3>
        <p style={{ color: "var(--fg-muted)", fontSize: "0.875rem" }}>
          Sunucu yok. Image dosyaların, ayarların ve yüklediğin modüller
          tarayıcının IndexedDB'sinde, sadece senin cihazında saklanır.
          Hiçbir veri başka bir sunucuya gönderilmez. Telemetri yok.
        </p>

        <h3 style={{ fontSize: "0.95rem", marginTop: "1.25rem" }}>Lisans</h3>
        <p style={{ color: "var(--fg-muted)", fontSize: "0.875rem" }}>
          Bu proje{" "}
          <a
            href="https://www.gnu.org/licenses/gpl-3.0.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            GPL-3.0-or-later
          </a>{" "}
          altında dağıtılmaktadır — upstream CHIRP ile uyumlu.
        </p>

        <h3 style={{ fontSize: "0.95rem", marginTop: "1.25rem" }}>
          Teşekkürler
        </h3>
        <ul
          style={{
            color: "var(--fg-muted)",
            fontSize: "0.875rem",
            paddingLeft: "1.25rem",
            margin: 0,
          }}
        >
          <li>
            Dan Smith (KK7DS) ve CHIRP topluluğu —{" "}
            <a
              href="https://chirpmyradio.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              chirpmyradio.com
            </a>
          </li>
          <li>
            Upstream CHIRP kaynak kodu:{" "}
            <a
              href="https://github.com/kk7ds/chirp"
              target="_blank"
              rel="noopener noreferrer"
            >
              kk7ds/chirp
            </a>
          </li>
          <li>Pyodide ekibi — Python in WebAssembly</li>
          <li>
            Quansheng UV-K5 topluluk sürücüleri (f4hwn, sq5bpf ve diğerleri)
          </li>
        </ul>

        <h3 style={{ fontSize: "0.95rem", marginTop: "1.25rem" }}>Sınırlar</h3>
        <ul
          style={{
            color: "var(--fg-muted)",
            fontSize: "0.875rem",
            paddingLeft: "1.25rem",
            margin: 0,
          }}
        >
          <li>WebSerial yalnızca masaüstü Chrome / Edge'de çalışır.</li>
          <li>
            SharedArrayBuffer için secure context (HTTPS veya localhost)
            ve cross-origin isolation (COOP/COEP) gerekir.
          </li>
          <li>
            Bazı driver'lar (UV-17 Pro vb.) bellek boyutunu radyo
            dump'ından öğrendiği için boş image yaratılamaz; önce
            radyodan download yapılmalı.
          </li>
        </ul>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
