/*
STUDY NOTES WORKER PATCH
Replace the existing Gemini error block with this version:

const responseText = await r.text();

if (!r.ok) {
  console.error("GEMINI_API_ERROR", JSON.stringify({
    status: r.status,
    body: responseText.slice(0, 3000)
  }));

  throw new Error(
    `Gemini HTTP ${r.status}: ${responseText.slice(0, 1800)}`
  );
}

let j;
try {
  j = JSON.parse(responseText);
} catch {
  throw new Error(
    `Gemini returned invalid JSON response: ${responseText.slice(0, 1000)}`
  );
}

Also replace the silent top-level catch with:

} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("BOT_ERROR_DETAIL", message.slice(0, 3000));

  const chatId = update?.message?.chat?.id;
  if (chatId) {
    try {
      await sendMessage(
        env,
        chatId,
        "❌ Processing error:\n\n" + message.slice(0, 3500)
      );
    } catch (sendErr) {
      console.error(
        "ERROR_SEND_FAILED",
        sendErr instanceof Error ? sendErr.message : String(sendErr)
      );
    }
  }
}
*/
