# WonyAI

Personal AI assistant for daily use — engineered with a **Vercel Edge Static Frontend** and **Python FastAPI Serverless Backend**, powered by **Groq Cloud (`openai/gpt-oss-120b`)**, **Contextual Web & GitHub RAG**, and **Supabase Persistent Memory**.

## Key Features

- **24/7 Edge Static UI + Serverless Backend**: Instant `< 100ms` initial page load via Vercel Edge CDN with zero cold-boot hibernation or WebSocket disconnects.
- **120B Flagship AI Engine**: Powered by `openai/gpt-oss-120b` (with automatic fallback to `qwen/qwen3.8-27b` and `openai/gpt-oss-20b`), native Indonesian slang comprehension, and real-time **WIB / WITA / WIT** system clock awareness.
- **Smart Intent-Routed Web & GitHub RAG**:
  - Contextual search query rewriter (`_resolve_search_query`) that skips web search on casual conversation/coding and resolves follow-up questions using prior context.
  - Direct **GitHub REST API (`api.github.com`)** integration for verifying developer profiles and public repositories in real time.
  - **120B Source Relevance Verification (`<USED_SOURCES>`)**: Only displays source pills that were genuinely used in the final answer.
- **Dual-Tier Token Quota System**:
  - **Guest Tier**: `15,000 tokens` per session (in-memory, resets on browser refresh).
  - **4x Member Tier (Signed-In Account)**: `60,000 tokens` per day (tracked authoritatively in Supabase PostgreSQL across devices) + persistent chatroom memory and automatic background JWT refresh (`/api/auth/refresh`).
- **OWASP Security Hardening**: Cryptographic JWT `sub` & UUID v4 anti-IDOR verification, server-side sliding-window IP rate limiter, prompt delimiter sanitization, strict Markdown XSS escaping, and defensive HTTP security headers.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend SPA | Vanilla HTML5, CSS3, ES6 JavaScript (`public/`) |
| Serverless Backend | Python FastAPI (`api/index.py`) |
| AI Inference | Groq Cloud API (`openai/gpt-oss-120b` / `qwen/qwen3.8-27b` / `openai/gpt-oss-20b`) |
| Live RAG | DuckDuckGo (`ddgs` + Instant Answer API) & GitHub Public REST API |
| Auth & Database | Supabase (GoTrue JWT Auth + PostgREST PostgreSQL with RLS) |
| Hosting & CDN | Vercel |

## Project Structure

```text
WonyAI/
├── api/
│   └── index.py           # FastAPI Serverless Backend (120B LLM, Contextual RAG, Supabase, Security)
├── public/
│   ├── index.html         # Single-page responsive app shell (Landing, Auth, Chat Workspace)
│   ├── style.css          # Anti-slop dark UI tokens & cross-device responsive layout
│   ├── app.js             # Client state machine, Markdown/Table renderer, auto-refresh JWT, quota bar
│   └── logo.jpg           # Brand avatar & favicon
├── docs/
│   ├── ARCHITECTURE.md    # System Architecture Design (C4, Sequence, ERD, Security)
│   ├── BLUEPRINT.md       # Technical Engineering Blueprint
│   ├── SRS.md             # Software Requirements Specification (ISO/IEC/IEEE 29148)
│   └── PRD.md             # Product Requirements Document
├── DESIGN.md              # UI/UX Design System Source of Truth
├── vercel.json            # Vercel Serverless rewrites & HTTP security headers
├── requirements.txt       # Python dependencies
└── README.md
```

## Local Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/manuelnyx/WonyAI.git
   cd WonyAI
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure `.env.local`**
   ```env
   GROQ_API_KEY="your_groq_api_key"
   SUPABASE_URL="https://your-project.supabase.co"
   SUPABASE_KEY="your_supabase_anon_key"
   ```

4. **Run locally**
   ```bash
   uvicorn api.index:app --reload --port 8000
   ```
   Open `http://localhost:8000` in your browser.

---

&copy; 2026 WonyAI. All rights reserved. · Created by [Emmanuel Abet Rossi Paays](https://emmanuel-abet-rossi-paays.vercel.app/)
