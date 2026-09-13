# STUDY NOTES — Cloudflare Worker Telegram Bot

This version is intentionally only the MCQ-generation bot.

## Included
- Telegram webhook
- PDF/photo input
- Gemini MCQ generation
- HTML + JSON output
- Optional `ALLOWED_USER_ID`
- Secrets kept outside source code

## Removed
- PDF → Image
- R2
- Telegram channel forwarding
- Telegram bot logs/forwarding
- creator branding/promotion
- hard-coded Gemini API key
- hard-coded Telegram bot token

## Important
This Worker uses the standard Telegram Bot API download path, so this version accepts files up to 20 MB. Do not put API keys or bot tokens in GitHub.

## Cloudflare setup
1. Create a Worker.
2. Upload `worker.js`.
3. Add secrets:
   - `TELEGRAM_BOT_TOKEN`
   - `GEMINI_API_KEY`
   - `ALLOWED_USER_ID` (your numeric Telegram user ID; recommended)
4. Deploy.
5. Set Telegram webhook to your Worker URL.

Webhook request:
`https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<YOUR-WORKER>.workers.dev/`

Use the URL only in Telegram/Cloudflare configuration; do not place the token in GitHub.

## Test
Send `/start`, then send a PDF or photo.

## Note on PDF size
20 MB is the limit chosen for this simple free version. It avoids R2 and heavy PDF processing, as requested.


## Raw text → JSON

Plain MCQ text can also be sent directly. The bot converts the supplied
Question + 4 Options + Answer + Explanation into the Study Notes schema.
It is instructed not to invent new questions in this mode.

Answer mapping:
A/1 → 0, B/2 → 1, C/3 → 2, D/4 → 3.
