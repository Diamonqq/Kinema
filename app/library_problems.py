"""My work: concise Saved/Recent cards curated from existing source records.

Recent includes genuine typed problems and photos. Saved includes kept/worked
chat problems and legacy saved problems. Generic study chatter stays in Chats.
Removal changes only card visibility; source work and folder references remain.
The older kept-only listing stays available to existing API consumers.
Each listed problem has:
 - statement: the owner's own typed words when they read like a problem, else the tutor's restated problem line
 - number: the Morin problem number, marked verified only when the statement matches that problem's printed text
   in the shipped book data (app/content/daily_problems.json); a number that is only mentioned stays unverified
 - crop: a tidy trimmed copy of the screenshot; the raw screenshot stays stored and is never shown in the list
No model call is made: this is deterministic, runs when the Library opens, and never edits a chat.
"""
from __future__ import annotations

import functools
import hashlib
import io
import json
import re
import time
from contextlib import closing
from pathlib import Path

from fastapi import APIRouter, Body, HTTPException, Query

from . import learn_api, teacher_content as content

router = APIRouter(prefix='/api/library/work')

BOOK_PATH = Path(__file__).resolve().parent / "content" / "daily_problems.json"
VERIFY_AT = 0.5          # share of a printed problem's words the statement must share
SAME_AT = 0.8            # two statements this alike are the same problem
NUMBER = re.compile(r"(?<![\d.])(\d{1,2})\.(\d{1,2})(?![\d.]*\d)")
PROBLEM_WORDS = re.compile(r"\b(find|calculate|compute|determine|what is|what's|how (?:far|long|fast|much|many)|show that|prove|derive|"
                           r"given|suppose|consider|a (?:block|ball|mass|stick|particle|car|rod|disk|wheel))\b", re.I)


def ensure_tables(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS lib_problems(
        id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, thread_id TEXT NOT NULL, message_id TEXT NOT NULL, course_id TEXT NOT NULL,
        statement TEXT NOT NULL, number TEXT, verified INTEGER NOT NULL DEFAULT 0, attachment_id TEXT, crop TEXT, raw_hash TEXT,
        seen INTEGER NOT NULL DEFAULT 1, hidden INTEGER NOT NULL DEFAULT 0, created_ts REAL NOT NULL, updated_ts REAL NOT NULL)""")
    cols = {r[1] for r in conn.execute("PRAGMA table_info(lib_problems)")}
    if "kept" not in cols:
        conn.execute("ALTER TABLE lib_problems ADD COLUMN kept INTEGER NOT NULL DEFAULT 0")
    if "worked" not in cols:
        conn.execute("ALTER TABLE lib_problems ADD COLUMN worked INTEGER NOT NULL DEFAULT 0")
    conn.execute('''CREATE TABLE IF NOT EXISTS library_work_visibility(
        kind TEXT NOT NULL, item_id TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(kind,item_id))''')


def _terms(text: str) -> set[str]:
    return set(re.findall(r"[a-z]{3,}|\d+(?:\.\d+)?", text.lower()))


@functools.lru_cache(maxsize=1)
def _book() -> list[dict]:
    rows = json.loads(BOOK_PATH.read_text(encoding="utf-8"))["problems"]
    return [{"id": r["id"], "title": r["title"], "text": r["text"], "terms": _terms(r["text"])} for r in rows if r.get("text")]


def match_book(statement: str) -> tuple[str | None, bool, str]:
    """(number, verified, book text) for the closest printed problem; unverified when only a number is mentioned."""
    mine = _terms(statement)
    best, score = None, 0.0
    for b in _book():
        if not b["terms"]:
            continue
        s = len(mine & b["terms"]) / len(b["terms"])
        if s > score:
            best, score = b, s
    if best and score >= VERIFY_AT and len(mine & best["terms"]) >= 8:
        return best["id"], True, best["text"]
    known = {b["id"] for b in _book()}
    for m in NUMBER.finditer(statement):
        num = f"{int(m.group(1))}.{int(m.group(2))}"
        if num in known:
            return num, False, ""
    return None, False, ""


def looks_like_problem(text: str) -> bool:
    t = " ".join((text or "").split())
    if len(t) < 16:
        return False
    task = re.search(r'\b(find|calculate|compute|determine|derive|solve|evaluate|show that|prove|how (?:far|long|fast|much|many))\b', t, re.I)
    ask = '?' in t or task
    equation = re.search(r'(?:\w|\))\s*=\s*[-+\w(\\]|\d\s*(?:kg|m/s|newtons?|joules?|degrees?|meters?|metres?|cm|km|seconds?)\b', t, re.I)
    setup = re.search(r'\b(?:a|an|the|two|three)\s+(?:(?:small|large|uniform|thin|solid|hollow|frictionless|rotating|charged)\s+)*(?:block|ball|bob|mass|rod|stick|particle|cart|car|disk|wheel|spring|pendulum|satellite|object|book|bead|hoop|cylinder|cone|coin)\b', t, re.I)
    topic = re.search(r'\b(force|momentum|energy|velocity|acceleration|gravity|friction|tension|orbit|angle|position|height|distance|torque|speed|spring|pendulum|mass|particle|integral|derivative)\b', t, re.I)
    study_request = re.search(r'\b(?:study|chapter|teach me|explain|walk me through|help me understand|refresh|review (?:the|my)|get (?:good|better)|exam|class tomorrow)\b', t, re.I)
    scenario = re.search(r'\b(slides?|falls?|collides?|hangs?|rotates?|rolls?|accelerates?|released|launched|attached|dropped)\b',t,re.I)
    if study_request and not (equation or (setup and (task or scenario))):
        return False
    return bool(ask and (equation or setup or (topic and len(t) >= 45)))


def presentation(statement, number=None, verified=False, photo=False):
    """A concise native card; full source text remains in its original chat."""
    text = ' '.join((statement or '').split())
    if not text or text == 'Screenshot problem':
        return {'title': 'Photographed problem' if photo else 'Saved problem', 'preview': ''}
    title = text.split('\n', 1)[0]
    first = re.split(r'(?<=[.!?])\s+(?=[A-Z])', title, maxsplit=1)[0]
    if len(first) > 76:
        first = first[:73].rsplit(' ', 1)[0].rstrip(' ,;:') + '…'
    if verified and number:
        match = next((r for r in _book() if r['id'] == number), None)
        if match:
            first = match['title']
    preview = text if text != first else ''
    if len(preview) > 210:
        preview = preview[:207].rsplit(' ', 1)[0].rstrip(' ,;:') + '…'
    return {'title': first, 'preview': preview}


def _clean(text: str) -> str:
    t = re.sub(r"^\s*(?:problem|question|q)\s*[\d.]*\s*[:.)-]\s*", "", " ".join((text or "").split()), flags=re.I)
    return t[:900]


def _tutor_line(t: dict, idx: int) -> str:
    nxt = next((m for m in t["messages"][idx + 1:] if isinstance(m,dict) and m.get("role") == "assistant" and (m.get("text") or "").strip()), None)
    if not nxt:
        return ""
    for line in nxt["text"].splitlines():
        s = line.strip().lstrip("*# ").strip()
        m = re.match(r"(?:the )?(?:problem|question)[^:\n]{0,24}:\s*(.{30,})", s, re.I)
        if m:
            return _clean(m.group(1).rstrip("*"))
    return ""


def _crop(data_dir: Path, a: dict, lid: str) -> str:
    """A trimmed copy: the uniform margin around the question removed, padded a little; '' when it cannot be read."""
    try:
        from PIL import Image, ImageChops
        src = content.attachment_file(data_dir, a)
        im = Image.open(src).convert("RGB")
        bg = Image.new("RGB", im.size, im.getpixel((0, 0)))
        box = ImageChops.difference(im, bg).convert("L").point(lambda v: 255 if v > 24 else 0).getbbox()
        if box:
            pad = 14
            box = (max(0, box[0] - pad), max(0, box[1] - pad), min(im.width, box[2] + pad), min(im.height, box[3] + pad))
            if (box[2] - box[0]) * (box[3] - box[1]) > 400:
                im = im.crop(box)
        im.thumbnail((1400, 1400))
        folder = data_dir / "uploads"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"lib-{lid}.png").write_bytes(_png(im))
        return f"/uploads/lib-{lid}.png"
    except Exception:  # noqa: BLE001 - a bad image just has no preview
        return ""


def _png(im) -> bytes:
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def _candidates(conn):
    for tid, course_id, state in conn.execute("SELECT id, course_id, state FROM teacher_threads ORDER BY created_ts"):
        try:
            t = json.loads(state)
            if not isinstance(t, dict) or not isinstance(t.get('messages'), list):
                continue
        except (ValueError, TypeError):
            continue
        for i, m in enumerate(t["messages"]):
            if not isinstance(m,dict) or m.get('role') != 'user' or not m.get('id'):
                continue
            images = []
            for aid in m.get("attachment_ids") or []:
                a = content.attachment(conn, aid)
                if a and a["kind"] == "image":
                    images.append(a)
            typed = _clean(m.get("text") or "") if looks_like_problem(m.get("text") or "") else ""
            if not images and not typed:
                continue
            yield tid, course_id, t, i, m, images, typed


STOP = {"the", "and", "for", "that", "this", "with", "are", "was", "find", "what", "how", "you", "can", "not", "its", "from", "have", "but", "does", "about", "please", "tell", "give", "show"}
WORKED_REPLIES = 2      # owner messages about this very problem that make it "worked", not a stray upload


def _worked(t: dict, i: int, statement: str) -> int:
    """1 only when the owner kept working on this problem: at least WORKED_REPLIES later messages, before any other
    problem is sent, that are about it (share its words or carry an equation). Book matching or unrelated chat never counts."""
    mine = _terms(statement or "") - STOP
    n = 0
    for m in t["messages"][i + 1:]:
        if not isinstance(m,dict) or m.get("role") != "user":
            continue
        text = " ".join((m.get("text") or "").split())
        if m.get("attachment_ids") or looks_like_problem(text):
            break
        if len(text) >= 15 and (_terms(text) & mine or "=" in text):
            n += 1
    return int(n >= WORKED_REPLIES)


def sync() -> int:
    """Find new problems in the chats and file them once. Returns how many were added."""
    return _sync()


def _sync() -> int:
    """Find new problems in the chats and file them once. Returns how many were added."""
    data_dir = learn_api._data
    added = 0
    with closing(learn_api._db()) as conn:
        ensure_tables(conn)
        conn.execute('BEGIN IMMEDIATE')
        known = {r[0] for r in conn.execute("SELECT key FROM lib_problems")}
        have = [(r[0], r[1], r[2] or "", r[3] or "") for r in conn.execute("SELECT id, statement, raw_hash, number FROM lib_problems")]
        for tid, course_id, t, i, m, images, typed in _candidates(conn):
            key = f"{tid}:{m['id']}"
            if key in known:
                st = conn.execute("SELECT statement FROM lib_problems WHERE key=?", (key,)).fetchone()
                conn.execute("UPDATE lib_problems SET worked=? WHERE key=?", (_worked(t, i, st[0] if st else ""), key))
                continue
            a = images[0] if images else None
            raw_hash = ""
            if a:
                try:
                    raw_hash = hashlib.sha256(content.attachment_file(data_dir, a).read_bytes()).hexdigest()
                except OSError:
                    raw_hash = ""
            statement = typed or _tutor_line(t, i)
            if not statement and not a:
                continue
            number, verified, book = match_book(statement or "")
            if verified:
                statement = _clean(book)
            same = None
            for lid, st, rh, num in have:
                if (raw_hash and rh == raw_hash) or (number and verified and num == number) or \
                        (statement and st and len(_terms(statement) & _terms(st)) / max(1, len(_terms(statement) | _terms(st))) >= SAME_AT):
                    same = lid
                    break
            if same:
                conn.execute("INSERT INTO lib_problems(id,key,thread_id,message_id,course_id,statement,number,verified,attachment_id,crop,raw_hash,seen,hidden,created_ts,updated_ts) "
                             "SELECT ?,?,?,?,?,statement,number,verified,attachment_id,crop,raw_hash,0,1,?,? FROM lib_problems WHERE id=?",
                             ("l" + hashlib.sha1(key.encode()).hexdigest()[:11], key, tid, m["id"], course_id, m["created_ts"], time.time(), same))
                conn.execute("UPDATE lib_problems SET seen=seen+1, updated_ts=? WHERE id=?", (time.time(), same))
                known.add(key)
                continue
            lid = "l" + hashlib.sha1(key.encode()).hexdigest()[:11]
            crop = _crop(data_dir, a, lid) if a else ""
            conn.execute("INSERT INTO lib_problems(id,key,thread_id,message_id,course_id,statement,number,verified,attachment_id,crop,raw_hash,seen,hidden,created_ts,updated_ts,worked) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                         (lid, key, tid, m["id"], course_id, statement or "Screenshot problem", number, int(verified), a["id"] if a else None,
                          crop, raw_hash, 1, 0, m["created_ts"], time.time(), _worked(t, i, statement or "")))
            have.append((lid, statement, raw_hash, number or ""))
            known.add(key)
            added += 1
        conn.commit()
    return added


def listing(candidates: bool = False) -> list[dict]:
    """Kept or meaningfully worked problems; candidates=True lists the other chat uploads (never deleted) so one can be kept."""
    with closing(learn_api._db()) as conn:
        ensure_tables(conn)
        cond = "hidden=0 AND kept=0 AND worked=0" if candidates else "hidden=0 AND (kept=1 OR worked=1)"
        rows = conn.execute("SELECT id, thread_id, message_id, course_id, statement, number, verified, crop, seen, created_ts, kept FROM lib_problems "
                            f"WHERE {cond} ORDER BY created_ts DESC").fetchall()
    return [{"id": r[0], "thread_id": r[1], "message_id": r[2], "course_id": r[3], "statement": r[4], "number": r[5],
             "verified": bool(r[6]), "crop": r[7] or "", "times": r[8], "created_ts": r[9], "kept": bool(r[10])} for r in rows]


def keep(lid: str, on: bool = True) -> int:
    with closing(learn_api._db()) as conn:
        ensure_tables(conn)
        n = conn.execute("UPDATE lib_problems SET kept=?, hidden=0, updated_ts=? WHERE id=?", (int(on), time.time(), lid)).rowcount
        conn.commit()
    return n


def work_listing(view='saved', query=''):
    """Saved/Recent native cards. Old false-positive rows stay stored, unlisted."""
    with closing(learn_api._db()) as conn:
        ensure_tables(conn)
        chat = conn.execute('''SELECT id,thread_id,message_id,statement,number,verified,crop,
            created_ts,kept,worked,attachment_id FROM lib_problems WHERE hidden=0
            ORDER BY created_ts DESC''').fetchall()
        saved = conn.execute('''SELECT id,title,text,image,meta,created_ts,updated_ts FROM problems
            WHERE id NOT IN (SELECT item_id FROM library_work_visibility WHERE kind='saved' AND hidden=1)
            ORDER BY updated_ts DESC''').fetchall()
    items=[]
    for r in chat:
        # A deliberate Keep or a photo remains accessible even if its caption is conversational.
        if not (r[8] or r[10] or looks_like_problem(r[3])):
            continue
        is_saved=bool(r[8] or r[9])
        items.append({'id':r[0], 'kind':'chat', 'thread_id':r[1], 'message_id':r[2],
                      'number':r[4], 'verified':bool(r[5]), 'crop':r[6] or '',
                      'created_ts':r[7], 'saved':is_saved,
                      '_search':r[3],
                      **presentation(r[3],r[4],r[5],bool(r[10]))})
    for r in saved:
        try: meta=json.loads(r[4] or '{}')
        except (ValueError, TypeError): meta={}
        if isinstance(meta,dict) and meta.get('root_id') and meta['root_id']!=r[0]:
            continue
        card=presentation(r[1] or r[2],photo=bool(r[3]))
        if (r[2] or '').strip() and r[2].strip() != (r[1] or '').strip():
            card['preview']=presentation(r[2])['preview'] or presentation(r[2])['title']
        items.append({'id':r[0], 'kind':'saved', 'thread_id':None, 'number':None,
                      'verified':False, 'crop':r[3] or '', 'created_ts':r[6], 'saved':True,
                      '_search':(r[1] or '')+' '+(r[2] or ''),
                      **card})
    for item in items:
        if not item['crop'].startswith('/uploads/'):
            item['crop']=''
    items.sort(key=lambda r:(r['created_ts'],r['kind'],r['id']),reverse=True)
    counts={'saved':sum(r['saved'] for r in items),'recent':len(items)}
    rows=[r for r in items if view=='recent' or r['saved']]
    if query:
        q=query.casefold()
        rows=[r for r in rows if q in (r['_search']+' '+(r['number'] or '')).casefold()]
    rows=[{k:v for k,v in r.items() if k!='_search'} for r in rows]
    return {'items':rows,'counts':counts,'view':view}


@router.get('')
def work_items(view: str = Query('saved', pattern='^(saved|recent)$'), q: str = Query('',max_length=200)):
    warning=''
    try:
        sync()
    except (OSError, ValueError):
        warning='Recent problems could not be refreshed. Your saved work is still available.'
    result=work_listing(view,q)
    if warning: result['warning']=warning
    return result


@router.post('/{kind}/{item_id}/visibility')
def work_visibility(kind: str, item_id: str, payload: dict = Body(...)):
    """Only My-work visibility changes. Chat, upload, progress and membership stay intact."""
    if kind not in ('chat','saved') or type(payload.get('hidden')) is not bool:
        raise HTTPException(400,'Choose a problem and whether to remove or restore it.')
    with closing(learn_api._db()) as conn:
        ensure_tables(conn)
        if kind=='chat':
            n=conn.execute('UPDATE lib_problems SET hidden=? WHERE id=?',
                           (int(payload['hidden']),item_id)).rowcount
        else:
            n=conn.execute('SELECT 1 FROM problems WHERE id=?',(item_id,)).fetchone()
            if n:
                conn.execute('''INSERT INTO library_work_visibility VALUES('saved',?,?)
                    ON CONFLICT(kind,item_id) DO UPDATE SET hidden=excluded.hidden''',
                    (item_id,int(payload['hidden'])))
        if not n:
            raise HTTPException(404,'This problem is no longer available.')
        conn.commit()
    return {'ok':True,'hidden':payload['hidden']}


def hide(lid: str) -> int:
    with closing(learn_api._db()) as conn:
        ensure_tables(conn)
        row = conn.execute("SELECT statement, raw_hash FROM lib_problems WHERE id=?", (lid,)).fetchone()
        if not row:
            return 0
        n = conn.execute("UPDATE lib_problems SET hidden=1 WHERE id=? OR (raw_hash!='' AND raw_hash=?)", (lid, row[1])).rowcount
        conn.commit()
    return n
