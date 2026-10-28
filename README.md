# WonyAI

A personal AI assistant powered by the Groq Cloud API, built with Streamlit.

## Features

- Conversational AI powered by Groq Cloud (`openai/gpt-oss-20b`)
- Persistent chat memory via Supabase — conversations are saved and restored across sessions
- Session history panel in the sidebar for navigating previous conversations
- Minimalist dark UI with a clean, distraction-free chat interface
- Robust error handling for API rate limits and authentication issues

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend / App | Streamlit |
| AI Inference | Groq Cloud API |
| Database | Supabase (PostgreSQL via REST API) |
| Deployment | Streamlit Cloud |

## Project Structure

```
WonyAI/
├── app_cloud.py       # Main application
├── requirements.txt   # Python dependencies
├── .gitignore
└── README.md
```

## Local Setup

**1. Clone the repository**
```bash
git clone https://github.com/manuelnyx/WonyAI.git
cd WonyAI
```

**2. Install dependencies**
```bash
pip install -r requirements.txt
```

**3. Configure secrets**

Create `.streamlit/secrets.toml`:
```toml
GROQ_API_KEY  = "your_groq_api_key"
SUPABASE_URL  = "https://your-project.supabase.co"
SUPABASE_KEY  = "your_supabase_anon_key"
```

**4. Run locally**
```bash
streamlit run app_cloud.py
```

## Deployment

Deployed on [Streamlit Cloud](https://streamlit.io/cloud). Configure secrets via **Manage app → Settings → Secrets**.

Live: [wonyai.streamlit.app](https://wonyai.streamlit.app)

---

Created by [Emmanuel Abet Rossi Paays](https://emmanuel-abet-rossi-paays.vercel.app/)
