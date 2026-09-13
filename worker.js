/**
 * STUDY NOTES — Telegram + Gemini Cloudflare Worker
 *
 * Secrets:
 * TELEGRAM_BOT_TOKEN
 * GEMINI_API_KEY
 * ALLOWED_USER_ID (optional)
 *
 * Workflow:
 * PDF/photo -> Gemini -> MCQs -> HTML + JSON -> Telegram
 * Raw MCQ text -> Gemini -> Study Notes JSON -> HTML + JSON -> Telegram
 */

const MODEL = "gemini-2.5-flash";

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("STUDY NOTES BOT OK", { status: 200 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }

    try {
      await handleUpdate(update, env);
    } catch (err) {
      const rootError = String(err?.message || err);
      console.error("BOT_ERROR_DETAIL", rootError);
      console.error("BOT_ERROR_OBJECT", JSON.stringify(err, Object.getOwnPropertyNames(err)));

      const chatId = update?.message?.chat?.id;
      if (chatId) {
        try {
          await sendMessage(
            env,
            chatId,
            "❌ ERROR\n" + rootError.slice(0, 3800)
          );
        } catch (sendErr) {
          console.error("ERROR_SEND_FAILED_DETAIL", String(sendErr?.message || sendErr));
          console.error("ERROR_SEND_FAILED_OBJECT", JSON.stringify(sendErr, Object.getOwnPropertyNames(sendErr)));
        }
      }
    }

    return new Response("OK", { status: 200 });
  }
};

function allowed(update, env) {
  const id = env.ALLOWED_USER_ID;
  if (!id) return true;
  return String(update?.message?.from?.id ?? "") === String(id);
}

async function telegram(env, method, body) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN secret is missing.");
  }

  const r = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  );

  const text = await r.text();

  if (!r.ok) {
    throw new Error(`Telegram ${method} failed: ${text.slice(0, 1500)}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Telegram ${method} returned invalid JSON.`);
  }

  if (json.ok === false) {
    throw new Error(`Telegram ${method} error: ${json.description || text}`);
  }

  return json;
}

async function sendMessage(env, chatId, text) {
  return telegram(env, "sendMessage", {
    chat_id: chatId,
    text: String(text).slice(0, 4000)
  });
}

async function getTelegramFile(env, fileId) {
  const meta = await telegram(env, "getFile", { file_id: fileId });
  const path = meta?.result?.file_path;

  if (!path) {
    throw new Error("Telegram did not return file_path.");
  }

  const data = await fetch(
    `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`
  );

  if (!data.ok) {
    throw new Error(
      `Could not download Telegram file: ${data.status} ${await data.text()}`
    );
  }

  return new Uint8Array(await data.arrayBuffer());
}

async function gemini(env, parts) {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY secret is missing.");
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent` +
    `?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const body = {
    systemInstruction: {
      parts: [{
        text: `You create exam-quality MCQs for STUDY NOTES.
Return ONLY valid JSON. No markdown fences.

Schema:
{
  "topic": "short topic/title",
  "questions": [
    {
      "question": "question text",
      "options": ["A text","B text","C text","D text"],
      "answer": 0,
      "explanation": "clear explanation"
    }
  ]
}

Rules:
- Exactly 4 options.
- answer is zero-based 0,1,2,3.
- Use only information supported by the supplied source.
- Do not invent facts.
- Make useful SSC/HSSC-style questions.
- Preserve important facts, dates, names, terms and examples.
- No branding, creator names, Telegram links or promotional content.`
      }]
    },
    contents: [{ role: "user", parts }]
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  const responseText = await r.text();

  if (!r.ok) {
    // Do not expose the API key itself in the diagnostic error.
    throw new Error(
      `Gemini API ${r.status}: ${responseText.slice(0, 2500)}`
    );
  }

  let j;
  try {
    j = JSON.parse(responseText);
  } catch {
    throw new Error("Gemini returned invalid JSON response.");
  }

  if (j?.error) {
    throw new Error(
      `Gemini error: ${j.error.message || JSON.stringify(j.error)}`
    );
  }

  const text =
    j?.candidates?.[0]?.content?.parts
      ?.map(x => x.text || "")
      .join("") || "";

  if (!text) {
    const finish = j?.candidates?.[0]?.finishReason || "unknown";
    throw new Error(`Gemini returned no text. Finish reason: ${finish}`);
  }

  return text;
}

function parseGeminiJson(text) {
  const clean = String(text)
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const a = clean.indexOf("{");
  const b = clean.lastIndexOf("}");

  if (a < 0 || b <= a) {
    throw new Error(
      "Gemini returned no usable JSON. Response: " + clean.slice(0, 1200)
    );
  }

  try {
    return JSON.parse(clean.slice(a, b + 1));
  } catch (err) {
    throw new Error(
      "Gemini JSON parse failed: " +
      String(err?.message || err) +
      "\nResponse: " +
      clean.slice(0, 1200)
    );
  }
}

function validate(data) {
  if (!data || !Array.isArray(data.questions)) {
    throw new Error("Invalid question JSON: questions array missing.");
  }

  const questions = data.questions.map(q => {
    let answer = q.answer;

    if (typeof answer === "string") {
      const key = answer.trim().toUpperCase();
      answer = ({
        A: 0,
        B: 1,
        C: 2,
        D: 3,
        "1": 0,
        "2": 1,
        "3": 2,
        "4": 3
      })[key];
    }

    return {
      question: String(q.question || "").trim(),
      options: Array.isArray(q.options)
        ? q.options.slice(0, 4).map(x => String(x).trim())
        : [],
      answer,
      explanation: String(q.explanation || "").trim()
    };
  }).filter(q =>
    q.question &&
    q.options.length === 4 &&
    q.options.every(Boolean) &&
    Number.isInteger(q.answer) &&
    q.answer >= 0 &&
    q.answer <= 3
  );

  if (!questions.length) {
    throw new Error("No valid MCQs generated.");
  }

  return {
    topic: String(data.topic || "Study Notes Test").trim(),
    questions
  };
}

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c])
  );
}

function buildHtml(data) {
  const payload = JSON.stringify(data.questions).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(data.topic)} | STUDY NOTES</title>
<style>
:root{--bg:#fffbf2;--card:#fff;--border:#eadfcd;--text:#28150d;--muted:#766457;--accent:#9f2d17;--ok:#15803d;--bad:#dc2626}
[data-theme=dark]{--bg:#090d16;--card:#111827;--border:#293548;--text:#f8fafc;--muted:#94a3b8;--accent:#fb923c;--ok:#10b981;--bad:#ef4444}
*{box-sizing:border-box}
body{margin:0;padding:16px;background:var(--bg);color:var(--text);font-family:Arial,sans-serif}
.wrap{max-width:650px;margin:auto}
.card{background:var(--card);border:1px solid var(--border);border-radius:20px;padding:20px;margin:12px 0}
.top{display:flex;justify-content:space-between;align-items:center}
h1{font-size:25px;text-align:center}
h2{line-height:1.5}
.muted{text-align:center;color:var(--muted)}
button{border-radius:12px;padding:12px 14px;font-weight:700;cursor:pointer}
.main{width:100%;border:0;background:var(--accent);color:white}
.theme,.nav button{background:var(--card);color:var(--text);border:1px solid var(--border)}
.opt{display:block;width:100%;margin:9px 0;text-align:left;background:var(--card);color:var(--text);border:1px solid var(--border)}
.correct{border-color:var(--ok);color:var(--ok)}
.wrong{border-color:var(--bad);color:var(--bad)}
.expl{display:none;margin-top:15px;padding:14px;background:rgba(159,45,23,.08);border-left:4px solid var(--accent);line-height:1.6}
.nav{display:flex;gap:8px;margin-top:15px}
.nav button{flex:1}
#quiz,#result{display:none}
.score{text-align:center;font-size:42px;font-weight:800}
</style>
</head>
<body>
<div class="wrap">
<section id="start" class="card">
<div class="top"><b>STUDY NOTES</b><button class="theme" onclick="theme()">☀/☾</button></div>
<h1>${esc(data.topic)}</h1>
<p class="muted">Practice Test</p>
<button class="main" onclick="start()">START TEST</button>
</section>

<section id="quiz" class="card">
<div class="top"><b id="count"></b><button class="theme" onclick="theme()">☀/☾</button></div>
<h2 id="question"></h2>
<div id="options"></div>
<div id="explanation" class="expl"></div>
<div class="nav">
<button onclick="prev()">Previous</button>
<button onclick="next()">Next</button>
</div>
</section>

<section id="result" class="card">
<h1>Result</h1>
<div id="score" class="score"></div>
<p id="summary" class="muted"></p>
<button class="main" onclick="location.reload()">RETAKE</button>
</section>
</div>

<script>
const data=${payload};
let i=0,answers=Array(data.length).fill(null);

function theme(){
  document.documentElement.dataset.theme =
    document.documentElement.dataset.theme==="dark" ? "light" : "dark";
}

function start(){
  document.getElementById("start").style.display="none";
  document.getElementById("quiz").style.display="block";
  render();
}

function render(){
  let q=data[i];
  count.textContent="Q "+(i+1)+"/"+data.length;
  question.textContent=(i+1)+". "+q.question;
  options.innerHTML="";
  explanation.style.display="none";

  q.options.forEach((x,j)=>{
    let b=document.createElement("button");
    b.className="opt";
    b.textContent=String.fromCharCode(65+j)+". "+x;
    b.onclick=()=>choose(j);
    options.appendChild(b);
  });

  if(answers[i]!==null) show();
}

function choose(j){
  if(answers[i]!==null)return;
  answers[i]=j;
  show();
}

function show(){
  [...options.children].forEach((b,j)=>{
    if(j===data[i].answer)b.classList.add("correct");
    if(answers[i]===j&&j!==data[i].answer)b.classList.add("wrong");
  });

  explanation.textContent="Explanation: "+data[i].explanation;
  explanation.style.display="block";
}

function next(){
  if(i<data.length-1){
    i++;
    render();
  }else{
    finish();
  }
}

function prev(){
  if(i>0){
    i--;
    render();
  }
}

function finish(){
  quiz.style.display="none";
  result.style.display="block";

  let c=answers.filter((a,j)=>a===data[j].answer).length;
  let w=answers.filter((a,j)=>a!==null&&a!==data[j].answer).length;
  let s=answers.filter(a=>a===null).length;

  score.textContent=(c*2-w*.5).toFixed(1)+" / "+(data.length*2);
  summary.textContent="Correct: "+c+" | Wrong: "+w+" | Skipped: "+s;
}
</script>
</body>
</html>`;
}

async function sendDocument(env, chatId, filename, content, caption) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append(
    "document",
    new File(
      [content],
      filename,
      { type: "application/octet-stream" }
    )
  );
  form.append("caption", String(caption));

  const r = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`,
    {
      method: "POST",
      body: form
    }
  );

  const text = await r.text();

  if (!r.ok) {
    throw new Error(`Telegram sendDocument failed: ${text.slice(0, 1500)}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Telegram sendDocument returned invalid JSON.");
  }

  if (json.ok === false) {
    throw new Error(
      `Telegram sendDocument error: ${json.description || text}`
    );
  }

  return json;
}

async function handleUpdate(update, env) {
  if (!allowed(update, env)) return;

  const m = update.message;
  if (!m) return;

  const chatId = m.chat.id;

  if (m.text === "/start" || m.text === "/help") {
    return sendMessage(
      env,
      chatId,
      "Bot ready.\n\nPDF/photo भेजो तो source से MCQs बनेंगे। Raw MCQ text भेजो तो उसी content को JSON में convert किया जाएगा। HTML + JSON मिलेगा."
    );
  }

  // RAW TEXT MODE
  if (typeof m.text === "string" && !m.text.startsWith("/")) {
    await sendMessage(
      env,
      chatId,
      "⏳ Text मिल गया। Study Notes JSON में convert कर रहा हूँ..."
    );

    const textPrompt = `Convert the supplied MCQ text into the STUDY NOTES JSON schema.
Do NOT create new questions and do NOT change the supplied meaning, options, answer or explanation.
Keep all valid questions found in the text.
Convert answers A/B/C/D to zero-based 0/1/2/3; also convert 1/2/3/4 to 0/1/2/3.
Return ONLY valid JSON:
{
  "topic": "short topic/title",
  "questions": [
    {
      "question": "...",
      "options": ["...", "...", "...", "..."],
      "answer": 0,
      "explanation": "..."
    }
  ]
}

SOURCE TEXT:
${m.text}`;

    const raw = await gemini(env, [{ text: textPrompt }]);
    const data = validate(parseGeminiJson(raw));
    const html = buildHtml(data);
    const json = JSON.stringify(data, null, 2);

    await sendDocument(
      env,
      chatId,
      "study-notes.html",
      html,
      `✅ ${data.topic}\n${data.questions.length} questions`
    );

    await sendDocument(
      env,
      chatId,
      "study-notes.json",
      json,
      "📦 JSON"
    );

    return sendMessage(
      env,
      chatId,
      "✅ Text convert हो गया। HTML + JSON भेज दिया गया है."
    );
  }

  let parts = [];
  let filename = "source";

  if (m.photo?.length) {
    const p = m.photo[m.photo.length - 1];
    const bytes = await getTelegramFile(env, p.file_id);

    parts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: arrayBufferToBase64(bytes)
      }
    });

    filename = "photo";

  } else if (m.document) {
    const d = m.document;

    if (d.file_size > 20 * 1024 * 1024) {
      return sendMessage(
        env,
        chatId,
        "❌ File 20 MB से बड़ी है। इस version में 20 MB तक की file supported है."
      );
    }

    const bytes = await getTelegramFile(env, d.file_id);
    const mime = d.mime_type || "application/pdf";

    parts.push({
      inlineData: {
        mimeType: mime,
        data: arrayBufferToBase64(bytes)
      }
    });

    filename = (d.file_name || "source")
      .replace(/\.[^.]+$/, "");

  } else {
    return;
  }

  await sendMessage(
    env,
    chatId,
    "⏳ Source मिल गया। Questions तैयार कर रहा हूँ..."
  );

  const text = await gemini(env, [
    ...parts,
    {
      text: "Create the MCQs from this source. Produce a useful batch without adding unsupported information."
    }
  ]);

  const data = validate(parseGeminiJson(text));
  const html = buildHtml(data);
  const json = JSON.stringify(data, null, 2);

  await sendDocument(
    env,
    chatId,
    `${filename}-study-notes.html`,
    html,
    `✅ ${data.topic}\n${data.questions.length} questions`
  );

  await sendDocument(
    env,
    chatId,
    `${filename}-study-notes.json`,
    json,
    "📦 JSON"
  );

  await sendMessage(env, chatId, "✅ Complete.");
}

function arrayBufferToBase64(bytes) {
  let s = "";
  const chunk = 0x8000;

  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + chunk, bytes.length))
    );
  }

  return btoa(s);
}
