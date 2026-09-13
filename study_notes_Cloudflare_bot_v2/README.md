# STUDY NOTES Telegram Bot

PDF/photo -> Gemini -> MCQs -> STUDY NOTES HTML + JSON.

Secrets are environment variables, never embedded in the generated HTML.

Install:
`pip install -r requirements.txt`

Run:
`python bot.py`

Environment:
- TELEGRAM_BOT_TOKEN
- GEMINI_API_KEY
- ALLOWED_USER_ID (optional; 0 allows all)
- GEMINI_MODEL

Important: the standard Telegram Bot API currently lets bots download files up to 20 MB. For larger PDFs, Telegram's official Local Bot API Server can remove the download-size limit. This package starts with the standard API path; large-file mode is the next deployment step.
