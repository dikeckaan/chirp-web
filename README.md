# CHIRP-Web

Browser-native CHIRP — kurulum gerektirmeyen, izole, açık kaynak radyo
programlama aracı. Python tarafı [Pyodide](https://pyodide.org/) ile
WebAssembly içinde çalışır; gerçek radyolarla iletişim WebSerial API
üzerinden kurulur. Tüm kullanıcı verisi (image dosyaları, yüklü modüller)
cihazınızda kalır.

## Durum

✅ Memory editor · Settings editor · Clone download/upload (WebSerial) ·
Module Loader · CSV import/export · IndexedDB persistence · Dark/Light tema.

## Hızlı Başlangıç (Geliştirici)

```bash
git clone --recursive https://github.com/<owner>/chirp-web
cd chirp-web

# CHIRP bundle'ını oluştur (Python 3.12)
python3 scripts/build-bundle.py

# Web tarafı
cd web
npm install
npm run dev   # https://localhost:5173/  (self-signed cert)
```

Tarayıcıda `https://localhost:5173` adresini Chrome veya Edge ile aç
(WebSerial sadece bu tarayıcılarda destekleniyor).

## Mimari

Üç katman:

1. **`vendor/chirp/`** — Upstream CHIRP'in vendored submodule kopyası.
   Asla modifiye edilmez.
2. **`python/`** — Pyodide içinde çalışan shim'ler (`pyserial` → WebSerial,
   `wx` stub) ve browser ↔ CHIRP köprü kodu.
3. **`web/`** — React + TypeScript + Vite frontend. Pyodide'i Web
   Worker'da host eder; SharedArrayBuffer + Atomics ile sync I/O sağlar.

Detaylı milestone planı: `docs/PLAN.md`.

## Deploy

### Cloudflare Pages (önerilen — native COOP/COEP)

1. Cloudflare dashboard → Pages → Create project → Connect GitHub → bu repo.
2. Build settings:
   - Build command: `python3 scripts/build-bundle.py && cd web && npm ci && npm run build`
   - Build output: `web/dist`
   - Root directory: `/` (default)
   - Environment variable: `PYTHON_VERSION=3.12`
3. Deploy. `_headers` dosyası COOP/COEP'i otomatik set eder.

Veya manuel deploy:
```bash
cd web && npm run build
wrangler pages deploy dist --project-name=chirp-web
```

### GitHub Pages

`.github/workflows/deploy-pages.yml` mevcut. Aktif etmek için:

1. Repo settings → Pages → Source: **GitHub Actions**.
2. Main'e push → workflow otomatik çalışır.
3. URL: `https://<owner>.github.io/chirp-web/`

GitHub Pages COOP/COEP header'ı set edemez; bizim service worker'ımız
ilk yüklemeden sonra COOP/COEP'i runtime'da enjekte ediyor (sayfa bir
kere otomatik reload olur).

## Lisans

GPL-3.0-or-later (CHIRP uyumu). Bkz. [LICENSE](./LICENSE) ve
[NOTICE](./NOTICE).
