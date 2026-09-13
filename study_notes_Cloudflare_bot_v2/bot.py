import os, json, re, tempfile
from pathlib import Path
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, ContextTypes, filters
from google import genai

BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
ALLOWED_USER_ID = int(os.getenv("ALLOWED_USER_ID", "0"))
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
ai = genai.Client(api_key=GEMINI_API_KEY)

PROMPT = r'''
Create exam-quality MCQs from the supplied source. Return ONLY valid JSON.
Schema: {"topic":"short title","questions":[{"question":"...","options":["...","...","...","..."],"answer":0,"explanation":"..."}]}
Rules: exactly 4 options; answer is 0-3; stay strictly grounded in the source; do not invent facts; preserve important facts, dates, names and terms; avoid duplicates; no branding, creator names, Telegram links, bot information or promotional text.
'''

def allowed(update):
    return ALLOWED_USER_ID == 0 or (update.effective_user and update.effective_user.id == ALLOWED_USER_ID)

def parse_json(text):
    text = re.sub(r"```(?:json)?", "", text, flags=re.I).replace("```", "").strip()
    a, b = text.find("{"), text.rfind("}")
    if a < 0 or b <= a: raise ValueError("Gemini did not return JSON")
    return json.loads(text[a:b+1])

def validate(data):
    qs=[]
    for q in data.get("questions", []):
        opts=q.get("options",[]); ans=q.get("answer")
        if isinstance(ans,str): ans={"A":0,"B":1,"C":2,"D":3,"1":0,"2":1,"3":2,"4":3}.get(ans.upper(),-1)
        if isinstance(opts,list) and len(opts)==4 and isinstance(ans,int) and 0<=ans<4:
            qs.append({"question":str(q.get("question","")),"options":[str(x) for x in opts],"answer":ans,"explanation":str(q.get("explanation",""))})
    if not qs: raise ValueError("No valid questions generated")
    return {"topic":str(data.get("topic") or "Study Notes Test"),"questions":qs}

def html(data):
    title=data["topic"].replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace('"',"&quot;")
    payload=json.dumps(data["questions"],ensure_ascii=False).replace("</","<\\/")
    n=len(data["questions"]); mins=max(5,round(n*.8))
    return f'''<!doctype html><html lang="hi" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title} | STUDY NOTES</title><style>:root{{--bg:#fffbf2;--card:#fff;--border:#eadfce;--text:#2b1810;--muted:#7c6858;--accent:#c2410c;--green:#15803d;--red:#dc2626}}[data-theme=dark]{{--bg:#090d16;--card:#111827;--border:#293548;--text:#f8fafc;--muted:#94a3b8}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font-family:Arial,sans-serif;padding:16px}}.wrap{{max-width:560px;margin:auto}}.card{{background:var(--card);border:1px solid var(--border);border-radius:22px;padding:20px;margin:12px 0}}.top{{display:flex;justify-content:space-between}}h1{{text-align:center}}.muted{{color:var(--muted);text-align:center}}.stats{{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}}.stat{{border:1px solid var(--border);border-radius:14px;padding:12px;text-align:center}}button{{border:0;border-radius:13px;padding:13px;font-weight:800;cursor:pointer}}.main{{width:100%;background:#7f1d1d;color:white;margin-top:14px}}.opt{{display:block;width:100%;text-align:left;background:var(--card);color:var(--text);border:1px solid var(--border);margin:9px 0}.correct{{border-color:var(--green)!important;color:var(--green)}}.wrong{{border-color:var(--red)!important;color:var(--red)}}.expl{{display:none;margin-top:14px;padding:14px;border-left:4px solid var(--accent);background:#fff4e8;line-height:1.55}}.nav{{display:flex;gap:8px;margin-top:16px}}.nav button{{flex:1;background:var(--card);color:var(--text);border:1px solid var(--border)}}#quiz,#result{{display:none}}.score{{font-size:2.7rem;text-align:center;font-weight:900}}</style></head><body><div class="wrap"><div id="start" class="card"><div class="top"><b>STUDY NOTES</b><button onclick="theme()">☀/☾</button></div><h1>{title}</h1><p class="muted">Practice Test</p><div class="stats"><div class="stat"><b>{n}</b><br>Questions</div><div class="stat"><b>{mins}m</b><br>Time</div><div class="stat"><b>+2/-0.5</b><br>Marking</div></div><button class="main" onclick="startTest()">START TEST</button></div><div id="quiz" class="card"><div class="top"><b id="counter"></b><button onclick="theme()">☀/☾</button></div><h2 id="question"></h2><div id="options"></div><div id="explanation" class="expl"></div><div class="nav"><button onclick="prev()">Previous</button><button onclick="next()">Next</button></div></div><div id="result" class="card"><h1>Result</h1><div id="score" class="score"></div><p id="resultStats" class="muted"></p><button class="main" onclick="location.reload()">RETAKE</button></div></div><script>const data={payload};let i=0,ans=Array(data.length).fill(null);function theme(){{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark'}}function startTest(){{start.style.display='none';quiz.style.display='block';render()}}function render(){{counter.textContent='Q '+(i+1)+'/'+data.length;question.textContent=(i+1)+'. '+data[i].question;options.innerHTML='';explanation.style.display='none';data[i].options.forEach((x,j)=>{{let b=document.createElement('button');b.className='opt';b.textContent=String.fromCharCode(65+j)+'. '+x;b.onclick=()=>choose(j);options.appendChild(b)}});if(ans[i]!==null)show()}}function choose(j){{if(ans[i]!==null)return;ans[i]=j;show()}}function show(){{[...options.children].forEach((b,j)=>{{if(j===data[i].answer)b.classList.add('correct');if(ans[i]===j&&j!==data[i].answer)b.classList.add('wrong')}});explanation.textContent='Explanation: '+data[i].explanation;explanation.style.display='block'}}function next(){{if(i<data.length-1){{i++;render()}}else result()}}function prev(){{if(i>0){{i--;render()}}}}function result(){{quiz.style.display='none';result.style.display='block';let c=ans.filter((x,j)=>x===data[j].answer).length,w=ans.filter((x,j)=>x!==null&&x!==data[j].answer).length,s=ans.filter(x=>x===null).length;score.textContent=(c*2-w*.5).toFixed(1)+' / '+(data.length*2);resultStats.textContent='Correct: '+c+' | Wrong: '+w+' | Skipped: '+s}}</script></body></html>'''

async def process(update, context, tgfile, filename, mime):
    msg=await update.message.reply_text("⏳ File मिल गई। Questions तैयार हो रहे हैं...")
    try:
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/filename
            await tgfile.download_to_drive(custom_path=str(path))
            uploaded=ai.files.upload(file=str(path))
            res=ai.models.generate_content(model=MODEL,contents=[uploaded,PROMPT])
            data=validate(parse_json(res.text))
            hp=path.with_suffix('.html'); jp=path.with_suffix('.json')
            hp.write_text(html(data),encoding='utf-8'); jp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
            await update.message.reply_document(hp,caption=f"✅ STUDY NOTES HTML\n{data['topic']}\n{len(data['questions'])} questions")
            await update.message.reply_document(jp,caption="📦 JSON")
            await msg.edit_text("✅ Complete")
    except Exception as e: await msg.edit_text("❌ Error: "+str(e)[:900])

async def start(update,context):
    if allowed(update): await update.message.reply_text("STUDY NOTES BOT\nPDF/photo भेजो → MCQs → HTML + JSON")
async def uid(update,context): await update.message.reply_text(f"Your Telegram user ID: {update.effective_user.id}")
async def doc(update,context):
    if not allowed(update): return
    d=update.message.document
    if d.file_size and d.file_size>20*1024*1024:
        await update.message.reply_text("⚠️ 20 MB से बड़ी file default Telegram Bot API से download नहीं हो सकती। Large-PDF mode के लिए Local Bot API Server चाहिए।")
        return
    f=await context.bot.get_file(d.file_id); await process(update,context,f,d.file_name or 'source.pdf',d.mime_type or 'application/pdf')
async def photo(update,context):
    if not allowed(update): return
    p=update.message.photo[-1]; f=await context.bot.get_file(p.file_id); await process(update,context,f,'source.jpg','image/jpeg')

app=Application.builder().token(BOT_TOKEN).build()
app.add_handler(CommandHandler('start',start)); app.add_handler(CommandHandler('id',uid))
app.add_handler(MessageHandler(filters.Document.ALL,doc)); app.add_handler(MessageHandler(filters.PHOTO,photo))
app.run_polling()
