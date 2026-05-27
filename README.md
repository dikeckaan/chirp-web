# CHIRP-Web

Browser-native CHIRP — kurulum gerektirmeyen, izole, açık kaynak radyo
programlama aracı. Python tarafı [Pyodide](https://pyodide.org/) ile WebAssembly
içinde çalışır; gerçek radyolarla iletişim WebSerial API üzerinden kurulur.
Tüm kullanıcı verisi (image dosyaları, yüklü modüller) cihazınızda kalır.

## Durum

🚧 Geliştirme aşamasında — Milestone 1 (Foundation).

## Hızlı Başlangıç (Geliştirici)

```bash
git clone --recursive https://github.com/<owner>/chirp-web
cd chirp-web

# CHIRP bundle'ını oluştur
python scripts/build-bundle.py

# Web tarafı
cd web
npm install
npm run dev
```

Tarayıcıda `http://localhost:5173` adresini Chrome veya Edge ile açın
(WebSerial sadece bu tarayıcılarda destekleniyor).

## Mimari

Üç katman:

1. **`vendor/chirp/`** — Upstream CHIRP'in vendored submodule kopyası.
   Asla modifiye edilmez.
2. **`python/`** — Pyodide içinde çalışan shim'ler (`pyserial` → WebSerial,
   `wx` stub) ve browser ↔ CHIRP köprü kodu.
3. **`web/`** — React + TypeScript frontend. Pyodide'i Web Worker'da host
   eder; SharedArrayBuffer + Atomics ile sync I/O sağlar.

Detaylı plan ve milestone'lar için `docs/PLAN.md`.

## Lisans

GPL-3.0-or-later (CHIRP uyumu). Bkz. [LICENSE](./LICENSE) ve
[NOTICE](./NOTICE).
