# Dokumentasi Desain Arsitektur Sistem (System Architecture Design) — WonyAI v2.2

**Versi Dokumen:** 2.2.0 (Vercel Edge Static + FastAPI Serverless Architecture)  
**Status:** Production / Live  
**Pemilik Produk:** Emmanuel Abet Rossi Paays ([emmanuel-abet-rossi-paays.vercel.app](https://emmanuel-abet-rossi-paays.vercel.app/))  
**Sumber Kode Utama:** [`api/index.py`](file:///e:/WonyAI/api/index.py), [`public/index.html`](file:///e:/WonyAI/public/index.html), [`public/style.css`](file:///e:/WonyAI/public/style.css), [`public/app.js`](file:///e:/WonyAI/public/app.js), [`vercel.json`](file:///e:/WonyAI/vercel.json)

---

## 1. Ringkasan Eksekutif Arsitektur

**WonyAI v2.2** adalah aplikasi asisten AI personal berbasis web (*cloud-native single-page application*) yang dibangun dengan arsitektur **Decoupled Edge Static Frontend (`public/`) + Python FastAPI Serverless Backend (`api/index.py`)** di atas platform **Vercel**. Sistem ini mengintegrasikan empat komponen layanan utama:
1. **Groq Cloud API (`openai/gpt-oss-120b` + Fallback `qwen/qwen3.8-27b` & `openai/gpt-oss-20b`)**: Mesin inferensi LLM flagship 120 miliar parameter dengan `reasoning_effort="low"` untuk latensi ~1–2 detik, ditambah router pencarian dan generator judul sesi otomatis.
2. **Contextual Web & GitHub RAG (`ddgs` + `api.github.com`)**: Mesin *Retrieval-Augmented Generation* (RAG) waktu-nyata yang dikendalikan oleh *Smart Intent Search Router* (`_resolve_search_query`), kamus ekspansi singkatan Bahasa Indonesia (`_expand_indonesian_slang`), integrasi langsung ke **GitHub REST API** untuk verifikasi profil/repositori developer, serta verifikasi relevansi sumber (`<USED_SOURCES>`) oleh model 120B.
3. **Supabase (GoTrue JWT Auth & PostgREST PostgreSQL)**: Layanan autentikasi berbasis JWT (dengan *automatic background token refresh* `/api/auth/refresh`), penyimpanan memori percakapan lintas perangkat dengan *Row-Level Security* (RLS), serta penghitungan kuota token harian berbasis database (`db_get_today_tokens`).
4. **HTTPS Connection Pooling & OWASP Security Layer**: Menggunakan `requests.Session()` dengan `HTTPAdapter(pool_connections=10, pool_maxsize=20)` + `Retry(total=3)`, validasi kriptografi klaim `sub` & `exp` JWT + UUID v4 anti-IDOR, *server-side sliding-window IP rate limiter*, dan sanitasi anti-*prompt injection* & anti-XSS.

---

## 2. Arsitektur Konteks Sistem (C4 Level 1 — System Context)

```mermaid
flowchart TB
    subgraph Users["Aktor Pengguna"]
        MemberUser["Member User (4x Member Tier)\n60.000 Token/Hari + Persistent Memory"]
        GuestUser["Guest User (Guest Tier)\n15.000 Token/Sesi (In-Memory)"]
    end

    subgraph VercelCloud["Vercel Cloud Platform"]
        EdgeCDN["Vercel Edge CDN\n(public/index.html, style.css, app.js, logo.jpg)"]
        FastAPI["Python Serverless Function\n(api/index.py + VercelPathNormalizeMiddleware)"]
    end

    subgraph ExternalServices["Layanan Eksternal (3rd-Party APIs)"]
        Groq["Groq Cloud API\n(Primary: openai/gpt-oss-120b\nFallback: qwen3.8-27b / gpt-oss-20b)"]
        SupabaseAuth["Supabase GoTrue Auth\n(/auth/v1/signup | token | logout)"]
        SupabaseDB["Supabase PostgREST PostgreSQL\n(/rest/v1/wonyai_sessions)"]
        DDG["DuckDuckGo Search & Instant API\n(ddgs + api.duckduckgo.com)"]
        GitHubAPI["GitHub Public REST API\n(api.github.com/users/*)"]
    end

    MemberUser <-->|"HTTPS (<100ms Static Load)"| EdgeCDN
    GuestUser <-->|"HTTPS (<100ms Static Load)"| EdgeCDN
    EdgeCDN <-->|"REST JSON (/api/*)"| FastAPI

    FastAPI -->|"Pooled HTTPS POST\n(Bearer GROQ_API_KEY)"| Groq
    FastAPI -->|"Pooled HTTPS POST\n(Auth & Refresh Token)"| SupabaseAuth
    FastAPI <-->|"RLS + UUID + JWT Sub Verified\n(Chat History & Daily Token Count)"| SupabaseDB
    FastAPI -->|"Contextual Search Query"| DDG
    FastAPI -->|"Live Profile & Repo Lookup"| GitHubAPI
```

---

## 3. Arsitektur Komponen Internal (C4 Level 2 — Component Architecture)

```mermaid
flowchart LR
    subgraph ClientSPA["1. Frontend SPA (public/)"]
        StateMachine["State & Route Guard\n(landing | auth | chat)"]
        QuotaUI["Token Usage Meter\n(Guest 15k vs Member 60k)"]
        MDParser["Line-by-Line Markdown Parser\n(Tables, Code, Headings, Source Pills)"]
        AuthInterceptor["Auto-Refresh JWT Interceptor\n(tryRefreshAuthToken)"]
    end

    subgraph ServerlessAPI["2. FastAPI Serverless Backend (api/index.py)"]
        PathMW["VercelPathNormalizeMiddleware\n& IP Rate Limiter (20 req/min)"]
        JWTGuard["Security & Anti-IDOR Guard\n_verify_jwt_user_id() | _is_valid_uuid()"]
        QuotaEngine["Authoritative Quota Engine\ndb_get_today_tokens() | TIER_QUOTAS"]
        SearchRouter["Smart Intent Search Router\n_resolve_search_query() | _SLANG_MAP"]
        RAGFetcher["Dual RAG Retriever\nsearch_web() | _fetch_github_profile_and_repos()"]
        Inference["Groq 120B Engine & Source Verifier\ncall_groq() | _extract_used_sources()"]
    end

    StateMachine --> AuthInterceptor
    AuthInterceptor --> PathMW
    QuotaUI --> PathMW
    PathMW --> JWTGuard
    JWTGuard --> QuotaEngine
    QuotaEngine --> SearchRouter
    SearchRouter --> RAGFetcher
    RAGFetcher --> Inference
    Inference --> MDParser
```

---

## 4. Aliran Pemrosesan Pesan, Contextual RAG & Verifikasi Sumber (Sequence Diagram)

```mermaid
sequenceDiagram
    autonumber
    actor User as Pengguna
    participant SPA as Frontend (public/app.js)
    participant API as FastAPI (api/index.py)
    participant Supa as Supabase (Auth & PostgREST)
    participant Router as Smart Search Router (20B)
    participant RAG as DuckDuckGo & GitHub API
    participant LLM as Groq Flagship (120B)

    User->>SPA: Ketik pesan & kirim ( beserta client_clock WIB/WITA/WIT )
    SPA->>API: POST /api/chat (prompt, history, session_id, used_tokens, client_clock)
    API->>API: Cek IP Rate Limit (20 req/min) & Sanitasi Prompt Delimiters
    alt Mode Terautentikasi (4x Member Tier)
        API->>API: _verify_jwt_user_id(token, user_id)
        API->>Supa: db_get_today_tokens() (Hitung token sejak 00:00 WIB)
        API->>Supa: db_save_message(role="user")
    else Guest Tier
        API->>API: Cek used_tokens < 15.000
    end
    API->>Router: _resolve_search_query(prompt, history, current_year=2026)
    alt Butuh Fakta Web / Berita / GitHub
        Router-->>API: Standalone Contextual Query (mis. "juara dunia MotoGP 2026")
        API->>RAG: Fetch DuckDuckGo (max 7) & GitHub API (jika ada username GitHub)
        RAG-->>API: web_results
    else Obrolan Santai / Jam / Kuota / Koding
        Router-->>API: None (NO_SEARCH)
    end
    API->>LLM: POST /chat/completions (openai/gpt-oss-120b, reasoning_effort="low")\n[Live Clock + Live Quota Status + Web Context + History]
    LLM-->>API: Raw Reply + Tag <USED_SOURCES: 1, 2> atau <USED_SOURCES: NONE>
    API->>API: _extract_used_sources() & clean_response() (Hanya tampilkan sumber yang dipakai)
    opt Mode Terautentikasi
        API->>Supa: db_save_message(role="assistant")
    end
    API-->>SPA: {reply, tokens_used, today_tokens_used, tier_quota}
    SPA->>SPA: Render Markdown/Tabel/Source Pills & Update Token Usage Bar (%)
```

---

## 5. Arsitektur Keamanan (OWASP Hardened Architecture)

| Lapisan Pertahanan | Mekanisme Teknis di [`api/index.py`](file:///e:/WonyAI/api/index.py) & [`public/app.js`](file:///e:/WonyAI/public/app.js) |
|---|---|
| **Anti-IDOR & JWT Verification** | Fungsi `_verify_jwt_user_id()` mendekode payload JWT Supabase, memverifikasi masa berlaku (`exp > time.time()`), dan memastikan klaim `sub` identik dengan parameter `user_id` berformat UUID v4 (`_is_valid_uuid()`). |
| **Authoritative Server-Side Quota** | Pengguna terautentikasi tidak bisa mereset kuota harian melalui *Incognito* atau *Clear Storage* karena `db_get_today_tokens()` menghitung langsung total token dari tabel `wonyai_sessions` di Supabase sejak pukul `00:00 WIB`. |
| **Per-IP Sliding Window Rate Limit** | `_check_ip_rate_limit()` membatasi maksimal 20 request/menit per alamat IP pada endpoint `/api/chat`, `/api/title`, dan `/api/auth/refresh`. |
| **Prompt & Delimiter Sanitization** | `_sanitize_prompt_delimiters()` menghapus tag internal `--- WEB SEARCH ---` dan `<USED_SOURCES>` dari input pengguna untuk mencegah manipulasi konteks RAG. |
| **XSS & HTTP Security Headers** | `escapeHtml()` + NUL-byte code-block sentinels di `public/app.js`, penonaktifan `/docs` & `/openapi.json` di produksi, serta header `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, dan `Permissions-Policy` di [`vercel.json`](file:///e:/WonyAI/vercel.json). |
