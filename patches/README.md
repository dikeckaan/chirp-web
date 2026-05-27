# Upstream Patches

İdeal durum: bu dizin boştur.

Eğer CHIRP-Web çalışmak için `vendor/chirp/` ağacında bir değişikliğe
ihtiyaç duyarsa, değişikliği burada bir `.patch` dosyası olarak saklarız
ve eş zamanlı olarak upstream'e PR göndeririz. PR merge olunca patch
silinir.

## Kurallar

- `vendor/chirp/` ağacındaki dosyalar **doğrudan modifiye edilmez**.
- Her patch'in yanında yorumla nedenini ve upstream PR linkini yaz.
- CI'da `git submodule status` ile vendor/chirp/'in unchanged olduğu
  kontrol edilir.

## Mevcut patch'ler

(boş)
