# Oxygen Not Included (ONI) Indonesia 

![preview](public/preview.png)

Translasi gim [Oxygen Not Included](https://store.steampowered.com/app/457140/Oxygen_Not_Included/) ke Bahasa Indonesia. Subscribe di [sini](https://steamcommunity.com/sharedfiles/filedetails/?id=1579169540) untuk bisa memakai ONI versi bahasa Indonesia.

## Instruksi Kompilasi 

### Instalasi di macOS (Apple Silicon/M2)

Untuk memudahkan proses kompilasi (`.po -> .mo`), pengecekan kualitas, dan statistik, siapkan toolchain berikut:

1) Instal Homebrew (jika belum ada)
   - https://brew.sh/

2) Jalankan skrip instalasi
   - Berikan izin eksekusi lalu jalankan:
     - `chmod +x scripts/install-macos.sh`
     - `./scripts/install-macos.sh` (tambah opsi `--omegat` jika ingin menginstal OmegaT)

3) Tambahkan gettext ke PATH
   - Tambahkan baris berikut ke `~/.zshrc` lalu buka terminal baru:
     - `export PATH="/opt/homebrew/opt/gettext/bin:$PATH"`

4) Uji alat yang terpasang
   - `msgfmt --version`
   - `pocount --version`

### Perintah Make yang tersedia
- `make all`: Sinkronisasi `strings.po` ke `public/`, kompilasi `strings.mo`, jalankan validasi & QA, tampilkan statistik.
- `make build`: Kompilasi `public/strings.mo` dari `strings.po`.
- `make check`: Validasi `.po` dan jalankan cek QA (placeholder/format/HTML) jika `pofilter` tersedia.
- `make stats`: Tampilkan statistik terjemahan (memerlukan Translate Toolkit).
- `make sync`: Salin `strings.po` ke `public/strings.po`.


## Pengetesan

https://youtube.com/live/R7-TR6SBuEM

## Lisensi 

MIT

2019-2025
