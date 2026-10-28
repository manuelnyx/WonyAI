"""
WonyAI — AI Assistant with Persistent Memory
Powered by Groq Cloud API (openai/gpt-oss-20b)
Created by Emmanuel Abet Rossi Paays
"""

import streamlit as st
import requests
import os
import re
import uuid

# ──────────────────────────────────────────────
# PAGE CONFIG
# ──────────────────────────────────────────────
st.set_page_config(
    page_title="WonyAI",
    page_icon="W",
    layout="wide",
    initial_sidebar_state="auto",
)

_VALID_PAGES = ("landing", "auth", "chat")
_PUBLIC_LOCK_CSS = """
[data-testid="stSidebar"],
[data-testid="stSidebarNav"],
[data-testid="stSidebarCollapse"],
[data-testid="stSidebarCollapseButton"],
[data-testid="stSidebarCollapsedControl"],
[data-testid="collapsedControl"],
[data-testid="stExpandSidebarButton"],
[data-testid="stChatInput"],
[data-testid="stBottom"],
[data-testid="stBottomBlockContainer"],
[data-testid="stChatFloatingInputContainer"],
[data-testid="stChatMessage"] {
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
    height: 0 !important;
    max-height: 0 !important;
    overflow: hidden !important;
    opacity: 0 !important;
}
[data-testid="stHeader"] { min-height: 0 !important; height: 0 !important; }
.block-container {
    max-width: min(32.5rem, 92vw) !important;
    padding: max(2.5rem, 8vh) clamp(1rem, 5vw, 2rem) 2rem !important;
}
"""


def _ensure_session() -> None:
    defaults = {
        "page": "landing",
        "auth_token": None,
        "user_id": None,
        "user_email": None,
        "guest_mode": False,
        "session_id": None,
        "messages": [],
        "chat_title": None,
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value
    if st.session_state.page not in _VALID_PAGES:
        st.session_state.page = "landing"
    if st.session_state.get("auth_token"):
        st.session_state.guest_mode = False
    if not isinstance(st.session_state.get("messages"), list):
        st.session_state.messages = []
    if not st.session_state.get("session_id"):
        st.session_state.session_id = str(uuid.uuid4())


def _can_chat() -> bool:
    return bool(st.session_state.get("auth_token") or st.session_state.get("guest_mode"))


def _go(page: str) -> None:
    st.session_state.page = page if page in _VALID_PAGES else "landing"
    st.rerun()


def _enter_chat(*, guest: bool = False, auth: dict | None = None) -> None:
    if auth:
        st.session_state.auth_token = auth.get("token")
        st.session_state.user_id = auth.get("user_id")
        st.session_state.user_email = auth.get("email")
        st.session_state.guest_mode = False
    elif guest:
        st.session_state.guest_mode = True
        st.session_state.auth_token = None
        st.session_state.user_id = None
        st.session_state.user_email = None
    st.session_state.session_id = str(uuid.uuid4())
    st.session_state.messages = []
    st.session_state.chat_title = None
    st.session_state.page = "chat"
    st.rerun()


def _reset_to_landing() -> None:
    st.session_state.auth_token = None
    st.session_state.user_id = None
    st.session_state.user_email = None
    st.session_state.guest_mode = False
    st.session_state.messages = []
    st.session_state.chat_title = None
    st.session_state.session_id = str(uuid.uuid4())
    st.session_state.page = "landing"
    st.rerun()


def _route_guard() -> None:
    page = st.session_state.page
    authed = bool(st.session_state.get("auth_token"))
    guest = bool(st.session_state.get("guest_mode"))
    if page == "chat" and not authed and not guest:
        st.session_state.page = "landing"
        st.rerun()
    if page == "auth" and authed:
        st.session_state.page = "chat"
        st.rerun()
    if page == "landing" and authed:
        st.session_state.page = "chat"
        st.rerun()


def _inject_css(page: str) -> None:
    css_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "style.css")
    try:
        with open(css_path, encoding="utf-8") as f:
            css = f.read()
    except OSError:
        css = ""
    extra = _PUBLIC_LOCK_CSS if page in ("landing", "auth") else ""
    st.markdown(
        f"""<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
{css}
{extra}
</style>""",
        unsafe_allow_html=True,
    )


_ensure_session()
_route_guard()
_inject_css(st.session_state.page)

# ──────────────────────────────────────────────
# CONSTANTS
# ──────────────────────────────────────────────
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL   = "openai/gpt-oss-20b"
LOGO_URL     = "https://emmanuel-abet-rossi-paays.vercel.app/logo.png"

SYSTEM_PROMPT = (
    "You are WonyAI, an intelligent and focused AI assistant. "
    "You are knowledgeable, articulate, and precise. "
    "You provide clear, well-structured answers and adapt naturally to whatever the user needs — "
    "whether that's coding, analysis, writing, or general questions. "
    "Be concise when brevity is appropriate, and thorough when depth is needed. "
    "Maintain a professional yet approachable tone. "
    "When live web search results are provided, use them as the primary source for current facts "
    "and do not rely on training-data cutoff."
)

# ──────────────────────────────────────────────
# CREDENTIALS
# ──────────────────────────────────────────────
def _get_secret(key: str) -> str | None:
    val = None
    try:
        val = st.secrets.get(key)
    except Exception:
        pass
    return val or os.getenv(key)

GROQ_API_KEY   = _get_secret("GROQ_API_KEY")
SUPABASE_URL   = _get_secret("SUPABASE_URL")
SUPABASE_KEY   = _get_secret("SUPABASE_KEY")
MEMORY_ENABLED = bool(SUPABASE_URL and SUPABASE_KEY)

_SUPA_TABLE = "wonyai_sessions"

# ──────────────────────────────────────────────
# SUPABASE HEADERS
# ──────────────────────────────────────────────
def _anon_headers() -> dict:
    return {
        "apikey":        SUPABASE_KEY or "",
        "Authorization": f"Bearer {SUPABASE_KEY or ''}",
        "Content-Type":  "application/json",
    }

def _user_headers(prefer_return: bool = False) -> dict:
    """Use authenticated user JWT for RLS-scoped queries."""
    token = st.session_state.get("auth_token") or SUPABASE_KEY or ""
    h = {
        "apikey":        SUPABASE_KEY or "",
        "Authorization": f"Bearer {token}",
        "Content-Type":  "application/json",
    }
    if prefer_return:
        h["Prefer"] = "return=minimal"
    return h

# ──────────────────────────────────────────────
# SUPABASE AUTH
# ──────────────────────────────────────────────
def auth_signup(email: str, password: str) -> dict:
    if not MEMORY_ENABLED:
        return {"error": "Supabase not configured."}
    try:
        r = requests.post(
            f"{SUPABASE_URL}/auth/v1/signup",
            headers=_anon_headers(),
            json={"email": email, "password": password},
            timeout=15,
        )
        data = r.json()
        if r.ok and data.get("access_token"):
            return {
                "token":   data["access_token"],
                "user_id": data["user"]["id"],
                "email":   data["user"]["email"],
            }
        msg = (data.get("msg") or data.get("message")
               or data.get("error_description") or "Signup failed.")
        return {"error": msg}
    except Exception as e:
        return {"error": str(e)}

def auth_signin(email: str, password: str) -> dict:
    if not MEMORY_ENABLED:
        return {"error": "Supabase not configured."}
    try:
        r = requests.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
            headers=_anon_headers(),
            json={"email": email, "password": password},
            timeout=15,
        )
        data = r.json()
        if r.ok and data.get("access_token"):
            return {
                "token":   data["access_token"],
                "user_id": data["user"]["id"],
                "email":   data["user"]["email"],
            }
        msg = (data.get("msg") or data.get("message")
               or data.get("error_description") or "Login failed. Check your credentials.")
        return {"error": msg}
    except Exception as e:
        return {"error": str(e)}

def auth_signout(token: str) -> None:
    if not MEMORY_ENABLED or not token:
        return
    try:
        requests.post(
            f"{SUPABASE_URL}/auth/v1/logout",
            headers={**_anon_headers(), "Authorization": f"Bearer {token}"},
            timeout=10,
        )
    except Exception:
        pass

# ──────────────────────────────────────────────
# SUPABASE DB HELPERS
# ──────────────────────────────────────────────
def db_load_history(session_id: str) -> list[dict]:
    if not MEMORY_ENABLED:
        return []
    user_id = st.session_state.get("user_id")
    if not user_id:
        return []
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/{_SUPA_TABLE}",
            headers=_user_headers(),
            params={
                "session_id": f"eq.{session_id}",
                "user_id":    f"eq.{user_id}",
                "select":     "role,content",
                "order":      "created_at.asc",
            },
            timeout=10,
        )
        if r.ok:
            return r.json()
    except Exception:
        pass
    return []

def db_save_message(session_id: str, role: str, content: str) -> None:
    if not MEMORY_ENABLED:
        return
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/{_SUPA_TABLE}",
            headers=_user_headers(prefer_return=True),
            json={
                "session_id": session_id,
                "role":       role,
                "content":    content,
                "user_id":    st.session_state.get("user_id"),
            },
            timeout=10,
        )
    except Exception:
        pass

def db_list_sessions() -> list[dict]:
    """Return sessions for the logged-in user, filtered by user_id explicitly."""
    if not MEMORY_ENABLED:
        return []
    user_id = st.session_state.get("user_id")
    if not user_id:
        return []
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/{_SUPA_TABLE}",
            headers=_user_headers(),
            params={
                "select":  "session_id,content",
                "role":    "eq.user",
                "user_id": f"eq.{user_id}",
                "order":   "created_at.asc",
            },
            timeout=10,
        )
        if r.ok:
            seen = {}
            for row in r.json():
                sid = row["session_id"]
                if sid not in seen:
                    seen[sid] = row["content"][:50].strip()
            return [{"session_id": k, "title": v} for k, v in seen.items()]
    except Exception:
        pass
    return []

def db_delete_session(session_id: str) -> None:
    if not MEMORY_ENABLED:
        return
    user_id = st.session_state.get("user_id")
    if not user_id:
        return
    try:
        requests.delete(
            f"{SUPABASE_URL}/rest/v1/{_SUPA_TABLE}",
            headers=_user_headers(prefer_return=True),
            params={
                "session_id": f"eq.{session_id}",
                "user_id":    f"eq.{user_id}",
            },
            timeout=10,
        )
    except Exception:
        pass

# ──────────────────────────────────────────────
# RAG WEB SEARCH (DuckDuckGo)
# ──────────────────────────────────────────────
def search_web(query: str, max_results: int = 3) -> list[dict]:
    """Ambil hingga 3 snippet ringkas dari DuckDuckGo."""
    try:
        from duckduckgo_search import DDGS
        results = []
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=max_results):
                title = (r.get("title") or "").strip()
                snippet = (r.get("body") or "").strip()
                href = (r.get("href") or "").strip()
                if not (title or snippet or href):
                    continue
                results.append({"title": title, "snippet": snippet, "href": href})
                if len(results) >= max_results:
                    break
        return results
    except Exception:
        return []


def _format_web_context(results: list[dict]) -> str:
    if not results:
        return ""
    lines = []
    for i, item in enumerate(results, 1):
        lines.append(
            f"{i}. {item['title']}\n"
            f"   {item['snippet']}\n"
            f"   URL: {item['href']}"
        )
    return "\n".join(lines)


def _format_web_sources(results: list[dict]) -> str:
    links = []
    for item in results:
        href = item.get("href") or ""
        if not href:
            continue
        title = item.get("title") or href
        links.append(f"[{title}]({href})")
    if not links:
        return ""
    return "**Sumber:** " + " · ".join(links)


# ──────────────────────────────────────────────
# GROQ API
# ──────────────────────────────────────────────
def call_groq(messages: list, api_key: str) -> str:
    try:
        r = requests.post(
            GROQ_API_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model":       GROQ_MODEL,
                "messages":    messages,
                "temperature": 0.7,
                "max_tokens":  2048,
                "top_p":       0.9,
            },
            timeout=60,
        )
    except requests.exceptions.Timeout:
        return "Request timed out. Please try again."
    except requests.exceptions.ConnectionError:
        return "Connection error. Please check your internet."
    except Exception as e:
        return f"Unexpected error: {e}"

    if not r.ok:
        status = r.status_code
        try:
            err = r.json()
            msg = err.get("error", {}).get("message") or err.get("message") or r.text[:300]
        except Exception:
            msg = r.text[:300] or "No details."
        if status == 401:
            return f"Authentication failed (401). Check your Groq API key.\n\n`{msg}`"
        elif status == 429:
            return f"Rate limit reached (429). Please wait a moment.\n\n`{msg}`"
        else:
            return f"API Error (HTTP {status}): {msg}"

    try:
        return r.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, ValueError) as e:
        return f"Unexpected response format: {e}"

# ──────────────────────────────────────────────
# RESPONSE CLEANUP
# ──────────────────────────────────────────────
def clean_response(text: str) -> str:
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'<p[^>]*>', '\n\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</p>', '', text, flags=re.IGNORECASE)
    text = re.sub(r'<(b|strong)[^>]*>(.*?)</(b|strong)>', r'**\2**', text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r'<(i|em)[^>]*>(.*?)</(i|em)>', r'*\2*', text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r'<[^>]+>', '', text)
    return text.strip()

# ──────────────────────────────────────────────
# SMART SEARCH GATE
# ──────────────────────────────────────────────
_GREET_RE = re.compile(
    r'^(halo|hai|hi|hello|hey|hei|ey|yo|woi|woy|selamat|assalamu|'
    r'good\s*(morning|afternoon|evening|night)|apa kabar|how are you|'
    r'howdy|sup|wassup|pagi|siang|sore|malam)\b',
    re.IGNORECASE,
)

def _should_search(query: str) -> bool:
    """Return True only when a web search adds value."""
    q = query.strip()
    if len(q) <= 12:
        return False
    if _GREET_RE.match(q) and len(q.split()) <= 8:
        return False
    return True


# ──────────────────────────────────────────────
# AI TITLE GENERATION
# ──────────────────────────────────────────────
def generate_title(first_message: str, api_key: str) -> str:
    """Generate a concise 3-5 word chat title via Groq."""
    try:
        r = requests.post(
            GROQ_API_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model":       GROQ_MODEL,
                "messages":   [
                    {
                        "role":    "system",
                        "content": (
                            "Generate a concise 3-5 word title for this chat. "
                            "Reply with the title only. No quotes, no punctuation at end. "
                            "Example: 'Python async tutorial', 'Resep nasi goreng'"
                        ),
                    },
                    {"role": "user", "content": first_message[:300]},
                ],
                "max_tokens":  15,
                "temperature": 0.3,
            },
            timeout=8,
        )
        if r.ok:
            title = r.json()["choices"][0]["message"]["content"].strip().strip('"\'')
            return title[:60] if title else first_message[:40].strip()
    except Exception:
        pass
    return first_message[:40].strip()

# ══════════════════════════════════════════════════════════════
# LANDING PAGE
# ══════════════════════════════════════════════════════════════
if st.session_state.page == "landing":
    # Logo — centered via HTML
    st.markdown(f"""
    <div style="text-align:center; margin-bottom:1.25rem;">
        <img src="{LOGO_URL}" style="width:84px; height:84px; border-radius:50%;
             border:2px solid #2a2a2a; object-fit:cover;" />
    </div>
    """, unsafe_allow_html=True)

    # Title + tagline
    st.markdown("""
    <div style="text-align:center; margin:0 0 0.5rem;
                font-family:'Inter',sans-serif;">
        <div style="font-size:2rem; font-weight:700; color:#f1f5f9;
                    letter-spacing:-0.04em;">WonyAI</div>
        <div style="font-size:0.9rem; color:#64748b; margin-top:0.45rem; line-height:1.6;">
            Personal AI assistant. Clear answers, real web data, built for daily use.
        </div>
    </div>
    <div style="display:flex; justify-content:center; gap:2.5rem;
                margin:1.75rem 0 2.25rem; font-family:'Inter',sans-serif;">
        <div style="text-align:center;">
            <div style="font-size:0.72rem; color:#dc2626; font-weight:600;
                        text-transform:uppercase; letter-spacing:0.06em;">Web-Aware</div>
            <div style="font-size:0.72rem; color:#475569; margin-top:0.2rem;">Live search via DuckDuckGo</div>
        </div>
        <div style="text-align:center;">
            <div style="font-size:0.72rem; color:#dc2626; font-weight:600;
                        text-transform:uppercase; letter-spacing:0.06em;">Memory</div>
            <div style="font-size:0.72rem; color:#475569; margin-top:0.2rem;">Saves per user</div>
        </div>
        <div style="text-align:center;">
            <div style="font-size:0.72rem; color:#dc2626; font-weight:600;
                        text-transform:uppercase; letter-spacing:0.06em;">Personal</div>
            <div style="font-size:0.72rem; color:#475569; margin-top:0.2rem;">By Emmanuel Paays</div>
        </div>
    </div>
    """, unsafe_allow_html=True)

    col1, col2, col3 = st.columns([1, 2, 1])
    with col2:
        if st.button("Sign In / Create Account", use_container_width=True):
            st.session_state.guest_mode = False
            _go("auth")
        st.markdown(
            "<div style='text-align:center;margin:0.4rem 0;font-size:0.73rem;color:#767676;'>or</div>",
            unsafe_allow_html=True)
        if st.button("Continue as Guest", use_container_width=True):
            _enter_chat(guest=True)

    st.markdown("""
    <div style="text-align:center; margin-top:2rem; font-size:0.68rem; color:#767676;
                font-family:'Inter',sans-serif;">
        Powered by <span style="color:#dc2626;">Groq</span>
        &nbsp;&middot;&nbsp;
        <a href="https://emmanuel-abet-rossi-paays.vercel.app/"
           style="color:#767676; text-decoration:none;">
           emmanuel-abet-rossi-paays.vercel.app</a>
    </div>
    """, unsafe_allow_html=True)

    st.stop()

# ══════════════════════════════════════════════════════════════
# AUTH PAGE — Sign In / Create Account
# ══════════════════════════════════════════════════════════════
if st.session_state.page == "auth":
    # Logo — centered via HTML
    st.markdown(f"""
    <div style="text-align:center; margin-bottom:1rem;">
        <img src="{LOGO_URL}" style="width:56px; height:56px; border-radius:50%;
             border:2px solid #2a2a2a; object-fit:cover;" />
    </div>
    """, unsafe_allow_html=True)

    st.markdown("""
    <div style="text-align:center; margin:1rem 0 1.75rem; font-family:'Inter',sans-serif;">
        <div style="font-size:1.3rem; font-weight:700; color:#f1f5f9;">
            Sign in to WonyAI</div>
        <div style="font-size:0.8rem; color:#64748b; margin-top:0.3rem;">
            Your conversations are private and saved across devices.
        </div>
    </div>
    """, unsafe_allow_html=True)

    if not MEMORY_ENABLED:
        st.warning("Supabase is not configured. Add SUPABASE_URL and SUPABASE_KEY to Streamlit Secrets.")
        st.stop()

    tab_login, tab_register = st.tabs(["Sign In", "Create Account"])

    with tab_login:
        with st.form("form_login"):
            email_in = st.text_input("Email", placeholder="you@email.com", key="login_email")
            pass_in  = st.text_input("Password", type="password", placeholder="••••••••", key="login_pass")
            submitted_login = st.form_submit_button("Sign In", use_container_width=True)
        if submitted_login:
            if email_in and pass_in:
                with st.spinner("Signing in..."):
                    result = auth_signin(email_in.strip(), pass_in)
                if "error" in result:
                    st.error(result["error"])
                else:
                    _enter_chat(auth=result)
            else:
                st.warning("Please enter email and password.")

    with tab_register:
        with st.form("form_register"):
            email_up = st.text_input("Email", placeholder="you@email.com", key="reg_email")
            pass_up  = st.text_input("Password", type="password",
                                      placeholder="Min. 6 characters", key="reg_pass")
            submitted_reg = st.form_submit_button("Create Account", use_container_width=True)
        if submitted_reg:
            if email_up and pass_up:
                if len(pass_up) < 6:
                    st.warning("Password must be at least 6 characters.")
                else:
                    with st.spinner("Creating account..."):
                        result = auth_signup(email_up.strip(), pass_up)
                    if "error" in result:
                        st.error(result["error"])
                    else:
                        _enter_chat(auth=result)
            else:
                st.warning("Please fill in all fields.")

    st.markdown("<br>", unsafe_allow_html=True)
    col1, col2, col3 = st.columns([1, 2, 1])
    with col2:
        if st.button("Continue as Guest instead", use_container_width=True):
            _enter_chat(guest=True)
        if st.button("Back", use_container_width=True):
            _go("landing")
    st.stop()

# ══════════════════════════════════════════════════════════════
# CHAT PAGE ONLY — no sidebar / input / history on landing or auth
# ══════════════════════════════════════════════════════════════
if st.session_state.page != "chat" or not _can_chat():
    st.session_state.page = "landing"
    st.rerun()

# ══════════════════════════════════════════════════════════════
# SIDEBAR — Chat page only
# ══════════════════════════════════════════════════════════════
with st.sidebar:
    user_email  = st.session_state.get("user_email", "")
    is_guest    = st.session_state.get("guest_mode", False)

    st.markdown(f"""
    <div style="padding:0 0.5rem 1.25rem; font-family:'Inter',sans-serif;">
        <div style="font-size:1.1rem; font-weight:700; color:#f1f5f9;
                    letter-spacing:-0.02em;">WonyAI</div>
        <div style="font-size:0.7rem; color:#767676; margin-top:0.2rem;">
            {'Guest mode' if is_guest else user_email}
        </div>
    </div>
    <div style="height:1px; background:#2a2a2a; margin-bottom:1.25rem;"></div>
    """, unsafe_allow_html=True)

    if st.button("+ New Chat", use_container_width=True):
        st.session_state.session_id = str(uuid.uuid4())
        st.session_state.messages   = []
        st.session_state.chat_title = None
        st.toast("New chat started.")
        st.rerun()

    if is_guest:
        # Guest mode: no history, prompt to sign in
        st.markdown("""
        <div style="margin-top:1.25rem; padding:0.75rem; background:#1a1a1a;
                    border:1px solid #2a2a2a; border-radius:8px;
                    font-size:0.75rem; color:#64748b; line-height:1.6;">
            You are in <b style="color:#94a3b8;">Guest mode</b>.<br>
            Conversations are not saved.<br><br>
            Sign in to save history across devices.
        </div>
        """, unsafe_allow_html=True)
        st.markdown("<br>", unsafe_allow_html=True)
        if st.button("Sign In / Create Account", use_container_width=True):
            st.session_state.guest_mode = False
            _go("auth")
    else:
        st.markdown(
            '<div style="font-size:0.7rem; color:#767676; margin:1.25rem 0 0.5rem;'
            'text-transform:uppercase; letter-spacing:0.06em;">Recent</div>',
            unsafe_allow_html=True,
        )
        sessions = db_list_sessions()
        if sessions:
            for s in reversed(sessions[-15:]):
                col1, col2 = st.columns([5, 1])
                with col1:
                    # For current session, prefer AI-generated title
                    raw = s["title"]
                    if s["session_id"] == st.session_state.session_id and st.session_state.get("chat_title"):
                        raw = st.session_state.chat_title
                    label = raw + "..." if len(raw) >= 40 else raw
                    if st.button(label, key=f"sess_{s['session_id']}", use_container_width=True):
                        st.session_state.session_id = s["session_id"]
                        st.session_state.messages   = db_load_history(s["session_id"])
                        st.session_state.chat_title = None
                        st.rerun()
                with col2:
                    if st.button("\U0001f5d1", key=f"del_{s['session_id']}"):
                        db_delete_session(s["session_id"])
                        if s["session_id"] == st.session_state.session_id:
                            st.session_state.session_id = str(uuid.uuid4())
                            st.session_state.messages   = []
                            st.session_state.chat_title = None
                        st.rerun()
        else:
            st.markdown(
                '<div style="font-size:0.75rem; color:#767676; padding:0.25rem 0.5rem;">'
                'No conversations yet.</div>',
                unsafe_allow_html=True,
            )

        st.markdown("<br>", unsafe_allow_html=True)
        st.markdown('<div class="sign-out-btn">', unsafe_allow_html=True)
        if st.button("Sign Out", use_container_width=True):
            auth_signout(st.session_state.get("auth_token"))
            _reset_to_landing()
        st.markdown('</div>', unsafe_allow_html=True)

    st.markdown(
        '<div style="margin-top:0.5rem; font-size:0.68rem; color:#767676;">'
        'Powered by <span style="color:#dc2626;">Groq</span></div>',
        unsafe_allow_html=True,
    )

# ══════════════════════════════════════════════════════════════
# GROQ API KEY CHECK
# ══════════════════════════════════════════════════════════════
if not GROQ_API_KEY:
    st.markdown("""
    <div style="max-width:480px; margin:4rem auto; padding:2rem;
                background:#1a1a1a; border:1px solid #2a2a2a; border-radius:12px;">
        <div style="font-size:1rem; font-weight:600; color:#f1f5f9; margin-bottom:0.75rem;">
            API Key Required</div>
        <div style="font-size:0.85rem; color:#64748b; line-height:1.6;">
            Add your Groq API key to Streamlit Secrets:<br><br>
            <code style="background:#0e0e0e; color:#dc2626; padding:0.75rem 1rem;
                         display:block; border-radius:8px; font-size:0.8rem;
                         border:1px solid #2a2a2a;">GROQ_API_KEY = "your_key_here"</code>
        </div>
    </div>
    """, unsafe_allow_html=True)
    st.stop()

# ══════════════════════════════════════════════════════════════
# CHAT STATE
# ══════════════════════════════════════════════════════════════
if "session_id" not in st.session_state:
    st.session_state.session_id = str(uuid.uuid4())
if "messages" not in st.session_state:
    if MEMORY_ENABLED and st.session_state.get("auth_token"):
        st.session_state.messages = db_load_history(st.session_state.session_id)
    else:
        st.session_state.messages = []

# ══════════════════════════════════════════════════════════════
# CHAT HEADER
# ══════════════════════════════════════════════════════════════
if not st.session_state.messages:
    st.markdown(f"""
    <div style="text-align:center; margin-bottom:2rem; font-family:'Inter',sans-serif;
                padding-top:1rem;">
        <img src="{LOGO_URL}" width="64"
             style="border-radius:50%; border:2px solid #2a2a2a;
                    object-fit:cover; display:block; margin:0 auto 1.25rem;" />
        <div style="font-size:1.65rem; font-weight:700; color:#f1f5f9;
                    letter-spacing:-0.03em;">
            How can I help you today?
        </div>
        <div style="font-size:0.85rem; color:#64748b; margin-top:0.4rem;">
            Ask me anything: coding, writing, analysis, or a question on any topic.
        </div>
    </div>
    """, unsafe_allow_html=True)
else:
    # Prefer AI-generated title for current session
    if st.session_state.get("chat_title"):
        session_title = st.session_state.chat_title
    else:
        active_sessions = db_list_sessions() if MEMORY_ENABLED else []
        session_title = next(
            (s["title"] for s in active_sessions
             if s["session_id"] == st.session_state.session_id),
            "WonyAI",
        )
    st.markdown(f"""
    <div style="text-align:center; padding:1.5rem 0 0.5rem; font-family:'Inter',sans-serif;">
        <div style="font-size:0.72rem; color:#767676; text-transform:uppercase;
                    letter-spacing:0.07em;">WonyAI</div>
        <div style="font-size:0.95rem; font-weight:600; color:#94a3b8;
                    margin-top:0.2rem; max-width:500px;
                    margin-left:auto; margin-right:auto;
                    overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            {session_title[:60] + '...' if len(session_title) > 60 else session_title}
        </div>
    </div>
    """, unsafe_allow_html=True)

# ══════════════════════════════════════════════════════════════
# CHAT HISTORY
# ══════════════════════════════════════════════════════════════
for msg in st.session_state.messages:
    if not isinstance(msg, dict) or msg.get("role") not in ("user", "assistant"):
        continue
    with st.chat_message(msg["role"]):
        st.markdown(msg.get("content") or "")

# ══════════════════════════════════════════════════════════════
# CHAT INPUT
# ══════════════════════════════════════════════════════════════
if prompt := st.chat_input("Message WonyAI..."):
    st.session_state.messages.append({"role": "user", "content": prompt})
    if st.session_state.get("auth_token") and not st.session_state.get("guest_mode"):
        db_save_message(st.session_state.session_id, "user", prompt)

    with st.chat_message("user"):
        st.markdown(prompt)

    with st.chat_message("assistant"):
        with st.spinner("Thinking..."):
            web_results = search_web(prompt) if _should_search(prompt) else []
            web_context = _format_web_context(web_results)
            system_content = SYSTEM_PROMPT
            if web_context:
                system_content += (
                    "\n\nLive web search results (use for current/realtime facts):\n"
                    f"--- WEB SEARCH ---\n{web_context}\n--- END WEB SEARCH ---"
                )
            api_msgs = [{"role": "system", "content": system_content}] + [
                {"role": m["role"], "content": m["content"]}
                for m in st.session_state.messages
            ]
            response = clean_response(call_groq(api_msgs, GROQ_API_KEY))
            sources_md = _format_web_sources(web_results)
            if sources_md:
                response = f"{response}\n\n{sources_md}"
        st.markdown(response)

    st.session_state.messages.append({"role": "assistant", "content": response})
    if st.session_state.get("auth_token") and not st.session_state.get("guest_mode"):
        db_save_message(st.session_state.session_id, "assistant", response)
    # Generate AI title after first exchange
    if len(st.session_state.messages) == 2 and not st.session_state.get("chat_title"):
        st.session_state.chat_title = generate_title(
            st.session_state.messages[0]["content"], GROQ_API_KEY
        )
    st.rerun()
