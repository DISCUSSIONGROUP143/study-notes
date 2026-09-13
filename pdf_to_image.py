
"""
PDF -> IMAGE module for the STUDY NOTES Telegram Bot.

Usage:
  /pdfimage 1-10
  /pdfimage 10-50

The command must be replied to a PDF message OR sent as a caption with a PDF.
Only the requested inclusive page range is rendered.
Output is sent as a ZIP containing JPG page images.

Dependencies:
  pip install pymupdf python-telegram-bot

For PDFs over Telegram's normal 20 MB download limit, use the Telegram Local Bot API
Server deployment described in README.md.
"""

import os
import re
import zipfile
import tempfile
from pathlib import Path

import fitz  # PyMuPDF
from telegram import Update
from telegram.ext import ContextTypes

MAX_PAGES = 50

def parse_range(value: str):
    m = re.fullmatch(r"\s*(\d+)\s*-\s*(\d+)\s*", value or "")
    if not m:
        raise ValueError("Format: 1-10 or 10-50")
    start, end = map(int, m.groups())
    if start < 1 or end < start or end > MAX_PAGES:
        raise ValueError("Allowed range is from page 1 to page 50.")
    return start, end

async def pdf_to_images(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    Register this handler in bot.py with:
      CommandHandler("pdfimage", pdf_to_images)

    The PDF can be:
      1) the document replied to by /pdfimage 1-10, OR
      2) a PDF document whose caption is '/pdfimage 1-10'
    """
    if os.getenv("ALLOWED_USER_ID", "0") != "0":
        if not update.effective_user or str(update.effective_user.id) != os.getenv("ALLOWED_USER_ID"):
            return

    args = " ".join(context.args).strip()
    try:
        start, end = parse_range(args)
    except ValueError as e:
        await update.message.reply_text(f"❌ {e}")
        return

    doc = None
    if update.message.reply_to_message and update.message.reply_to_message.document:
        doc = update.message.reply_to_message.document
    elif update.message.document:
        doc = update.message.document

    if not doc:
        await update.message.reply_text(
            "PDF पर reply करके command भेजो:\n\n"
            "/pdfimage 1-10\n"
            "/pdfimage 10-50"
        )
        return

    if doc.mime_type != "application/pdf" and not (doc.file_name or "").lower().endswith(".pdf"):
        await update.message.reply_text("❌ यह PDF file नहीं लग रही है.")
        return

    status = await update.message.reply_text(f"⏳ Pages {start}-{end} तैयार कर रहा हूँ...")
    try:
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            pdf_path = td / (doc.file_name or "source.pdf")
            tg_file = await context.bot.get_file(doc.file_id)
            await tg_file.download_to_drive(custom_path=str(pdf_path))

            out = td / "pdf_images"
            out.mkdir()

            pdf = fitz.open(str(pdf_path))
            if end > len(pdf):
                end = len(pdf)
            for page_no in range(start, end + 1):
                page = pdf.load_page(page_no - 1)
                # 150 DPI: readable while keeping files reasonably small.
                pix = page.get_pixmap(dpi=150, alpha=False)
                pix.save(str(out / f"page_{page_no:04d}.jpg"))
            pdf.close()

            zip_path = td / f"{pdf_path.stem}_pages_{start}-{end}.zip"
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
                for img in sorted(out.glob("*.jpg")):
                    z.write(img, img.name)

            await status.edit_text(f"✅ Pages {start}-{end} तैयार हैं.")
            await update.message.reply_document(
                document=str(zip_path),
                caption=f"STUDY NOTES PDF → IMAGE\nPages {start}-{end}"
            )
    except Exception as e:
        await status.edit_text("❌ PDF → Image failed: " + str(e)[:800])
