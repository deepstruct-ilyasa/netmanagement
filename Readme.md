# NetManagement — Network Device & Port Topology Documentation

Aplikasi berbasis web yang dibangun menggunakan **Node.js**, **Express**, **EJS**, dan **SQLite (`better-sqlite3`)** untuk mendokumentasikan inventaris perangkat jaringan multi-cabang, pemetaan koneksi *port-to-port*, visualisasi topologi interaktif, manajemen hak akses berbasis peran (RBAC), serta pencatatan *audit logs*.

---

## Daftar Isi

1. [Fitur Utama](#fitur-utama)
2. [Persyaratan Sistem (System Requirements)](#persyaratan-sistem-system-requirements)
3. [Persiapan Environment (Prasyarat)](#persiapan-environment-prasyarat)
   - [A. Linux (Debian 12/13 & Ubuntu 22.04/24.04 LTS)](#a-linux-debian-1213--ubuntu-22042404-lts)
   - [B. Windows 10 / 11 / Windows Server](#b-windows-10--11--windows-server)
4. [Cara Instalasi & Menjalankan Aplikasi](#cara-instalasi--menjalankan-aplikasi)
5. [Akun Login Default & Keamanan Awal](#akun-login-default--keamanan-awal)
6. [Menjalankan di Background (Production)](#menjalankan-di-background-production)
   - [Menggunakan Systemd (Linux)](#1-menggunakan-systemd-linux)
   - [Menggunakan Nginx Reverse Proxy (Opsional)](#2-menggunakan-nginx-reverse-proxy-opsional)
7. [Backup & Restore Data](#backup--restore-data)
8. [Struktur Direktori Proyek](#struktur-direktori-proyek)
9. [Troubleshooting Umum](#troubleshooting-umum)

---

## Fitur Utama

- **Multi-Branch Context**: Mengelola perangkat dan topologi per lokasi cabang (*Head Office* / cabang spesifik) atau secara global seluruh cabang.
- **Interactive Topology & Faceplate**: Visualisasi interaktif hubungan antar-perangkat beserta tampilan fisik *faceplate* port (*rackmount* 1/2 baris).
- **Master Data Perangkat**: Pengelolaan data Cabang, Brand/Merk, Jenis Perangkat (termasuk kategori *Switch* & dukungan PoE), serta Model/Type.
- **Port-to-Port Connection Tracking**: Dokumentasi detail kabel (UTP Cat6, Fiber Optik, dll.), *link speed*, informasi VLAN, hingga koneksi ke *end-device*.
- **Role-Based Access Control (RBAC)**: Pengaturan hak akses berdasarkan peran (`administrator`, `branch_user`, `viewer`), pembatasan cabang, dan hak akses menu.
- **Audit Logs**: Pencatatan seluruh aktivitas sistem (`CREATE`, `UPDATE`, `DELETE`, `CONNECT`, `DISCONNECT`) lengkap dengan waktu, pelaku, dan alamat IP client.

---

## Persyaratan Sistem (System Requirements)

### 1. Spesifikasi Perangkat Keras (Minimum & Rekomendasi)

| Komponen | Minimum | Rekomendasi |
| :--- | :--- | :--- |
| **Sistem Operasi** | Debian 12+, Ubuntu 22.04+, Windows 10+, macOS | Debian 13 / Ubuntu 24.04 LTS (64-bit) |
| **Processor (CPU)** | 1 vCPU | 2 vCPU |
| **Memori (RAM)** | 512 MB | $\ge$ 1 GB |
| **Penyimpanan** | 1 GB ruang kosong | $\ge$ 5 GB (untuk foto fisik & SN perangkat) |
| **Jaringan** | Port TCP `3500` terbuka (akses lokal/LAN) | Port `80`/`443` via Reverse Proxy |

### 2. Perangkat Lunak & Runtime Wajib

- **Git**: Untuk mengunduh (*clone*) kode sumber dari repository.
- **Node.js**:
  - **Sangat Direkomendasikan — Node.js v20 LTS atau v22 LTS**: Library `better-sqlite3` sudah menyediakan *prebuilt binary* untuk versi ini, sehingga proses `npm install` berjalan cepat tanpa perlu mengompilasi kode C++.
  - **Node.js v24 / v26+**: Tetap didukung, namun **wajib** memasang paket *C/C++ build tools* (`make`, `g++`, `python3`) terlebih dahulu agar `node-gyp` dapat membangun modul SQLite.
- **npm**: v10 atau lebih baru (otomatis terpasang bersama Node.js).

---

## Persiapan Environment (Prasyarat)

### A. Linux (Debian 12/13 & Ubuntu 22.04/24.04 LTS)

1. **Perbarui Repositori dan Pasang Paket Dasar & Compiler**
   Jalankan perintah berikut sebagai `root` atau menggunakan `sudo`:
   ```bash
   sudo apt update
   sudo apt install -y git curl build-essential python3
   ```
   > *Catatan: Paket `build-essential` (berisi `make` dan `g++`) serta `python3` mencegah error kompilasi `better-sqlite3` apabila server menggunakan Node.js versi terbaru.*

2. **Pasang Node.js v22 LTS (via NodeSource)**
   Jika Node.js belum terpasang di server, jalankan:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs
   ```

3. **Verifikasi Instalasi**
   Pastikan `git`, `node`, `npm`, dan `make` sudah terbaca oleh sistem:
   ```bash
   git --version
   node -v
   npm -v
   make --version
   ```

---

### B. Windows 10 / 11 / Windows Server

1. **Pasang Git for Windows**: Unduh dan install dari [git-scm.com](https://git-scm.com/download/win).
2. **Pasang Node.js v22 LTS**: Unduh installer **LTS** dari [nodejs.org](https://nodejs.org/).
   - Saat proses instalasi, biarkan pengaturan default (tidak perlu mencentang *Automatically install the necessary tools* jika menggunakan Node.js v22 LTS).
3. **Verifikasi Instalasi**: Buka **Command Prompt (CMD)** atau **PowerShell**, lalu jalankan:
   ```powershell
   git --version
   node -v
   npm -v
   ```

---

## Cara Instalasi & Menjalankan Aplikasi

1. **Clone Repository**
   Masuk ke direktori tujuan instalasi (misalnya `/var/www` di Linux atau `C:\apps` di Windows), lalu lakukan *clone*:
   ```bash
   cd /var/www
   git clone https://github.com/deepstruct-ilyasa/netmanagement.git
   cd netmanagement
   ```

2. **Install Dependencies**
   Unduh seluruh pustaka yang dibutuhkan sesuai `package.json`:
   ```bash
   npm install
   ```

3. **Jalankan Aplikasi**
   Jalankan entry point utama `app.js`:
   ```bash
   node app.js
   ```
   Jika berhasil, terminal akan menampilkan pesan:
   ```text
   Server berjalan di http://0.0.0.0:3500
   ```

   **Inisialisasi Otomatis pada Saat Pertama Kali Dijalankan:**
   - Membuat direktori `database/` dan file database `database/netmanagement.db` (dengan mode *WAL* aktif).
   - Membuat direktori `public/uploads/` untuk menyimpan foto fisik dan foto Serial Number perangkat.
   - Membangun seluruh struktur tabel dan mengisi data master bawaan (*Branch `HO`*, *Device Types*, *Brands*, serta akun *Administrator*).

4. **Buka Aplikasi di Browser**
   - Akses dari komputer lokal: `http://localhost:3500`
   - Akses dari komputer lain dalam jaringan (LAN/VPN): `http://<IP-ADDRESS-SERVER>:3500`

---

## Akun Login Default & Keamanan Awal

Setelah halaman login terbuka, masuk menggunakan akun administrator bawaan sistem:

| Parameter | Nilai Default |
| :--- | :--- |
| **Username** | `admin` |
| **Password** | `admin123` |
| **Role** | `administrator` (Akses seluruh cabang & seluruh menu) |

> **Rekomendasi Keamanan:**
> 1. Segera ganti password akun `admin` atau buat akun administrator personal melalui menu **Manajemen User** setelah login pertama kali.
> 2. Pastikan firewall server hanya mengizinkan akses ke port `3500` dari jaringan internal/VPN yang terpercaya.

---

## Menjalankan di Background (Production)

Agar aplikasi tetap berjalan otomatis di latar belakang meskipun terminal ditutup atau server di-restart, gunakan **Systemd** pada Linux.

### 1. Menggunakan Systemd (Linux)

1. **Buat File Konfigurasi Service**
   ```bash
   sudo nano /etc/systemd/system/netmanagement.service
   ```

2. **Salin Konfigurasi Berikut** *(sesuaikan `WorkingDirectory` jika lokasi folder berbeda)*:
   ```ini
   [Unit]
   Description=NetManagement Web Application
   After=network.target

   [Service]
   Type=simple
   User=root
   WorkingDirectory=/var/www/netmanagement
   ExecStart=/usr/bin/node /var/www/netmanagement/app.js
   Restart=always
   RestartSec=5
   Environment=NODE_ENV=production

   [Install]
   WantedBy=multi-user.target
   ```

3. **Aktifkan dan Jalankan Service**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now netmanagement
   sudo systemctl status netmanagement
   ```

4. **Perintah Manajemen Service Sehari-hari**
   - Melihat log aplikasi: `sudo journalctl -u netmanagement -f`
   - Restart setelah update kode (`git pull`): `sudo systemctl restart netmanagement`
   - Menghentikan aplikasi: `sudo systemctl stop netmanagement`

### 2. Menggunakan Nginx Reverse Proxy (Opsional)

Jika ingin mengakses aplikasi menggunakan domain atau tanpa mengetik `:3500` di belakang URL:

```nginx
server {
    listen 80;
    server_name netmgmt.domain-anda.local;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:3500;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Backup & Restore Data

Seluruh data aplikasi tersimpan pada dua lokasi berikut (keduanya diabaikan oleh Git agar data produksi aman saat `git pull`):

1. **Database SQLite**: Folder `database/` (`netmanagement.db`, `netmanagement.db-wal`, `netmanagement.db-shm`)
2. **File Foto Perangkat**: Folder `public/uploads/`

**Cara Melakukan Backup:**
1. Hentikan service sementara agar transaksi database tersimpan utuh ke file utama:
   ```bash
   sudo systemctl stop netmanagement
   ```
2. Arsipkan folder `database/` dan `public/uploads/`:
   ```bash
   tar -czvf backup-netmgmt-$(date +%Y%m%d).tar.gz database/ public/uploads/
   ```
3. Jalankan kembali aplikasi:
   ```bash
   sudo systemctl start netmanagement
   ```

---

## Struktur Direktori Proyek

```text
netmanagement/
├── controllers/          # Logika bisnis & handler request setiap fitur
├── database/             # File database SQLite (otomatis dibuat saat runtime)
├── middlewares/          # Autentikasi, validasi masa berlaku session, & konteks cabang
├── public/               # Aset statis frontend & folder uploads/
├── routes/               # Definisi endpoint routing Express
├── utils/                # Fungsi pembantu (audit logger, helper, dll.)
├── views/                # Template halaman antarmuka EJS
│   └── partials/         # Komponen layout (header, sidebar, footer)
├── .gitignore            # Daftar file/folder yang dikecualikan dari Git
├── app.js                # Entry point server Express (Port 3500)
├── db.js                 # Koneksi SQLite, skema tabel, & data seed awal
├── package.json          # Metadata proyek & daftar dependensi
└── README.md             # Dokumentasi instalasi & penggunaan
```

---

## Troubleshooting Umum

| Gejala / Error | Penyebab | Solusi |
| :--- | :--- | :--- |
| `gyp ERR! stack Error: not found: make` saat `npm install` | Server menggunakan Node.js versi terbaru tanpa *prebuilt binary* dan belum memiliki compiler C/C++. | Jalankan `sudo apt update && sudo apt install -y build-essential python3`, lalu ulangi `npm install`. |
| `Error: listen EADDRINUSE: address already in use 0.0.0.0:3500` | Port `3500` sudah digunakan oleh proses lain atau instance aplikasi sebelumnya masih berjalan. | Cek proses dengan `lsof -i :3500` atau `ss -tulpn \| grep 3500`, lalu hentikan proses lama sebelum menjalankan ulang. |
| `sh: 1: nodemon: not found` saat `npm run dev` | Paket `nodemon` belum terpasang secara lokal/global. | Gunakan perintah `node app.js` untuk menjalankan aplikasi. |
| Halaman tidak bisa dibuka dari komputer lain | Firewall pada server memblokir port `3500`. | Izinkan port `3500` pada firewall (contoh UFW: `sudo ufw allow 3500/tcp`). |