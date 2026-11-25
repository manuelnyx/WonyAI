# Technical Blueprint — WonyAI v2.2

**Versi Dokumen:** 2.2.0  
**Target Sistem:** WonyAI Personal AI Assistant (Vercel Serverless + Edge Static SPA)  
**Referensi Implementasi:** [`api/index.py`](file:///e:/WonyAI/api/index.py), [`public/index.html`](file:///e:/WonyAI/public/index.html), [`public/style.css`](file:///e:/WonyAI/public/style.css), [`public/app.js`](file:///e:/WonyAI/public/app.js), [`DESIGN.md`](file:///e:/WonyAI/DESIGN.md)

---

## 1. Tujuan Blueprint

Dokumen **Technical Blueprint** ini merinci mekanisme rekayasa internal, mesin status navigasi (*client state machine*), spesifikasi *Dual-Tier Token Quota*, pipeline *Contextual Web & GitHub RAG* dengan verifikasi sumber `<USED_SOURCES>`, serta sistem desain *Anti-Slop* pada **WonyAI v2.2**.

---

## 2. Mesin Status Navigasi & Sesi Klien (`public/app.js`)

```mermaid
stateDiagram-v2
    [*] --> Landing : init() -> loadStoredState()

    state "Landing View (#view-landing)" as Landing {
        [*] --> CenteredHero : Logo 92px + WonyAI + Tagline + Uniform CTAs
        CenteredHero --> BottomFooter : Pinned Copyright Footer
    }

    state "Auth View (#view-auth)" as Auth {
        [*] --> AuthTabs : Tab Sign In / Create Account
    }

    state "Chat Workspace (#view-chat)" as Chat {
        [*] --> SidebarMeter : Render Token Usage Bar + Recent Sessions
        SidebarMeter --> ChatStream : Render Messages, Tables, & Source Pills
    }

    Landing --> Auth : Klik "Sign In / Create Account"
    Landing --> Chat : Klik "Continue as Guest" (guestMode=true, guestTokensUsed=0)
    Landing --> Chat : Auto-Redirect jika authToken aktif

    Auth --> Landing : Klik "Back"
    Auth --> Chat : Login / Signup Sukses (Simpan authToken & refreshToken)
    Auth --> Chat : Klik "Continue as Guest instead"

    Chat --> Auth : Token Expired & Refresh Gagal
    Chat --> Landing : Klik "Sign Out" (resetToLanding)
```

---

## 3. Blueprint Sistem Kuota Dual-Tier (Guest Tier vs 4x Member Tier)

WonyAI menggunakan sistem kuota berbasis **Visible Token Accounting** (hanya menghitung token dari teks prompt pengguna dan jawaban asisten yang tampil di layar, tanpa membebankan *system prompt* atau *internal reasoning tokens* kepada pengguna):

| Parameter Kuota | Guest Tier | 4x Member Tier (Signed-In Account) |
|---|---|---|
| **Batas Token** | **15.000 Token / Sesi** | **60.000 Token / Hari** (4x Lipat Guest) |
| **Sumber Perhitungan & Reset** | *In-memory* (`guestTokensUsed`), otomatis kembali ke `0` saat browser di-*refresh* atau mulai sesi Guest baru. | Dihitung secara otoritatif oleh server dari tabel `wonyai_sessions` Supabase (`db_get_today_tokens`) sejak pukul `00:00 WIB` setiap hari. |
| **Batas Output Maks / Balasan** | `1.500` token | `4.096` token |
| **Memori Konteks Riwayat API** | `4` pesan terakhir | `10` pesan terakhir + tersimpan permanen lintas perangkat |
| **Pembaruan Sesi Login** | Ephemeral | Otomatis diperbarui di latar belakang melalui `POST /api/auth/refresh` (`refresh_token`) |

---

## 4. Blueprint Pipeline Inteligensi, Jam Real-Time & Contextual RAG

```mermaid
flowchart TD
    Input["1. User Prompt + Live Client Clock (WIB/WITA/WIT)"] --> Security["2. Security & Quota Gate\n- IP Rate Limit (20 req/min)\n- Strip Prompt Delimiters\n- Verify JWT Sub == User UUID\n- Check Token Quota (15k / 60k)"]
    
    Security --> FastFilter{"3. Zero-Latency Filter\n_GREET_OR_SELF_RE |\n_SELF_QUOTA_RE"}
    FastFilter -->|"Match\n(Sapaan / Identitas / Jam / Kuota)"| NoSearch["Skip Web Search (0ms)\nweb_results = []"]
    
    FastFilter -->|"Tidak Match"| Router["4a. Temporal-Aware LLM Search Router\nmodel: openai/gpt-oss-20b (reasoning_effort='low')\nResolves follow-ups & enforces Year 2026"]
    Router -->|"NO_SEARCH\n(Koding / Matematika / Kasual)"| NoSearch
    Router -->|"Standalone Search Query"| DualRAG["4b. Dual RAG Retriever\n- DDGS().text(clean_q, max_results=7)\n- GitHub API (/users/{u} & /repos) jika terdeteksi username GitHub"]
    
    NoSearch --> LLM120B["5. Main Flagship Inference\nmodel: openai/gpt-oss-120b (reasoning_effort='low')\nFallback: qwen/qwen3.8-27b -> gpt-oss-20b"]
    DualRAG --> LLM120B
    
    LLM120B --> SourceVerify["6. Source Relevance Verifier\n_extract_used_sources() parses <USED_SOURCES: 1, 2> or NONE\nStrips unused/unrelated links"]
```

---

## 5. Spesifikasi Endpoint REST API (`api/index.py`)

| Metode & Path | Fungsi Utama | Proteksi Keamanan |
|---|---|---|
| `GET /api/config` | Mengembalikan status konfigurasi (`memory_enabled`, `groq_configured`, `model`, `tiers`). | Read-only public config |
| `POST /api/auth/signin` | Autentikasi email & password ke Supabase GoTrue (`/auth/v1/token?grant_type=password`). | Validasi panjang & skema Pydantic |
| `POST /api/auth/signup` | Registrasi akun baru (`/auth/v1/signup`), mengembalikan `token` & `refresh_token`. | Validasi password $\ge 6$ karakter |
| `POST /api/auth/refresh` | Memperbarui `access_token` menggunakan `refresh_token` tanpa login ulang. | `_check_ip_rate_limit()` |
| `POST /api/auth/signout` | Mengakhiri sesi JWT di Supabase (`/auth/v1/logout`). | Bearer token header |
| `GET /api/sessions` | Mengambil daftar sesi pengguna + `today_tokens_used` dari Supabase. | `_verify_jwt_user_id()` + RLS |
| `GET /api/sessions/{session_id}` | Memuat riwayat pesan untuk satu `session_id`. | `_is_valid_uuid()` + `_verify_jwt_user_id()` |
| `DELETE /api/sessions/{session_id}` | Menghapus seluruh pesan dalam satu `session_id`. | `_is_valid_uuid()` + `_verify_jwt_user_id()` |
| `POST /api/chat` | Orkestrasi RAG, inferensi 120B, verifikasi sumber, simpan DB, dan hitung kuota token. | IP Rate Limit + JWT Verify + Quota Check + Sanitizer |
| `POST /api/title` | Membuat judul sesi 2–4 kata dalam Bahasa Indonesia secara asinkron. | `_check_ip_rate_limit()` |
