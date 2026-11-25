# Software Requirements Specification (SRS) — WonyAI v2.2

**Standar Referensi:** ISO/IEC/IEEE 29148 & IEEE 830  
**Versi Dokumen:** 2.2.0  
**Nama Sistem:** WonyAI — Personal AI Assistant for Daily Use  
**Kode Sumber Utama:** [`api/index.py`](file:///e:/WonyAI/api/index.py), [`public/index.html`](file:///e:/WonyAI/public/index.html), [`public/style.css`](file:///e:/WonyAI/public/style.css), [`public/app.js`](file:///e:/WonyAI/public/app.js), [`vercel.json`](file:///e:/WonyAI/vercel.json)

---

## 1. Pendahuluan (Introduction)

### 1.1 Tujuan Dokumen
Dokumen *Software Requirements Specification* (SRS) ini menetapkan spesifikasi kebutuhan fungsional (*Functional Requirements*) dan non-fungsional (*Non-Functional Requirements*) untuk **WonyAI v2.2** yang berjalan di atas arsitektur **Vercel Edge Static Frontend + Python FastAPI Serverless Backend**.

### 1.2 Ruang Lingkup Produk
WonyAI adalah asisten AI personal untuk penggunaan harian (*"Personal AI assistant for daily use"*) yang menyediakan:
1. Antarmuka web gelap minimalis bebas distraksi sesuai [`DESIGN.md`](file:///e:/WonyAI/DESIGN.md) yang disajikan melalui Vercel Edge CDN (`< 100ms` *initial load*, aktif 24/7).
2. Inferensi kecerdasan buatan menggunakan model flagship **`openai/gpt-oss-120b`** pada Groq Cloud dengan *auto-fallback* ke `qwen/qwen3.8-27b` dan `openai/gpt-oss-20b`.
3. Kesadaran waktu *real-time* (jam, menit, detik, hari, dan tanggal untuk zona waktu **WIB**, **WITA**, dan **WIT**) serta pemahaman bahasa gaul/singkatan Bahasa Indonesia.
4. Pencarian web kontekstual (*Contextual Web RAG* via DuckDuckGo) dan integrasi langsung ke **GitHub Public REST API** dengan verifikasi relevansi sumber (`<USED_SOURCES>`).
5. Sistem manajemen kuota berbasis token (**Guest Tier: 15.000 token/sesi** vs **4x Member Tier: 60.000 token/hari** yang dihitung langsung dari database Supabase) beserta *automatic JWT refresh*.

---

## 2. Kebutuhan Fungsional (Functional Requirements)

### 2.1 Navigasi, Tampilan & Manajemen Sesi (FR-UI)

| ID | Spesifikasi Kebutuhan | Implementasi |
|---|---|---|
| **FR-UI-01** | Halaman Landing harus menampilkan logo bundar [`/logo.jpg`](file:///e:/WonyAI/public/logo.jpg) (`92px`), judul `WonyAI`, subjudul `"Personal AI assistant for daily use."`, serta dua tombol seragam (`"Sign In / Create Account"` dan `"Continue as Guest"`) yang diposisikan tepat di tengah vertikal layar (*vertically centered*), dengan footer `"© 2026 WonyAI. All rights reserved. · emmanuel-abet-rossi-paays.vercel.app"` menempel di dasar layar. | [`public/index.html`](file:///e:/WonyAI/public/index.html), [`public/style.css`](file:///e:/WonyAI/public/style.css) |
| **FR-UI-02** | Sistem harus merender format Markdown secara lengkap di ruang chat, meliputi paragraf, *heading* (`#` s.d. `####`), *blockquote* (`>`), daftar berurut/tidak berurut, blok kode, *inline code*, **Tabel Markdown (`<table>`)**, serta **Source Pills** yang rapi di bagian bawah pesan. | [`renderMarkdown()`](file:///e:/WonyAI/public/app.js#L394-L545) |
| **FR-UI-03** | Pesan dari asisten AI harus menampilkan avatar foto profil bundar [`/logo.jpg`](file:///e:/WonyAI/public/logo.jpg). | [`renderMessages()`](file:///e:/WonyAI/public/app.js#L580-L606) |

### 2.2 Autentikasi, Auto-Refresh JWT & Keamanan Sesi (FR-AUTH)

| ID | Spesifikasi Kebutuhan | Implementasi |
|---|---|---|
| **FR-AUTH-01** | Pengguna harus dapat mendaftar dan masuk menggunakan email dan password (minimal 6 karakter) melalui Supabase Auth, yang mengembalikan `token` (`access_token`) dan `refresh_token`. | `api_signin()`, `api_signup()` |
| **FR-AUTH-02** | Apabila `access_token` pengguna kedaluwarsa (`HTTP 401`), aplikasi klien harus otomatis memanggil `POST /api/auth/refresh` menggunakan `refresh_token` di latar belakang dan mengulang request tanpa memutus sesi pengguna. | `tryRefreshAuthToken()`, `api_refresh_token()` |
| **FR-AUTH-03** | Server wajib memverifikasi secara kriptografis bahwa klaim `sub` di dalam token JWT cocok dengan `user_id` (berformat UUID v4 valid) dan belum melewati waktu `exp` sebelum mengizinkan akses ke `/api/sessions` atau memberikan kuota `4x Member Tier`. | `_verify_jwt_user_id()`, `_is_valid_uuid()` |

### 2.3 Sistem Kuota Token Dual-Tier (FR-QUOTA)

| ID | Spesifikasi Kebutuhan | Implementasi |
|---|---|---|
| **FR-QUOTA-01** | Sistem harus menerapkan pembatasan kuota murni berbasis **Token** (tanpa batas jumlah pesan), yaitu **15.000 token** untuk **Guest Tier** dan **60.000 token (4x lipat)** untuk **4x Member Tier**. | `TIER_QUOTAS` di [`api/index.py`](file:///e:/WonyAI/api/index.py#L101-L116) |
| **FR-QUOTA-02** | Kuota **Guest Tier** harus disimpan *in-memory* per sesi halaman sehingga otomatis ter-reset kembali ke `0` setiap kali halaman di-*refresh* atau pengguna memulai sesi Guest baru. | `guestTokensUsed` di [`public/app.js`](file:///e:/WonyAI/public/app.js) |
| **FR-QUOTA-03** | Kuota **4x Member Tier** harus dihitung langsung oleh server dari total panjang pesan pengguna & asisten di tabel `wonyai_sessions` Supabase sejak pukul `00:00 WIB` hari tersebut (`db_get_today_tokens`), sehingga tersinkronisasi lintas perangkat dan tidak dapat di-reset lewat *Incognito* atau penghapusan `localStorage`. | `db_get_today_tokens()` di [`api/index.py`](file:///e:/WonyAI/api/index.py#L341-L372) |
| **FR-QUOTA-04** | Status kuota token *real-time* pengguna (tier aktif, token terpakai, sisa token, dan persentase) harus disuntikkan ke dalam `SYSTEM_PROMPT` agar AI dapat menjawab dengan akurat saat pengguna menanyakan sisa limit/tokennya. | `_build_system_prompt()` |

### 2.4 Contextual Web RAG, GitHub Lookup & Jam Real-Time (FR-INTEL)

| ID | Spesifikasi Kebutuhan | Implementasi |
|---|---|---|
| **FR-INTEL-01** | Setiap request chat harus menyertakan waktu *real-time* dalam zona **WIB (UTC+7)**, **WITA (UTC+8)**, dan **WIT (UTC+9)** hingga satuan detik ke dalam `SYSTEM_PROMPT`. | `_get_live_indonesian_clock()` |
| **FR-INTEL-02** | *Smart Search Router* (`_resolve_search_query`) harus melewati pencarian web (`NO_SEARCH`) untuk sapaan, pertanyaan identitas AI, pertanyaan jam/kuota internal, koding, matematika, dan obrolan kasual; serta wajib menggunakan tahun berjalan (`2026`) untuk kueri peristiwa terbaru/terakhir. | `_resolve_search_query()` |
| **FR-INTEL-03** | Apabila kueri menyebut `manuelnyx` atau akun/URL GitHub, sistem harus mengambil profil dan daftar repositori publik secara langsung dari **GitHub REST API (`api.github.com`)**. | `_fetch_github_profile_and_repos()` |
| **FR-INTEL-04** | Sistem hanya boleh menampilkan *Source Pills* (`**Sumber:**`) untuk item hasil pencarian yang benar-benar diverifikasi dan digunakan oleh model utama 120B melalui tag `<USED_SOURCES: ...>`. | `_extract_used_sources()` |

---

## 3. Kebutuhan Non-Fungsional (Non-Functional Requirements)

- **NFR-PERF-01 (Zero Cold-Boot UI & Low Latency LLM)**: Aset statis disajikan melalui Vercel Edge CDN (`< 100ms`), koneksi HTTPS backend menggunakan *connection pooling* (`HTTPAdapter` + `Retry`), dan inferensi 120B menggunakan `reasoning_effort="low"` untuk waktu respons rata-rata `1–2.5 detik`.
- **NFR-SEC-01 (OWASP Hardening)**: Dilengkapi *Server-Side Sliding-Window IP Rate Limiter* (`20 req/menit/IP`), sanitasi *prompt delimiter injection*, penonaktifan `/docs` & `/openapi.json` di produksi, serta header HTTP `X-Frame-Options: DENY` dan `X-Content-Type-Options: nosniff`.
